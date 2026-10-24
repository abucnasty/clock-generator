import {createHash} from "crypto";
import {beforeAll, expect, test} from "vitest";
import {ClockAlternativesResult, backpressureLossOf, clockFromWindows, generateClockAlternatives} from "./generate-blueprint";
import {clockIdentity} from "./clock-identity";
import {ConfigPaths} from "../config/config-paths";
import {loadConfigFromFile} from "../config/loader";
import {GENERATED_ALTERNATIVE, grenadeClockCases} from "../../tests/game/builds/grenade-clock-fixtures";
import {readControls} from "../../tests/game/builds/clock-controls";

// the grenade build (REAL_OWNER_GRENADE): the generated clock pinned beside the in-game recording of it on one copy
// and on the full build of seven, and the hand-made clock judged by the simulator
const controls = readControls("grenade-clock-controls.json");
const quiet = {log() {}, info() {}, warn() {}, error() {}, debug() {}};
let generated: ClockAlternativesResult;

beforeAll(async () => {
    generated = generateClockAlternatives(await loadConfigFromFile(ConfigPaths.REAL_OWNER_GRENADE), {logger: quiet});
});

test("grenade: the 112-tick clock holds the target and is selected; the longer ones, planned the same way, do not", () => {
    const selected = generated.alternatives[generated.selected_index];
    expect(selected.id).toBe(GENERATED_ALTERNATIVE);
    expect(selected.verdict).toBe("stable");
    expect(selected.assessment.items_per_second).toBe(240);
    expect(selected.result.simulation_duration.ticks).toBe(112);
    // two groups of two machines, half a period apart: the foundry cannot serve four at once. The machines of one row of the belt
    // (inserters 1 and 2, and 3 and 4 that fill them) are one group, the machines of the other row (7 and 8; 5 and 6) the other
    const windows = selected.result.clock_windows;
    expect([windows["inserter:3"], windows["inserter:4"]]).toEqual([[{start: 2, end: 43}], [{start: 2, end: 43}]]);
    expect([windows["inserter:5"], windows["inserter:6"]]).toEqual([[{start: 58, end: 99}], [{start: 58, end: 99}]]);
    expect([windows["inserter:1"], windows["inserter:2"]]).toEqual([[{start: 0, end: 0}], [{start: 0, end: 0}]]);
    expect([windows["inserter:7"], windows["inserter:8"]]).toEqual([[{start: 56, end: 56}], [{start: 56, end: 56}]]);
    // the drills of a group share one window, two ticks: 160 coal a period against the 125 to 134 a tick the drills mine (two drill deciders, as the hand-made clock has)
    expect([windows["drill:1"], windows["drill:2"]]).toEqual([[{start: 2, end: 3}], [{start: 2, end: 3}]]);
    expect([windows["drill:3"], windows["drill:4"]]).toEqual([[{start: 58, end: 59}], [{start: 58, end: 59}]]);
    expect(generated.alternatives.filter(it => it.id !== GENERATED_ALTERNATIVE).every(it => it.verdict === "unstable")).toBe(true);
});

test("grenade: every alternative says the lanes of the belt are exactly full, and the selected clock's hands fit between each other", () => {
    for (const alternative of generated.alternatives) {
        expect(alternative.insights.find(it => it.id === "lanes-exactly-full")?.title).toBe("Both lanes of belt 1 are exactly full");
        expect(alternative.insights.find(it => it.id === "drop-spacing")).toBeDefined();
    }
    // the two inserters of a row start in the same tick: the 14 hands of a row land on 14 tiles of the belt's cycle of 14
    const selected = generated.alternatives[generated.selected_index];
    const spacing = selected.insights.find(it => it.id === "drop-spacing")!;
    expect(spacing.title).toBe("Drops onto belt 1 fit between each other");
    expect(spacing.table?.rows).toEqual([["1 and 2", "14", "12", "14", "0", "0"], ["7 and 8", "14", "12", "14", "0", "0"]]);
});

test("grenade: copies a tile closer put hands on each other, and the insight says so", async () => {
    const config = await loadConfigFromFile(ConfigPaths.REAL_OWNER_GRENADE);
    const closer = {...config, target_output: {...config.target_output, copy_offset: {x: 11, y: 0}}};
    const made = generateClockAlternatives(closer, {logger: quiet});
    const selected = made.alternatives[made.selected_index];
    expect(selected.insights.find(it => it.id === "drop-spacing")?.title).toBe("Drops onto belt 1 land on each other");
});

test("grenade: the hand-made clock, as windows, holds in the simulator and gets back after every loss", async () => {
    const config = await loadConfigFromFile(ConfigPaths.REAL_OWNER_GRENADE);
    const range = (start: number, end: number) => [{start, end}];
    // counted 0 to 111; a window decider reads the counter, so its first value is the window's first tick
    const windows = {
        "inserter:1": range(0, 0), "inserter:2": range(0, 0), "inserter:7": range(56, 56), "inserter:8": range(56, 56),
        "inserter:3": range(2, 43), "inserter:4": range(2, 43), "inserter:5": range(58, 99), "inserter:6": range(58, 99),
        "drill:1": range(5, 7), "drill:2": range(5, 7), "drill:3": range(61, 63), "drill:4": range(61, 63),
    };
    const forced = {...config, overrides: {...config.overrides, terminal_swing_count: 1}};
    const made = clockFromWindows(forced, windows, 112, quiet);
    expect(made.stability_check.as_built?.holds).toBe(true);
    expect(made.stability_check.as_built?.actual_output_items).toBe(64);
    expect(backpressureLossOf(forced, windows, 112, 64, quiet).survives).toBe(true);
});

for (const variant of grenadeClockCases()) {
    test(`grenade clock: ${variant.name}`, () => {
        const {generation, native} = controls.cases[variant.name];
        // the game holds the target in every baseline period and is back at it in every judged period after each loss
        expect(native.baseline).toHaveLength(63);
        expect(native.baseline.every(items => items === native.expected)).toBe(true);
        for (const loss of native.recovery) {
            expect(Math.min(...loss.during)).toBeLessThan(native.expected);
            expect(loss.recovered.length).toBeGreaterThan(1);
        }
        expect(native.period).toBe(112);
        if (variant.kind === "owner's clock") {
            expect(generation).toBeUndefined();
            return;
        }
        const chosen = generated.alternatives.find(alternative => alternative.id === GENERATED_ALTERNATIVE)!;
        const exported = chosen.result.subtick ?? chosen.result;
        expect(createHash("sha256").update(JSON.stringify(clockIdentity(exported))).digest("hex"),
            "same windows and exported clock as the native control (its identity: no text or metadata)").toBe(generation!.clock_sha256);
        expect(chosen.result.subtick?.clock.period_ticks ?? chosen.result.simulation_duration.ticks).toBe(generation!.period);
        expect(chosen.verdict).toBe(generation!.verdict);
        expect({id: chosen.id, holds: chosen.assessment.holds, rate: chosen.assessment.items_per_second,
            supply: chosen.belt?.kind ?? null}).toEqual(generation!.selection);
        expect(native.expected).toBe(generation!.expected);
    });
}
