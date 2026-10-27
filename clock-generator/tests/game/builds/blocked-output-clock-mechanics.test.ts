import {describe, expect, test} from "vitest";
import {SerializableClockWindows} from "../../../src/crafting/clock";
import {backpressureLossOf} from "../../../src/crafting/trial";
import {BELT_SPEEDS} from "../helpers/belt-speed-fixtures";
import {GameFixturePaths} from "../helpers/fixture-paths";
import {expectControlIsConsistent, readFixtureFigures} from "../helpers/fixture-mechanics";
import {BLOCKED_OUTPUT_GENERATED} from "./blocked-output-clock-cases";
import {
    BLOCKED_OUTPUT_CRAFTING_SPEED, BLOCKED_OUTPUT_INTERVENTIONS, BLOCKED_OUTPUT_TARGET, BlockedOutputClockCase,
    blockedOutputClockCases, blockedOutputClockConfig,
} from "./blocked-output-clock-fixtures";
import {readControls} from "./clock-controls";

/**
 * The blocked-output family (`blocked-output-clock-fixtures.ts`: iron gears at 5 a second in a legendary assembler 3, its
 * output dropped onto a belt of the tier and belt stack size that is blocked for 24 periods), checked against what the game
 * recorded without generating a clock: the recorded controls state themselves, the drop figures the belt-drop calibration
 * recorded are what the documentation says, and the simulator, running a plain clock built from those figures, holds the
 * target and is back at it after the output stops being taken (block and release). The generation test
 * (blocked-output-clock.generation.test.ts) generates only the cases of blocked-output-clock-cases.ts. The documented
 * mechanic is docs/belt-pickup/experiments.md "Recovery through a blocked output" and docs/simulator.md.
 */

const controls = readControls("blocked-output-clock-controls.json").cases;
const cases = blockedOutputClockCases();

interface RecordedHand {start: number; offsets: number[]; amounts: number[]}
const drops = readFixtureFigures<RecordedHand[]>(GameFixturePaths.TURBO_BELT_DROP, "speed-expectations.json");
const firstHandOf = (variant: BlockedOutputClockCase) => drops[`${variant.speed.name}/${variant.stackSize}`][0];

/** The hand the output inserter drops: 16 items, 15 at stack size 3 (docs/belt-pickup/experiments.md) */
const handOf = (variant: BlockedOutputClockCase) => variant.stackSize === 3 ? 15 : 16;
/** Gears a clock period makes: one hand of 16 a period (192 ticks), or 120 gears a period of 1,440 where the hand is 15 */
const periodOf = (variant: BlockedOutputClockCase) => variant.stackSize === 3 ? {ticks: 1440, expected: 120} : {ticks: 192, expected: 16};

/**
 * A clock made from the recorded drop alone, with no search: the output inserter is enabled for the span of its first
 * hand (the swing to the belt, then the last drop's offset), the chest-fed input inserter for a swing at evenly spaced
 * places (two a period of 192 for 16 gears, fifteen in 1,440 ticks for 120). The input window is one swing (6 ticks)
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
    test("there is a control with a native summary and a pin for each of the 16 fixtures, and no other", () => {
        expect(cases).toHaveLength(16);
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
        expectControlIsConsistent(native, generation!, config.target_output.items_per_second);
        expect(native.target).toBe(BLOCKED_OUTPUT_TARGET);
        // five gears a second over the period: 16 in 192 ticks, or 120 in 1,440 where the hand of 15 rules out 192
        expect({period: native.period, expected: native.expected}).toEqual({period: periodOf(variant).ticks, expected: periodOf(variant).expected});
        expect(generation!.selection).toEqual({id: variant.stackSize === 3 ? "shifted-swings" : "even-hands", holds: true, rate: BLOCKED_OUTPUT_TARGET, supply: null});
        expect(generation!.verdict).toBe("stable");
        expect(native.generationVerdict).toBe("stable");
    });

    test.each(cases.map(variant => variant.name))("%s: exact in 63 baseline periods, output stops during the block, exact in all 33 periods after the release", name => {
        const {native} = controls[name];
        expect(native.interventions, "the output alone is blocked from period 66 to 90").toEqual(BLOCKED_OUTPUT_INTERVENTIONS);
        expect(native.baseline).toHaveLength(63);
        expect(native.baseline.every(items => items === native.expected)).toBe(true);
        expect(native.recovery).toHaveLength(1);
        const [{cut, during, recovered}] = native.recovery;
        expect(cut).toBe(BLOCKED_OUTPUT_INTERVENTIONS[0][0]);
        // 24 blocked periods and the one of the release
        expect(during).toHaveLength(25);
        // the game fills the belt behind the drop first, so output stops one to ten periods into the block (docs/belt-pickup/experiments.md)
        const stopped = during.indexOf(0);
        expect(stopped, "output stops").toBeGreaterThanOrEqual(1);
        expect(stopped).toBeLessThanOrEqual(10);
        expect(during.slice(stopped, -2).every(items => items === 0), "and stays stopped until the release").toBe(true);
        expect(during.at(-1)!, "the release period delivers at least the expected output").toBeGreaterThanOrEqual(native.expected);
        expect(recovered).toHaveLength(33);
        expect(recovered.every(items => items === native.expected)).toBe(true);
    });

    test("the cases the generation test generates are fixtures of the family, and the path each takes is stated", () => {
        for (const [name, path] of BLOCKED_OUTPUT_GENERATED) {
            expect(cases.map(variant => variant.name), name).toContain(name);
            expect(path.length, name).toBeGreaterThan(10);
        }
        // one case per path: the two selections the pins record
        expect(new Set([...BLOCKED_OUTPUT_GENERATED.keys()].map(name => controls[name].generation!.selection.id))).toEqual(new Set(["even-hands", "shifted-swings"]));
    });
});

describe("the simulator holds the target and recovers when the output is blocked and released, on a plain clock of each case", () => {
    test.each(cases.map(variant => variant.name))("%s", name => {
        const variant = cases.find(it => it.name === name)!;
        const {ticks, expected} = periodOf(variant);
        const report = backpressureLossOf(blockedOutputClockConfig(variant), plainClock(variant), ticks, expected, {log() {}, warn() {}, error() {}, debug() {}});
        expect(report.undisturbed.recovers, "the plain clock makes the expected output every period undisturbed").toBe(true);
        expect(report.undisturbed.recovered_after_bins).toBe(0);
        expect(report.not_tried, "the supply of plates and the gears' belt are the only losses").toEqual([]);
        expect(report.losses.map(loss => loss.loss)).toEqual([{kind: "supply", item: "iron-plate"}, {kind: "output", item: "iron-gear-wheel"}]);
        expect(report.survives, `survives ${report.broken_by.join(", ")}`).toBe(true);
        // the game judges its recovery from the 6th period after the release (docs/simulator.md: the simulator is back
        // within 1 to 6 periods of it, the game within 0 to 5)
        const blocked = report.losses.find(loss => loss.loss.kind === "output")!;
        expect(blocked.recovered_after_bins).toBeLessThanOrEqual(6);
    });
});
