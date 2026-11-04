import fs from "fs";
import {describe, expect, test} from "vitest";
import {ConfigPaths} from "../../../src/config/config-paths";
import {ClockControl, ClockHistory, coldClockReferenceMismatches, historicalPinMismatches, pinMismatches, readControls} from "./clock-controls";
import {handMadeClockHash as grenadeClockHash} from "./grenade-clock-fixtures";
import {handMadeClockHash} from "./inserter-crafting-240-shared-signal-clock-fixtures";

/**
 * Every game test that runs a generated clock compares what the game did with a recording, and the recording belongs to
 * one clock. These tests read the controls files only (no generation, no Factorio, so they run with the unit tests) and
 * fail where a pin was moved to follow a selection and its recording was not made again: the generation tests (pull
 * requests to master) find the selection that moved, this finds the pin that was edited to follow it.
 */
const FAMILIES = ["blocked-output", "container", "front", "grenade", "inserter-crafting-240-shared-signal", "iron-ore-voider-400", "iron-plate-80-car-chest", "lithium-plate-80-silo-chest", "over-hood", "pickup", "processing-unit-80-circuit-export", "productivity-module-80-chest-chain", "steel-plate-26-wagon-chest", "utility-science-480-lds-foundry-chain"]
    .map(family => `${family}-clock-controls.json`);
const hash = /^[0-9a-f]{64}$/;
/** Entries whose native summary has no known clock yet: the list may only shrink */
const NOT_YET_TIED: Record<string, string[]> = {};
/** Entries that are a build's hand-made clock, not a selection: the identity of that clock in the blueprint the test builds */
const OWNER_CLOCKS: Record<string, Record<string, string>> = {
    "inserter-crafting-240-shared-signal-clock-controls.json": {"hand-made-clock-three-copies": handMadeClockHash()},
    "grenade-clock-controls.json": {"hand-made-one-copy": grenadeClockHash("one copy"), "hand-made-full-build": grenadeClockHash("full build")},
};

test("every family of game tests with a controls file is checked here", () => {
    const files = fs.readdirSync(__dirname).filter(file => file.endsWith("-clock-controls.json") && !file.includes("history")).sort();
    expect(files).toEqual([...FAMILIES].sort());
});

describe.each(FAMILIES)("%s", file => {
    const controls = readControls(file);
    test("every native summary names the clock it was recorded on, and the pin names it too", () => {
        expect(Object.keys(controls.cases).length).toBeGreaterThan(0);
        expect(pinMismatches(controls.cases, NOT_YET_TIED[file], OWNER_CLOCKS[file])).toEqual([]);
    });
    test("the entries not tied yet are entries", () => {
        for (const name of NOT_YET_TIED[file] ?? []) expect(controls.cases[name], name).toBeDefined();
    });
});

describe("pinMismatches", () => {
    const entry = (recorded: object, pin = "b".repeat(64)): ClockControl => ({
        recorded: {pr: 1, commit: "c0ffee", frozen_head: null, clock_basis: "capture", ...recorded},
        native: {generationVerdict: "stable", target: 1, period: 10, expected: 5, baseline: [5], recovery: []},
        generation: {period: 10, expected: 5, verdict: "stable", selection: {id: "x", holds: true, rate: 1, supply: null}, clock_sha256: pin},
    });
    const a = "a".repeat(64), b = "b".repeat(64);

    test("accepts a recording on the pinned clock", () => {
        expect(pinMismatches({one: entry({clock_sha256: b})})).toEqual([]);
    });
    test("fails a pin that moved while the recording did not", () => {
        const found = pinMismatches({one: entry({clock_sha256: a})});
        expect(found).toHaveLength(1);
        expect(found[0]).toContain("one: the pin names clock bbbbbbbbbbbb and the native summary was recorded on aaaaaaaaaaaa");
    });
    test("accepts a moved pin that says why the recording still holds, and nothing that says it for no reason", () => {
        expect(pinMismatches({one: entry({clock_sha256: a, carried: "5e904a10: same windows, verdicts and game result"})})).toEqual([]);
        expect(pinMismatches({one: entry({clock_sha256: a, carried: " "})}).length).toBeGreaterThan(0);
        expect(pinMismatches({one: entry({clock_sha256: b, carried: "stale"})})).toHaveLength(1);
    });
    test("fails a native summary with no clock, no basis or no pin", () => {
        expect(pinMismatches({one: entry({})})).toHaveLength(1);
        expect(pinMismatches({one: entry({clock_sha256: "xyz"})})).toHaveLength(1);
        expect(pinMismatches({one: entry({clock_sha256: b, clock_basis: undefined})})).toHaveLength(1);
        expect(pinMismatches({one: {...entry({clock_sha256: b}), generation: undefined}})).toHaveLength(1);
    });
    test("fails a native summary and a pin of different periods", () => {
        const other = entry({clock_sha256: b});
        other.generation!.period = 12;
        expect(pinMismatches({one: other})).toHaveLength(1);
    });
    test("lets an entry listed as not tied go without a clock, and not keep one", () => {
        expect(pinMismatches({one: entry({})}, ["one"])).toEqual([]);
        expect(pinMismatches({one: entry({clock_sha256: b})}, ["one"])).toHaveLength(1);
    });
});

describe("pinMismatches for a hand-made clock", () => {
    const hash = "c".repeat(64);
    const owner = (recorded: object = {}, extra: object = {}): ClockControl => ({
        recorded: {pr: 1, commit: "c0ffee", frozen_head: null, clock_basis: "built", clock_sha256: hash, ...recorded},
        native: {generationVerdict: "the build's own clock", target: 1, period: 10, expected: 5, baseline: [5], recovery: []},
        ...extra,
    });
    const built = {one: hash};

    test("accepts a recording on the hand-made clock, with no pin", () => {
        expect(pinMismatches({one: owner()}, [], built)).toEqual([]);
    });
    test("fails a recording of another clock than the blueprint's, a missing hash, or another basis", () => {
        expect(pinMismatches({one: owner({clock_sha256: "d".repeat(64)})}, [], built)[0]).toContain("record it again in the game");
        expect(pinMismatches({one: owner({clock_sha256: undefined})}, [], built)).toHaveLength(1);
        expect(pinMismatches({one: owner({clock_basis: "capture"})}, [], built)).toHaveLength(1);
    });
    test("fails a pin or a carried note on it", () => {
        const pin = {period: 10, expected: 5, verdict: "stable", selection: {id: "x", holds: true, rate: 1, supply: null}, clock_sha256: hash};
        expect(pinMismatches({one: owner({}, {generation: pin})}, [], built)).toHaveLength(1);
        expect(pinMismatches({one: owner({carried: "x"})}, [], built)).toHaveLength(1);
    });
    test("does not let a generated entry take the basis: it is not named as a hand-made clock", () => {
        expect(pinMismatches({one: owner()})).toHaveLength(1);
        expect(pinMismatches({one: owner()}, ["one"])).toHaveLength(1);
    });
});

describe("cold starts", () => {
    const start = readControls<{cold_start: {clocks: Record<string, {clock_sha256: string; recorded_clock_sha256: string}>; runs: Record<string, {clock: string}>; historical_runs?: Record<string, {clock: string}>}}>("pickup-clock-start-controls.json").cold_start;
    test("every clock the runs were recorded on is the one the selection and the pinned windows make", () => {
        const found = Object.entries(start.clocks).filter(([, clock]) => clock.recorded_clock_sha256 !== clock.clock_sha256 || !hash.test(clock.clock_sha256))
            .map(([key, clock]) => `${key}: pinned ${clock.clock_sha256}, recorded on ${clock.recorded_clock_sha256}`);
        expect(found).toEqual([]);
    });
    test("every run names a clock, and every clock has a run", () => {
        expect(coldClockReferenceMismatches(start.clocks, start.runs, start.historical_runs)).toEqual([]);
    });
});

describe("scaffold recordings", () => {
    const pins = readControls<{cases: Record<string, {config: string; clock_sha256: string}>}>("scaffold-recordings-clock-pins.json").cases;
    test("each pinned build has a hash and a config that exists", () => {
        expect(Object.keys(pins).length).toBeGreaterThan(0);
        for (const [name, pin] of Object.entries(pins)) {
            expect(pin.clock_sha256, name).toMatch(hash);
            expect(fs.existsSync((ConfigPaths as Record<string, string>)[pin.config]), `${name}: ${pin.config}`).toBe(true);
        }
    });
});

test("known historical captures retain their own identity, separate from the active pin", () => {
    for (const file of fs.readdirSync(__dirname).filter(file => file.endsWith("history-controls.json"))) {
        const history = readControls<ClockHistory>(file);
        if (!Object.values(history.cases).some(entries => entries.some(it => it.recorded.clock_sha256 !== undefined))) continue;
        const current = readControls(file.replace("-history-controls.json", "-controls.json"));
        expect(historicalPinMismatches(history.cases, current.cases), file).toEqual([]);
    }
});

test("cold reference checks include history without accepting missing or orphaned clocks", () => {
    const clocks = {active: {}, old: {}};
    const runs = {now: {clock: "active"}}, history = {before: {clock: "old"}};
    expect(coldClockReferenceMismatches(clocks, runs, history)).toEqual([]);
    expect(coldClockReferenceMismatches(clocks, runs)).toEqual(["old: clock has no current or historical run"]);
    expect(coldClockReferenceMismatches({active: {}}, runs, history)).toEqual(["old: run names a missing clock"]);
});

describe("historical identity validation", () => {
    const entry: ClockControl = {
        recorded: {pr: 1, commit: "c0ffee", frozen_head: null, clock_sha256: "a".repeat(64), clock_basis: "capture"},
        native: {generationVerdict: "stable", target: 1, period: 10, expected: 5, baseline: [5], recovery: []},
        generation: {period: 10, expected: 5, verdict: "stable", selection: {id: "x", holds: true, rate: 1, supply: null}, clock_sha256: "a".repeat(64)},
    };
    const current = {...entry, generation: {...entry.generation!, clock_sha256: "b".repeat(64)}};
    test("keeps a known old hash and its complete control", () => {
        expect(historicalPinMismatches({one: [entry]}, {one: current})).toEqual([]);
    });
    test("rejects active identity, malformed identity, absent old pin and inconsistent quantities", () => {
        expect(historicalPinMismatches({one: [entry]}, {one: entry})[0]).toContain("still names the active pin");
        expect(historicalPinMismatches({one: [{...entry, recorded: {...entry.recorded, clock_sha256: "bad"}}]}, {one: current})[0]).toContain("recorded.clock_sha256 is missing");
        expect(historicalPinMismatches({one: [{...entry, generation: undefined}]}, {one: current})[0]).toContain("no generation pin");
        expect(historicalPinMismatches({one: [{...entry, native: {...entry.native, expected: 6}}]}, {one: current})[0]).toContain("different clocks");
    });
    test("a capture records actual source heads without invented pin publication metadata", () => {
        const captured = {...entry, recorded: {frozen_head: null, clock_sha256: "a".repeat(64), clock_basis: "capture" as const,
            capture: {validation_pr: 551, control_head: "c".repeat(40), harness_head: "d".repeat(40), game_version: "2.1.21"}}};
        expect(pinMismatches({one: captured})).toEqual([]);
        const invalid = {...captured, recorded: {...captured.recorded, capture: {...captured.recorded.capture, control_head: "short"}}};
        expect(pinMismatches({one: invalid})[0]).toContain("full control and harness commit identities");
        expect(pinMismatches({one: {...captured, recorded: {...captured.recorded, pr: 1, commit: "made-up"} as unknown as ClockControl["recorded"]}})[0]).toContain("must not claim pin publication identifiers");
        expect(pinMismatches({one: {...captured, recorded: {...captured.recorded, clock_basis: "history"}}})[0]).toContain("requires the capture clock basis");
    });
});
