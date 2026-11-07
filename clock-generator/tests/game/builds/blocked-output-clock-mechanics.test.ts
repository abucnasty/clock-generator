import {describe, expect, test} from "vitest";
import {SerializableClockWindows} from "../../../src/crafting/clock";
import {disturbanceTrialOf} from "../../../src/crafting/trial";
import {BELT_SPEEDS} from "../helpers/belt-speed-fixtures";
import {GameFixturePaths} from "../helpers/fixture-paths";
import {expectRunIsConsistent, readFixtureFigures} from "../helpers/fixture-mechanics";
import {BLOCKED_OUTPUT_GENERATED} from "./blocked-output-clock-cases";
import {
    BLOCKED_OUTPUT_CRAFTING_SPEED, BLOCKED_OUTPUT_TARGET, BlockedOutputClockCase,
    blockedOutputClockCases, blockedOutputClockConfig,
} from "./blocked-output-clock-fixtures";
import {readControls, runHolds, RunControls} from "./clock-controls";

/**
 * The blocked-output family (`blocked-output-clock-fixtures.ts`: iron gears at 5 a second in a legendary assembler 3, its
 * output dropped onto a turbo belt at belt stack sizes 1-4, blocked until the output falls), checked against what the game
 * recorded without generating a clock: the recorded controls state themselves, the drop figures the belt-drop calibration
 * recorded are what the documentation says, and the simulator, running a plain clock built from those figures, holds the
 * target and is back at it after the output stops being taken (block and release). The generation test
 * (blocked-output-clock.generation.test.ts) generates only the cases of blocked-output-clock-cases.ts. The documented
 * mechanic is docs/belt-pickup/experiments.md "Recovery through a blocked output" and docs/simulator.md.
 */

const controls = readControls<RunControls>("blocked-output-clock-controls.json").cases;
const cases = blockedOutputClockCases();

interface RecordedHand {start: number; offsets: number[]; amounts: number[]}
const drops = readFixtureFigures<RecordedHand[]>(GameFixturePaths.TURBO_BELT_DROP, "speed-expectations.json");
const firstHandOf = (variant: BlockedOutputClockCase) => drops[`${variant.speed.name}/${variant.stackSize}`][0];

/**
 * The clock the generator selects: a hand of 15 is shifted-swings; a hand of 16 is even-hands, or planned-belt-slack where
 * it ties with even-hands (stacks 2 and 4 with no wake-ups, an arm that swings back from a drop that emptied its hand not
 * counted; stack 1 at 18.848 wake-ups a minute with its windows made by arithmetic) and wins the tie
 */
const PLANNED_SELECTED = new Set(["turbo-stack-1", "turbo-stack-2", "turbo-stack-4"].map(name => `blocked-output-${name}`));
const selectedClockOf = (variant: BlockedOutputClockCase) =>
    variant.stackSize === 3 ? "shifted-swings" : PLANNED_SELECTED.has(variant.name) ? "planned-belt-slack" : "even-hands";

/** The hand the output inserter drops: 16 items, 15 at stack size 3 (docs/belt-pickup/experiments.md) */
const handOf = (variant: BlockedOutputClockCase) => variant.stackSize === 3 ? 15 : 16;
/** Gears a window cycle makes: one hand of 16 a window cycle (192 ticks), or 120 gears a window cycle of 1,440 where the hand is 15 */
const windowCycleOf = (variant: BlockedOutputClockCase) => variant.stackSize === 3 ? {ticks: 1440, expected: 120} : {ticks: 192, expected: 16};

/**
 * A clock made from the recorded drop alone, with no search: the output inserter is enabled for the span of its first
 * hand (the swing to the belt, then the last drop's offset), the chest-fed input inserter for a swing at evenly spaced
 * places (two a window cycle of 192 for 16 gears, fifteen in 1,440 ticks for 120). The input window is one swing (6 ticks)
 * where the hand is 16; at stack size 3 one swing does not hold the target and two swings (13 ticks) do.
 */
function plainClock(variant: BlockedOutputClockCase): SerializableClockWindows {
    const hand = firstHandOf(variant);
    const span = hand.start + hand.offsets.at(-1)!;
    if (variant.stackSize !== 3) {
        return {"inserter:1": [{start: 0, end: span}], "inserter:2": [{start: 0, end: 6}, {start: 96, end: 102}]};
    }
    return {
        "inserter:1": Array.from({length: 8}, (_, hands) => ({start: hands * 180, end: hands * 180 + span})),
        "inserter:2": Array.from({length: 15}, (_, hands) => ({start: hands * 96, end: hands * 96 + 13})),
    };
}

describe("the drop figures the cases rest on (belt-drop turbo-stacks calibration)", () => {
    test.each(cases.map(variant => variant.name))("%s: a full hand drops in stacks of the belt stack size, the first drop 6 ticks in", name => {
        const variant = cases.find(it => it.name === name)!;
        const hand = firstHandOf(variant);
        expect(hand.start, "the swing to the belt").toBe(6);
        expect(hand.amounts.every(amount => amount === variant.stackSize), "every drop is one stack").toBe(true);
        expect(hand.amounts.reduce((sum, amount) => sum + amount, 0), "items in the hand").toBe(handOf(variant));
        expect(hand.offsets.slice(0, 2), "the first two stacks follow on consecutive ticks").toEqual([0, 1]);
    });

    test("the turbo belt drops a hand at stack sizes 1-4 on the ticks the calibration documents", () => {
        // tests/game/mechanics/belt-drop/fixtures/turbo-stacks/README.md "Findings"
        const turbo = BELT_SPEEDS.find(speed => speed.name === "turbo")!;
        const offsets = (stackSize: 1 | 2 | 3 | 4) => firstHandOf({name: "", speed: turbo, stackSize}).offsets;
        expect(offsets(1)).toEqual([0, 1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28]);
        expect(offsets(2)).toEqual([0, 1, 2, 4, 6, 8, 10, 12]);
        expect(offsets(3)).toEqual([0, 1, 2, 4, 6]);
        expect(offsets(4)).toEqual([0, 1, 2, 4]);
    });

    test("the target is 80% of the machine and two thirds of a normal lane at stack size 1", () => {
        // blocked-output-clock-fixtures.ts: an assembler 3 with the gear recipe (0.5 s) makes 6.25 gears a second
        expect(BLOCKED_OUTPUT_TARGET / (BLOCKED_OUTPUT_CRAFTING_SPEED / 0.5)).toBe(0.8);
        // a normal belt lane carries 7.5 items a second (15 a belt, 2 lanes); a lane of 1-item stacks is the plain lane
        const normal = BELT_SPEEDS.find(speed => speed.name === "normal")!;
        expect(BLOCKED_OUTPUT_TARGET / (7.5 * normal.units)).toBeCloseTo(2 / 3, 10);
    });
});

describe("the recorded controls of the blocked-output fixtures", () => {
    test("there is a control with a native summary and a pin for each of the 4 fixtures, and no other", () => {
        expect(cases).toHaveLength(4);
        expect(Object.keys(controls).sort()).toEqual(cases.map(variant => variant.name).sort());
        for (const variant of cases) {
            expect(controls[variant.name].native, variant.name).toBeDefined();
            expect(controls[variant.name].generation, variant.name).toBeDefined();
        }
    });

    test.each(cases.map(variant => variant.name))("%s: recorded at the target rate over the pinned period, stable, with the hand's clock", name => {
        const variant = cases.find(it => it.name === name)!;
        const {native, generation} = controls[name];
        const config = blockedOutputClockConfig(variant);
        expectRunIsConsistent(native, generation!, config.setpoint.items_per_second);
        expect(native.target).toBe(BLOCKED_OUTPUT_TARGET);
        // five gears a second over the window cycle: 16 in 192 ticks, or 120 in 1,440 where the hand of 15 rules out 192
        expect({period: native.period, expected: generation!.expected}).toEqual({period: windowCycleOf(variant).ticks, expected: windowCycleOf(variant).expected});
        expect(generation!.selection).toEqual({id: selectedClockOf(variant), holds: true, rate: BLOCKED_OUTPUT_TARGET, supply: null});
        expect(generation!.verdict).toBe("stable");
        expect(native.generationVerdict).toBe("stable");
    });

    test.each(cases.map(variant => variant.name))("%s: holds its target, the output block reduces output, and the run is back at the target after the release", name => {
        const {native} = controls[name];
        expect(native.disturbances.map(disturbance => disturbance.kind), "the output alone is blocked").toEqual(["block output"]);
        expect(runHolds(native), native.result).toBe(true);
    });

    test("the cases the generation test generates are fixtures of the family, and the path each takes is stated", () => {
        for (const [name, path] of BLOCKED_OUTPUT_GENERATED) {
            expect(cases.map(variant => variant.name), name).toContain(name);
            expect(path.length, name).toBeGreaterThan(10);
        }
        // one case per path: the two selections the pins record
        expect(new Set([...BLOCKED_OUTPUT_GENERATED.keys()].map(name => controls[name].generation!.selection.id))).toEqual(new Set(["planned-belt-slack", "shifted-swings"]));
    });
});

describe("the simulator holds the target and recovers when the output is blocked and released, on a plain clock of each case", () => {
    test.each(cases.map(variant => variant.name))("%s", name => {
        const variant = cases.find(it => it.name === name)!;
        const {ticks, expected} = windowCycleOf(variant);
        const report = disturbanceTrialOf(blockedOutputClockConfig(variant), plainClock(variant), ticks, expected, {log() {}, warn() {}, error() {}, debug() {}});
        expect(report.undisturbed.recovers, "the plain clock makes the expected output every period undisturbed").toBe(true);
        expect(report.undisturbed.recovered_after_bins).toBe(0);
        expect(report.not_tried, "the supply of plates and the gears' belt are the only losses").toEqual([]);
        expect(report.losses.map(loss => loss.loss)).toEqual([{kind: "supply", item: "iron-plate"}, {kind: "output", item: "iron-gear-wheel"}]);
        expect(report.survives, `survives ${report.broken_by.join(", ")}`).toBe(true);
        // the game judges its recovery from the 6th window cycle after the release (docs/simulator.md: the simulator is back
        // within 1 to 6 window cycles of it, the game within 0 to 5)
        const blocked = report.losses.find(loss => loss.loss.kind === "output")!;
        expect(blocked.recovered_after_bins).toBeLessThanOrEqual(6);
    });
});
