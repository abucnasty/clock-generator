import {describe, expect, test} from "vitest";
import {BELT_SPEEDS} from "../helpers/belt-speed-fixtures";
import {GameFixturePaths} from "../helpers/fixture-paths";
import {
    expectControlIsConsistent, firstHandPatterns, PICKUP_GEOMETRIES, PICKUP_INGREDIENTS, PickupGeometry, readFixtureFigures, sidePickupConfig,
} from "../helpers/fixture-mechanics";
import {RECORDED_ON_THE_MOVING_BELT_CLOCK} from "../../../src/crafting/generate-blueprint-test-helpers";
import {BELT_PICKUP_GENERATED} from "./belt-pickup-clock-cases";
import {readControls} from "./clock-controls";
import {pickupClockConfig, pickupClockSpeedCases} from "./pickup-clock-speed-coverage";

/**
 * The belt pickup family (`pickup-clock-speed-coverage.ts`: 2 families x 4 belt tiers x 3 geometries x moving/backed up),
 * checked against what the game recorded without generating a clock: the simulator's first hand at each tier and geometry
 * against the hands the belt speed coverage recorded (speed-expectations.json), and the recorded clock controls against
 * the fixture configs. The generation test (belt-pickup-clock.generation.test.ts) generates only the cases of
 * belt-pickup-clock-cases.ts. The documented mechanic is docs/belt-pickup/timing.md "Side pickups" and docs/simulator.md.
 */

interface RecordedHands {
    /** The distinct tick patterns (`"0,1,2,3"`) of full hands of 16 the game took, over all hands of a run */
    patterns: string[];
    simulator_agrees: boolean;
    replay_agrees: boolean;
    hands: number;
    model_difference_count: number;
    replay_difference_count: number;
}
const recorded = readFixtureFigures<RecordedHands>(GameFixturePaths.DIFFERENT_ITEMS, "speed-expectations.json");

/**
 * The first hand of a backed-up belt, from the documented stack arrival: stacks of four sit a tick apart at the pickup,
 * so a hand of 16 is four stacks on ticks 0-3 where the arm reaches the whole stack row (turbo, express, and the straight
 * belt at every tier); the 0.5-tile reach of an underground at fast and normal speed takes the stack that sits further
 * away later: the fourth stack on tick 5 (fast) or 9 (normal).
 */
function backedFirstHand(tier: string, geometry: PickupGeometry): string {
    if (geometry === "straight-belt" || tier === "turbo" || tier === "express") return "0,1,2,3";
    return tier === "fast" ? "0,1,2,5" : "0,1,2,9";
}

describe("first hand at each tier and geometry: the simulator against the game's recorded hands", () => {
    for (const speed of BELT_SPEEDS) for (const geometry of PICKUP_GEOMETRIES) for (const backed of [false, true]) {
        for (const ingredient of PICKUP_INGREDIENTS) {
            const name = `${speed.name}-${geometry}-${backed ? "backed" : "moving"}-${ingredient}`;
            test(name, async () => {
                const figures = recorded[name];
                expect(figures, "every tier, geometry, supply and ingredient has a recorded figure").toBeDefined();
                // the recording itself: the simulator followed the game's continuous run when it was made (the one same-item
                // run where the separate same-item replay differs once, at the normal tier, is the simulator agreeing)
                expect({agrees: figures.simulator_agrees, differences: figures.model_difference_count}).toEqual({agrees: true, differences: 0});
                expect(figures.replay_difference_count, "replay differences").toBe(name === "normal-underground-entrance-moving-same-item" ? 1 : 0);
                const simulated = [...firstHandPatterns(await sidePickupConfig(speed, geometry, backed, ingredient))];
                if (backed) {
                    // a jammed belt has one first hand, and the game recorded it among the hands of its run (the later
                    // hands of a run are the depleted ones: normal straight 0,1,6,14 then 0,8,16,24)
                    expect(simulated).toHaveLength(1);
                    expect(figures.patterns).toContain(simulated[0]);
                    expect(simulated[0]).toBe(ingredient === "same-item" ? "0,1,2,3" : backedFirstHand(speed.name, geometry));
                } else {
                    // the game starts a pickup tile in one of eight lane phases and a run keeps its phase, so a run shows
                    // some of the simulator's eight first hands and the hands that follow them; at least one is shared
                    expect(simulated.filter(pattern => figures.patterns.includes(pattern)), "a first hand the game recorded").not.toEqual([]);
                }
            });
        }
    }

    test("a moving normal-tier underground entrance takes the same item in 4 ticks from half the lane phases and 5 from the rest", async () => {
        // docs/belt-pickup/timing.md "Side pickups"
        const normal = BELT_SPEEDS.find(speed => speed.name === "normal")!;
        const hands = firstHandPatterns(await sidePickupConfig(normal, "underground-entrance", false, "same-item"));
        expect([...hands].sort()).toEqual(["0,1,2,3", "0,1,3,4"]);
    });
});

describe("the recorded clock controls of the belt pickup fixtures", () => {
    const controls = readControls("pickup-clock-controls.json").cases;
    const movingPhases = readControls<{moving_phase: {cases: object}; recovery_phase: {cases: object}}>("lane-phase-controls.json");
    const names = (["electromagnetic", "same-item"] as const).flatMap(family => pickupClockSpeedCases(family));

    test("there is a control with a native summary and a pin for each of the 48 fixtures", () => {
        expect(names).toHaveLength(48);
        for (const variant of names) {
            expect(controls[variant.name]?.native, variant.name).toBeDefined();
            expect(controls[variant.name]?.generation, variant.name).toBeDefined();
        }
    });

    test.each(names.map(variant => variant.name))("%s: the game was recorded at the target rate over the pinned period", async name => {
        const variant = names.find(it => it.name === name)!;
        const config = await pickupClockConfig(variant);
        expectControlIsConsistent(controls[name].native, controls[name].generation!, config.target_output.items_per_second);
        // the rate of the target is the fixture's: the tier's belt units over four for the electromagnetic family
        if (variant.family === "electromagnetic") expect(config.target_output.items_per_second).toBe(30 * variant.speed.units / 4);
    });

    test("every control the game held and recovered is judged stable, and the exceptions are the ones documented", () => {
        const exceptions = new Set([
            ...Object.keys(movingPhases.moving_phase.cases), ...Object.keys(movingPhases.recovery_phase.cases),
        ]);
        for (const name of Object.keys(controls)) {
            const {native, generation} = controls[name];
            const meetsTarget = native.baseline.every(items => items === native.expected)
                && native.recovery.every(trial => trial.recovered.every(items => items === native.expected));
            if (exceptions.has(name)) {
                // a warm recording that holds, with a generated verdict that fails a cold lane phase the capture cannot set up
                expect(meetsTarget, `${name}: the warm recording holds`).toBe(true);
                expect(generation!.why_not_stable, name).toBe("moving lane phases");
            } else {
                expect(meetsTarget, `${name}: a recording that misses the target is not an exception`).toBe(true);
                expect(generation!.verdict, name).toBe("stable");
            }
        }
    });

    test("the cases the generation test pins to a backed-up clock are the normal-tier undergrounds", () => {
        expect([...RECORDED_ON_THE_MOVING_BELT_CLOCK.keys()].filter(name => name.startsWith("electromagnetic-")).sort())
            .toEqual(["electromagnetic-normal-underground-entrance-backed", "electromagnetic-normal-underground-exit-backed"]);
    });

    test("the generated cases are fixtures of the family, and the path each takes is stated", () => {
        for (const [name, path] of BELT_PICKUP_GENERATED) {
            expect(names.map(variant => variant.name), name).toContain(name);
            expect(path.length, name).toBeGreaterThan(10);
        }
    });
});
