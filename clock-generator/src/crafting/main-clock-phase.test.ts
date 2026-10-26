import { beforeAll, describe, expect, it, vi } from "vitest";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import type { Config } from "../config/schema";
import { Duration, OpenRange } from "../data-types";
import { TickProvider } from "../control-logic/current-tick-provider";
import { EnableControl } from "../control-logic/enable-control";
import * as planning from "./plan/plan-run";
import { constructPrimitiveGroupedHands } from "./candidates/primitive-grouped-hands";
import { rotateRanges } from "./clock";
import { buildAsBuiltConfig, exhaustiveCrossingKey, exhaustiveStartPhases, runAsBuiltCheck, runClockOnBuild, startDependenceOf } from "./trial";
import { createEntityRegistryFromConfig } from "./sequence/simulation-context";
import { unplannedInserterClocks } from "./sequence/unplanned-inserter-clock";
import { canonicalKey } from "./plan/run-memo";

const quiet = { log() {}, warn() {}, error() {}, debug() {} };
const controlsOf = (config: Config) => config.inserters.map((inserter, index) => ({
    id: inserter.id ?? index + 1, control: inserter.overrides?.enable_control,
}));
function clocked(config: Config, id: number) {
    const control = controlsOf(config).find(row => row.id === id)!.control;
    if (control?.mode !== "CLOCKED") throw new Error(`Expected inserter${id} clocked`);
    return control;
}
function mask(config: Config, id: number, tick: number, period: number): boolean {
    const position = ((tick % period) + period) % period;
    return clocked(config, id).ranges.some(range => position >= range.start && position <= range.end);
}
function assertTranslated(canonical: Config, shifted: Config, period: number, offset: number) {
    for (const { id, control } of controlsOf(canonical)) {
        if (control?.mode !== "CLOCKED") continue;
        for (let tick = 0; tick < period; tick++) expect(mask(shifted, id, tick, period)).toBe(mask(canonical, id, tick - offset, period));
        expect(clocked(shifted, id).latency_ticks).toBe(control.latency_ticks);
        expect(clocked(shifted, id).decider_build_order).toBe(control.decider_build_order);
    }
}

describe("shared main-clock phase composition", () => {
    let auto: Config, derived: Config, windows: Map<string, OpenRange[]>;
    beforeAll(async () => {
        const control = await loadConfigFromFile(ConfigPaths.REAL_OWNER_PINK_SCIENCE_ORIGINAL);
        auto = { ...control, overrides: undefined, inserters: control.inserters.map(inserter => ({ ...inserter, overrides: undefined })) };
        const construction = constructPrimitiveGroupedHands(auto);
        const compact = construction.attempts.find(attempt => !attempt.options.share_windows && attempt.options.feeder_offset === 1)!;
        if (compact.result.kind !== "constructed") throw new Error(compact.result.reason);
        windows = new Map(Object.entries(compact.result.planned_windows).map(([id, ranges]) => [id, ranges.map(range => OpenRange.from(range.start, range.end))]));
        // Accounting context for actual control-path tests, derived from the pure constructor, never saved into AUTO.
        derived = { ...auto, overrides: { terminal_swing_count: construction.terminal_swing_count, lcm: construction.grouped_cycles } };
    });

    it.each([3, 38, -3, 83])("shifts computed red and every other main predicate together by%s, with one latency and fixed installation order", offset => {
        const canonical = buildAsBuiltConfig(auto, windows, 40);
        const shifted = buildAsBuiltConfig(auto, windows, 40, undefined, "built", offset);
        expect(clocked(canonical, 3).ranges).toEqual([{ start: 2, end: 6 }]);
        if (offset === 3) expect(clocked(shifted, 3).ranges).toEqual([{ start: 5, end: 9 }]);
        expect(clocked(shifted, 3).latency_ticks).toBe(2);
        assertTranslated(canonical, shifted, 40, offset);
    });

    it("moves every repeated byproduct opening when its modulus strictly divides the main period", () => {
        const period = 1200;
        const clocks = unplannedInserterClocks(createEntityRegistryFromConfig(auto), period);
        const red = clocks.get("inserter:3")!;
        expect(red.own_clock).toBe(false);
        expect(red.modulus).toBeLessThan(period);
        expect(period % red.modulus).toBe(0);
        const canonical = buildAsBuiltConfig(auto, windows, period);
        const shifted = buildAsBuiltConfig(auto, windows, period, undefined, "built", 3);
        assertTranslated(canonical, shifted, period, 3);
    });

    it("aligns future shared predicates at phase crossings rather than merging equal enabled bits at different phases", () => {
        const canonical = buildAsBuiltConfig(auto, windows, 40);
        const plus3 = buildAsBuiltConfig(auto, windows, 40, undefined, "built", 3);
        expect(mask(canonical, 3, 0, 40)).toBe(mask(plus3, 3, 0, 40));
        expect(mask(canonical, 3, 2, 40)).not.toBe(mask(plus3, 3, 2, 40));
        // At offset+kP crossings every translated main control has the same entire future mask.
        for (let offset = 0; offset < 40; offset++) {
            const shifted = buildAsBuiltConfig(auto, windows, 40, undefined, "built", offset);
            for (const { id, control } of controlsOf(canonical)) if (control?.mode === "CLOCKED") {
                for (let future = 0; future < 40; future++) expect(mask(shifted, id, offset + 40 + future, 40)).toBe(mask(canonical, id, future, 40));
            }
        }
    });

    it("keeps a relative single-group margin shift local and leaves canonical red unchanged", () => {
        const moved = new Map(windows);
        const key = (ranges: OpenRange[]) => JSON.stringify(ranges.map(range => [range.start_inclusive, range.end_inclusive]));
        const group = [...windows].filter(([, ranges]) => key(ranges) === key(windows.get("inserter:2")!)).map(([id]) => id);
        for (const id of group) moved.set(id, [OpenRange.from(5, 21)]);
        const canonical = buildAsBuiltConfig(auto, windows, 40), margin = buildAsBuiltConfig(auto, moved, 40);
        expect(clocked(margin, 3)).toEqual(clocked(canonical, 3));
        expect(clocked(margin, 2).ranges).not.toEqual(clocked(canonical, 2).ranges);
        for (const { id } of controlsOf(canonical).filter(row => !group.includes(`inserter:${row.id}`))) {
            for (let tick = 0; tick < 40; tick++) expect(mask(margin, id, tick, 40)).toBe(mask(canonical, id, tick, 40));
        }
    });

    it("partitions startup-blackout crossings from equal periodic states without changing recorded bins", () => {
        const wrap = new Map(windows).set("inserter:2", [OpenRange.from(38, 39)]);
        const control = clocked(buildAsBuiltConfig(auto, wrap, 40), 2);
        expect(control.ranges).toEqual([{ start: 0, end: 1 }]);
        const tick = TickProvider.mutable(0);
        const clock = EnableControl.clocked({ periodDuration: Duration.ofTicks(40),
            enabledRanges: control.ranges.map(range => OpenRange.from(range.start, range.end)), tickProvider: tick,
            is_game_clock: true, start_latency_ticks: control.latency_ticks });
        clock.reset(true);
        const seen = [0, 1, 40, 41].map(time => { tick.setCurrentTick(time); return clock.isEnabled(); });
        expect(seen).toEqual([false, false, true, true]);
        // Identical physical keys/periodic positions still have different future control before startup is complete.
        expect(exhaustiveCrossingKey("same physical state", 0)).not.toBe(exhaustiveCrossingKey("same physical state", 40));
        expect(exhaustiveCrossingKey("same physical state", 1)).not.toBe(exhaustiveCrossingKey("same physical state", 41));
        expect(exhaustiveCrossingKey("same physical state", 40)).toBe(exhaustiveCrossingKey("same physical state", 80));
    });

    it("retains unshifted controls and keeps explicit reversed installation order separate", () => {
        expect(buildAsBuiltConfig(auto, windows, 40, undefined, "built", 0)).toEqual(buildAsBuiltConfig(auto, windows, 40));
        const reversed = buildAsBuiltConfig(auto, windows, 40, undefined, "reversed", 3);
        const ordinary = buildAsBuiltConfig(auto, windows, 40, undefined, "built", 3);
        expect(controlsOf(reversed).map(row => row.control?.mode === "CLOCKED" && row.control.decider_build_order))
            .not.toEqual(controlsOf(ordinary).map(row => row.control?.mode === "CLOCKED" && row.control.decider_build_order));
        for (const { id } of controlsOf(ordinary)) for (let tick = 0; tick < 40; tick++) expect(mask(reversed, id, tick, 40)).toBe(mask(ordinary, id, tick, 40));
    });

    it("retains ordinary no-byproduct phase masks and keeps actual shifted configurations distinct in memo identity", async () => {
        const config = await loadConfigFromFile(ConfigPaths.LOGISTIC_SCIENCE);
        const ranges = new Map(config.inserters.map((inserter, index) => [`inserter:${inserter.id ?? index + 1}`, [OpenRange.from(0, 3)]]));
        expect(unplannedInserterClocks(createEntityRegistryFromConfig(config), 40).size).toBe(0);
        const canonical = buildAsBuiltConfig(config, ranges, 40), shifted = buildAsBuiltConfig(config, ranges, 40, undefined, "built", 3);
        assertTranslated(canonical, shifted, 40, 3);
        expect(canonicalKey(canonical)).not.toBe(canonicalKey(shifted));
        expect(buildAsBuiltConfig(config, ranges, 40, undefined, "built", 40)).toEqual(canonical);
    });

    it("shifts by a whole-tick start of a fractional period exactly, as rotating the windows does, with no float noise at the window's first tick", async () => {
        const config = await loadConfigFromFile(ConfigPaths.LOGISTIC_SCIENCE);
        const period = 19200 / 83;
        const ranges = new Map(config.inserters.map((inserter, index) => [`inserter:${inserter.id ?? index + 1}`, [OpenRange.from(1, 34)]]));
        for (const offset of [197, 209, 212, 225]) {
            const rotated = new Map(Array.from(ranges, ([key, windows]) => [key, rotateRanges(windows, offset, period)] as const));
            const shifted = buildAsBuiltConfig(config, ranges, period, undefined, "built", offset);
            const rotatedFirst = buildAsBuiltConfig(config, rotated, period);
            for (const { id } of controlsOf(shifted)) {
                expect(clocked(shifted, id).ranges, `offset ${offset}, inserter ${id}`).toEqual(clocked(rotatedFirst, id).ranges);
            }
        }
    });

    it.each([NaN, Infinity, -Infinity])("rejects nonfinite phase%s without mutating configuration", shift => {
        const before = JSON.stringify(auto);
        expect(() => buildAsBuiltConfig(auto, windows, 40, undefined, "built", shift)).toThrow(/shift must be finite/);
        expect(JSON.stringify(auto)).toBe(before);
    });

    it("preserves independent own-fuel predicates and the existing exhaustive-proof refusal", async () => {
        const loaded = await loadConfigFromFile(ConfigPaths.BIOCHAMBER_FUEL);
        const fuel = { ...loaded, inserters: loaded.inserters.map(inserter => ({ ...inserter, overrides: undefined })) };
        const clocks = unplannedInserterClocks(createEntityRegistryFromConfig(fuel), 600);
        const own = [...clocks.values()].filter(clock => clock.own_clock);
        expect(own.length).toBeGreaterThan(0);
        const canonical = buildAsBuiltConfig(fuel, new Map(), 600, clocks);
        const shifted = buildAsBuiltConfig(fuel, new Map(), 600, clocks, "built", 3);
        for (const clock of own) expect(clocked(shifted, clock.inserter_id.number)).toEqual(clocked(canonical, clock.inserter_id.number));
        expect(exhaustiveStartPhases(fuel, new Map(), 600, quiet)).toBeNull();
    });

    it("consumes phase policy before RunOptions/memo dispatch and installs the correct shifted waveform", () => {
        const original = planning.runBuild, observed: { config: Config; options: planning.RunOptions }[] = [];
        const spy = vi.spyOn(planning, "runBuild").mockImplementation((config, options) => { observed.push({ config, options }); return original(config, options); });
        try {
            runClockOnBuild(derived, windows, 40, quiet, { main_clock_shift: 3 });
            expect(observed).toHaveLength(1);
            expect(observed[0].options).not.toHaveProperty("main_clock_shift");
            assertTranslated(buildAsBuiltConfig(derived, windows, 40), observed[0].config, 40, 3);
        } finally { spy.mockRestore(); }
    });

    it("uses the opposite-sign shared shift for both start-dependence long-run and direct checks", () => {
        const original = planning.runBuild, observed: Config[] = [];
        const spy = vi.spyOn(planning, "runBuild").mockImplementation((config, options) => { observed.push(config); return original(config, options); });
        try {
            const serial = Object.fromEntries([...windows].map(([id, ranges]) => [id, ranges.map(range => ({ start: range.start_inclusive, end: range.end_inclusive }))]));
            startDependenceOf(derived, serial, 40, 32, true, quiet, [{ id: "phase3", label: "clock at3", clock_shift: 3, competing_takers_order: "descending" }]);
            expect(observed.length).toBeGreaterThan(0);
            for (const config of observed) assertTranslated(buildAsBuiltConfig(derived, windows, 40), config, 40, -3);
        } finally { spy.mockRestore(); }
    });

    it("samples complete shared-counter phases and preserves canonical decider order", () => {
        const original = planning.runBuild, observed: Config[] = [];
        const spy = vi.spyOn(planning, "runBuild").mockImplementation((config, options) => { observed.push(config); return original(config, options); });
        try {
            runAsBuiltCheck(derived, windows, 40, quiet);
            const canonical = buildAsBuiltConfig(derived, windows, 40);
            expect(observed.some(config => mask(config, 3, 5, 40) && !mask(config, 3, 2, 40))).toBe(true); // sampled+3 reached
            for (const config of observed) expect(Array.from({ length: 40 }, (_, offset) => offset).some(offset => {
                for (const { id } of controlsOf(canonical)) for (let tick = 0; tick < 40; tick++) {
                    if (mask(config, id, tick, 40) !== mask(canonical, id, tick - offset, 40)) return false;
                }
                return true;
            })).toBe(true);
        } finally { spy.mockRestore(); }
    });

    it("uses the same composed phase in exhaustive cold builds and retains the complete future-control alignment", () => {
        const original = planning.coldControlledTrialBuild, observed: Config[] = [];
        const spy = vi.spyOn(planning, "coldControlledTrialBuild").mockImplementation((config, plan, cycles, options, logger) => {
            observed.push(config); return original(config, plan, cycles, options, logger);
        });
        try {
            const result = exhaustiveStartPhases(derived, windows, 40, quiet);
            expect(result).not.toBeNull();
            expect(observed.length).toBeGreaterThan(1);
            const canonical = buildAsBuiltConfig(derived, windows, 40);
            observed.forEach((config, offset) => assertTranslated(canonical, config, 40, offset));
        } finally { spy.mockRestore(); }
    });
});
