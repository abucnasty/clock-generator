import {describe, expect, test} from "vitest";
import {CLOCK_TEST_SPEEDS} from "../helpers/belt-speed-fixtures";
import {expectRunIsConsistent, firstHandPatterns} from "../helpers/fixture-mechanics";
import {FRONT_GENERATED} from "./front-clock-cases";
import {frontClockConfig, FrontClockCase, frontEntranceClockCases, frontExitClockCases} from "./front-clock-fixtures";
import {readControls, runHolds, RunControls} from "./clock-controls";

/**
 * The front underground entrance and exit family (`front-clock-fixtures.ts`, turbo: 8 entrance clocks and 4 exit clocks),
 * checked against what the game recorded without generating a clock: the simulator's first hand at each tier against the
 * hands in the fixture folders' READMEs and docs/belt-pickup/timing.md, and the recorded clock controls against the fixture
 * configs. The generation test (front-pickup-clock.generation.test.ts) generates only the cases of front-clock-cases.ts.
 */

const BACKED_FIRST_HAND = {turbo: "0,1,2,3", express: "0,1,2,3", fast: "0,1,2,5", normal: "0,1,2,9"} as const;

/**
 * The first hands of a moving entrance at each tier, over all lane phases the game starts a pickup tile in (the
 * "Moving supply phases" table of the entrance README: `0,1,k,k+d`): turbo k = 2..3, d = 2; express k = 2..4, d = 2..3;
 * fast k = 2..5, d = 4; normal k = 2..9, d = 8.
 */
const MOVING_FIRST_HANDS = {
    turbo: ["0,1,2,4", "0,1,3,5"],
    express: ["0,1,2,4", "0,1,2,5", "0,1,3,5", "0,1,3,6", "0,1,4,6", "0,1,4,7"],
    fast: ["0,1,2,6", "0,1,3,7", "0,1,4,8", "0,1,5,9"],
    normal: [2, 3, 4, 5, 6, 7, 8, 9].map(k => `0,1,${k},${k + 8}`),
} as const;

const sorted = (hands: Set<string>) => [...hands].sort();
const totalTicks = (pattern: string) => Number(pattern.split(",").pop()) + 1;

describe("front entrance: the simulator's first hand at each tier against the recorded hands", () => {
    for (const speed of CLOCK_TEST_SPEEDS) for (const mirrored of [false, true]) {
        const side = mirrored ? "mirrored" : "unmirrored";
        const variant = (family: "different-items" | "same-item", backed: boolean) => frontEntranceClockCases(family)
            .find(it => it.speed.name === speed.name && it.mirrored === mirrored && it.backed === backed)!;

        test(`${speed.name} ${side}, different items, moving: every lane phase's hand is the recorded set`, async () => {
            expect(sorted(firstHandPatterns(await frontClockConfig(variant("different-items", false))))).toEqual([...MOVING_FIRST_HANDS[speed.name]].sort());
        });

        test(`${speed.name} ${side}, different items, backed up: the saturated hand`, async () => {
            expect(sorted(firstHandPatterns(await frontClockConfig(variant("different-items", true))))).toEqual([BACKED_FIRST_HAND[speed.name]]);
        });

        test(`${speed.name} ${side}, the same item on both lanes: four consecutive grabs, moving or backed up`, async () => {
            for (const backed of [false, true]) {
                expect(sorted(firstHandPatterns(await frontClockConfig(variant("same-item", backed)))), `backed=${backed}`).toEqual(["0,1,2,3"]);
            }
        });
    }

    test("the moving ranges of docs/belt-pickup/timing.md: 5-6, 5-8, 7-10 and 11-18 ticks in all", () => {
        // the documented "Observed moving pickup range, different items" is the spread of the pattern sets above
        const range = (tier: keyof typeof MOVING_FIRST_HANDS) => {
            const totals = MOVING_FIRST_HANDS[tier].map(totalTicks);
            return [Math.min(...totals), Math.max(...totals)];
        };
        expect([range("turbo"), range("express"), range("fast"), range("normal")]).toEqual([[5, 6], [5, 8], [7, 10], [11, 18]]);
    });
});

describe("front exit: the simulator's first hand at each tier against the recorded hands", () => {
    const exit = (speedName: string, mirrored: boolean, backed: boolean) => frontExitClockCases(backed)
        .find(it => it.speed.name === speedName && it.mirrored === mirrored)!;

    for (const speed of CLOCK_TEST_SPEEDS) for (const mirrored of [false, true]) {
        const side = mirrored ? "mirrored" : "unmirrored";

        test(`${speed.name} ${side}, different items: the backed-up hand, with the fourth stack arriving after the hidden line refills`, async () => {
            expect(sorted(firstHandPatterns(await frontClockConfig(exit(speed.name, mirrored, true))))).toEqual([BACKED_FIRST_HAND[speed.name]]);
            // the refill the exit README gives as the candidate rule: the fourth offset is 1 + floor(64 / belt speed in 256ths of
            // a tile per tick), which is 8 per tick for each unit of the tier's speed
            expect(Number(BACKED_FIRST_HAND[speed.name].split(",")[3])).toBe(1 + Math.floor(64 / (speed.units * 8)));
        });

        test(`${speed.name} ${side}, the same item on both lanes: the other lane fills the fourth grab at every tier`, async () => {
            const config = await frontClockConfig(exit(speed.name, mirrored, true));
            for (const lane of config.belts.find(belt => belt.id === 2)!.lanes) lane.ingredient = "accumulator";
            expect(sorted(firstHandPatterns(config))).toEqual(["0,1,2,3"]);
        });

        test(`${speed.name} ${side}, a moving config: planned from the moving entrance's lane phases, which the exit cannot have`, async () => {
            // the exit's inserter stands on its output tile: the belt is backed up in the game whatever the config says, so the
            // game shows only the backed-up hand, while a moving config is judged from the hands of a moving belt
            expect(sorted(firstHandPatterns(await frontClockConfig(exit(speed.name, mirrored, false))))).toEqual([...MOVING_FIRST_HANDS[speed.name]].sort());
        });
    }
});

describe("the recorded clock controls of the front fixtures", () => {
    const controls = readControls<RunControls>("front-clock-controls.json").cases;
    const variants: FrontClockCase[] = [...frontEntranceClockCases("different-items"), ...frontEntranceClockCases("same-item"),
        ...frontExitClockCases(true), ...frontExitClockCases(false)];

    test("there is a control with a native summary and a pin for each of the 12 fixtures", () => {
        expect(variants).toHaveLength(12);
        expect(Object.keys(controls).sort()).toEqual(variants.map(variant => variant.name).sort());
        for (const variant of variants) {
            expect(controls[variant.name].native, variant.name).toBeDefined();
            expect(controls[variant.name].generation, variant.name).toBeDefined();
        }
    });

    test.each(variants.map(variant => variant.name))("%s: the game was recorded at the target rate over the pinned period", async name => {
        const variant = variants.find(it => it.name === name)!;
        const config = await frontClockConfig(variant);
        expectRunIsConsistent(controls[name].native, controls[name].generation!, config.target_output.items_per_second);
        // the targets: 6/s on the compact entrance scaffold, the tier's belt units over four times 30/s on the exit's plant
        expect(config.target_output.items_per_second).toBe(variant.endpoint === "entrance" ? 6 : 30 * variant.speed.units / 4);
    });

    test("all 12 recordings hold their target and recover from every disturbance", () => {
        for (const variant of variants) expect(runHolds(controls[variant.name].native), `${variant.name}: ${controls[variant.name].native.result}`).toBe(true);
    });

    test("the generator judged every turbo clock stable, the moving-config exits included", () => {
        for (const variant of variants) {
            expect(controls[variant.name].generation!.verdict, variant.name).toBe("stable");
            expect(controls[variant.name].generation!.why_not_stable, variant.name).toBeUndefined();
        }
    });

    test("the generated cases are fixtures of the family, and the path each takes is stated", () => {
        for (const [name, path] of FRONT_GENERATED) {
            expect(variants.map(variant => variant.name), name).toContain(name);
            expect(path.length, name).toBeGreaterThan(10);
        }
    });
});
