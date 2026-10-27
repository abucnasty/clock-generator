import {describe, expect, test} from "vitest";
import {GameFixturePaths} from "../helpers/fixture-paths";
import {expectControlIsConsistent, firstHandPatterns, readFixtureFigures} from "../helpers/fixture-mechanics";
import {OVER_HOOD_GENERATED} from "./over-hood-clock-cases";
import {OverHoodClockCase, overHoodClockCases, overHoodClockConfig} from "./over-hood-clock-fixtures";
import {ClockHistory, readControls} from "./clock-controls";

/**
 * The over-the-hood family (`over-hood-clock-fixtures.ts`: 2 families x 4 belt tiers x 2 mirroring states x moving/backed
 * up), checked against what the game recorded without generating a clock: the simulator's first hand of each fixture
 * against the compact controls of the over-the-hood exit (expectations.json), the documented hand families per tier, and
 * the recorded clock controls against the fixture configs. The generation test (over-hood-clock.generation.test.ts)
 * generates only the cases of over-hood-clock-cases.ts. The documented mechanic is docs/belt-pickup/timing.md "Front-facing
 * and over-the-hood pickups" and experiments.md; the figures are in the over-the-hood-underground-exit fixture README.
 */

interface RecordedHand {
    crafting_speed: number;
    preferred: 1 | 2;
    offsets: number[];
    moving_differences: unknown[];
    jammed_differences: unknown[];
}
const recorded = readFixtureFigures<RecordedHand>(GameFixturePaths.OVER_THE_HOOD_UNDERGROUND_EXIT, "expectations.json");
const cases = (["different-items", "same-item"] as const).flatMap(family => overHoodClockCases(family));
const caseNamed = (name: string) => cases.find(variant => variant.name === name)!;

/** The compact control of a fixture: `<tier>-compact-<mirroring>-<supply>-<lane contents>` (the plant layout has no normal tier) */
function figureNames(variant: OverHoodClockCase): string[] {
    const stem = `${variant.speed.name}-compact-${variant.mirrored ? "mirrored" : "unmirrored"}-${variant.backed ? "backed" : "moving"}`;
    return (variant.family === "same-item" ? ["same-item"] : ["original", "swapped"]).map(content => `${stem}-${content}`);
}
const offsetsOf = (pattern: string) => pattern.split(",").map(Number);

describe("first hand of each fixture: the simulator against the game's recorded first hands", () => {
    test.each(cases.map(variant => variant.name))("%s", name => {
        const variant = caseNamed(name);
        const config = overHoodClockConfig(variant);
        const input = config.inserters.find(inserter => inserter.source.type === "belt")!;
        if (input.source.type !== "belt") throw new Error("expected a belt input");
        const simulated = [...firstHandPatterns(config)];
        const figures = figureNames(variant).map(figure => {
            expect(recorded[figure], "every fixture has a recorded first hand").toBeDefined();
            return recorded[figure];
        });
        for (const figure of figures) {
            // the recording itself: both replays agreed with the game's first hand, the lane preferred is the mirroring's,
            // and the assembler is the compact one the fixture config states
            expect({moving: figure.moving_differences, jammed: figure.jammed_differences}).toEqual({moving: [], jammed: []});
            expect(figure.preferred).toBe(variant.mirrored ? 2 : 1);
            expect(figure.crafting_speed).toBe(config.machines[0].crafting_speed);
            expect(figure.offsets.join(","), "swapping the lane contents does not change the first hand").toBe(figures[0].offsets.join(","));
        }
        expect(input.source.near_lane, "the fixture prefers the lane the game did").toBe(figures[0].preferred);
        const recordedHand = figures[0].offsets.join(",");
        if (variant.backed) {
            // a jammed belt has one first hand
            expect(simulated).toEqual([recordedHand]);
        } else {
            // the game starts the exit in one lane phase and a run keeps it, so a run shows one of the simulator's first
            // hands (one per lane phase)
            expect(simulated, "a first hand the game recorded").toContain(recordedHand);
        }
    });

    // the over-the-hood README "Measured first hands": different items, the phase the capture started in, and the jammed belt
    const documented: Record<string, {moving: string; backed: string}> = {
        turbo: {moving: "0,1,3,5", backed: "0,1,2,3"}, express: {moving: "0,1,3,6", backed: "0,1,2,3"},
        fast: {moving: "0,1,2,6", backed: "0,1,2,5"}, normal: {moving: "0,1,4,12", backed: "0,1,2,9"},
    };
    test.each(Object.entries(documented))("%s: the documented first hands of different items, moving and backed up", async (tier, hands) => {
        for (const mirrored of [false, true]) for (const backed of [false, true]) {
            const variant = caseNamed(`over-hood-${tier}-${mirrored ? "mirrored" : "unmirrored"}-${backed ? "backed" : "moving"}-different-items`);
            expect(recorded[figureNames(variant)[0]].offsets.join(",")).toBe(backed ? hands.backed : hands.moving);
        }
    });
});

describe("the hand families across lane phases and the same item on both lanes (docs/belt-pickup/experiments.md)", () => {
    // `0,1,k,k+d` of different items on a moving belt: k and d per tier, and the total pickup ticks (the last offset plus one)
    const families: Record<string, {k: number[]; d: number[]; total: [number, number]}> = {
        turbo: {k: [2, 3], d: [2], total: [5, 6]}, express: {k: [2, 3, 4], d: [2, 3], total: [5, 8]},
        fast: {k: [2, 3, 4, 5], d: [4], total: [7, 10]}, normal: {k: [2, 3, 4, 5, 6, 7, 8, 9], d: [8], total: [11, 18]},
    };
    test.each(Object.entries(families))("%s: moving different items take 0,1,k,k+d over the lane phases", (tier, family) => {
        for (const mirrored of [false, true]) {
            const hands = [...firstHandPatterns(overHoodClockConfig(caseNamed(`over-hood-${tier}-${mirrored ? "mirrored" : "unmirrored"}-moving-different-items`)))].map(offsetsOf);
            for (const [first, second, k, last] of hands) {
                expect([first, second], "the two first grabs").toEqual([0, 1]);
                expect(family.k, `k of ${hands}`).toContain(k);
                expect(family.d, `d of ${hands}`).toContain(last - k);
                expect(last + 1).toBeGreaterThanOrEqual(family.total[0]);
                expect(last + 1).toBeLessThanOrEqual(family.total[1]);
            }
            expect(new Set(hands.map(hand => hand[2])), "every k the documentation lists occurs").toEqual(new Set(family.k));
            expect(new Set(hands.map(hand => hand[3] - hand[2])), "every d the documentation lists occurs").toEqual(new Set(family.d));
        }
    });

    test("the same item on both lanes takes 0,1,2,3 at every tier, mirroring and supply", () => {
        for (const variant of cases.filter(it => it.family === "same-item")) {
            expect([...firstHandPatterns(overHoodClockConfig(variant))], variant.name).toEqual(["0,1,2,3"]);
        }
    });
});

describe("the recorded clock controls of the over-the-hood fixtures", () => {
    const controls = readControls("over-hood-clock-controls.json").cases;
    const history = readControls<ClockHistory>("over-hood-clock-history-controls.json").cases;

    test("there is a control with a native summary and a pin for each of the 32 fixtures", () => {
        expect(cases).toHaveLength(32);
        expect(Object.keys(controls).sort()).toEqual(cases.map(variant => variant.name).sort());
        for (const variant of cases) {
            expect(controls[variant.name].native, variant.name).toBeDefined();
            expect(controls[variant.name].generation, variant.name).toBeDefined();
        }
    });

    test("the history keeps the superseded recordings of 31 fixtures, all but the one that was regenerated", () => {
        expect(cases.map(variant => variant.name).filter(name => !(name in history))).toEqual(["over-hood-normal-unmirrored-moving-different-items"]);
        expect(controls["over-hood-normal-unmirrored-moving-different-items"].recorded.clock_basis).toBe("regenerated");
        for (const name of Object.keys(history)) expect(controls[name], name).toBeDefined();
    });

    test.each(cases.map(variant => variant.name))("%s: recorded at the 6/s target over the pinned period, holding and recovering", name => {
        const variant = caseNamed(name);
        const {native, generation} = controls[name];
        const config = overHoodClockConfig(variant);
        expect(config.target_output.items_per_second).toBe(6);
        expectControlIsConsistent(native, generation!, config.target_output.items_per_second);
        // every fixture is judged stable and its recording holds: 63 undisturbed periods at the expected output, three
        // disturbances, and the last periods of each recovery back at it (at least eight for a moving belt, five for a
        // backed-up one, whose assessment starts later)
        expect({native: native.generationVerdict, pinned: generation!.verdict, why: generation!.why_not_stable}).toEqual({native: "stable", pinned: "stable", why: undefined});
        expect(native.baseline).toEqual(new Array(63).fill(native.expected));
        expect(native.recovery).toHaveLength(3);
        const heldPeriods = variant.backed ? 5 : 8;
        for (const loss of native.recovery) {
            expect(loss.recovered.length).toBeGreaterThanOrEqual(heldPeriods);
            expect(loss.recovered.slice(-heldPeriods)).toEqual(new Array(heldPeriods).fill(native.expected));
        }
        expect(generation!.selection).toMatchObject({holds: true, rate: 6});
    });

    test("the one fixture on a moving belt whose pinned clock is made for the backed-up belt", () => {
        expect(cases.filter(variant => (controls[variant.name].generation!.selection.supply === "backed_up") !== variant.backed).map(variant => variant.name))
            .toEqual(["over-hood-fast-mirrored-moving-different-items"]);
    });

    test("the same item on both lanes: mirroring does not change the clock or its recording", () => {
        for (const variant of cases.filter(it => it.family === "same-item" && !it.mirrored)) {
            const mirrored = controls[variant.name.replace("-unmirrored-", "-mirrored-")];
            expect(mirrored.generation, variant.name).toEqual(controls[variant.name].generation);
            expect(mirrored.native, variant.name).toEqual(controls[variant.name].native);
        }
    });

    test("the generated cases are fixtures of the family, and the path each takes is stated", () => {
        for (const [name, path] of OVER_HOOD_GENERATED) {
            expect(cases.map(variant => variant.name), name).toContain(name);
            expect(path.length, name).toBeGreaterThan(10);
        }
    });
});
