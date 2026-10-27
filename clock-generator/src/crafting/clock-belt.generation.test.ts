import { describe, it, expect, beforeAll } from "vitest";
import { clockBeltLabel, generateClockAlternatives, type ClockAlternative, type ClockAlternativesResult } from "./generate-blueprint";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import type { Config } from "../config/schema";
import { alwaysOnReasonProblemsOf, quiet } from "./generate-blueprint-test-helpers";
import { pickupClockConfig, pickupClockSpeedCases } from "../../tests/game/builds/pickup-clock-speed-coverage";
import { expectPinnedScaffoldClock } from "../../tests/game/builds/scaffold-recordings-clock-pins";

const backedUpBelts = (config: Config): Config => ({ ...config, overrides: { ...config.overrides, backed_up_belts: true } });

// GOALS.md: a clock that only works when its inserters pick up from a backed-up belt, and a clock that also
// works when the items on the belt are moving
describe("the belt a clock is made for", () => {

    describe("clockBeltLabel", () => {
        it("names a moving belt with the ticks of belt pickup slack", () => {
            expect(clockBeltLabel({ kind: "moving", slack_ticks: [4] })).toBe("moving (+4 ticks)");
            expect(clockBeltLabel({ kind: "moving", slack_ticks: [1] })).toBe("moving (+1 tick)");
            expect(clockBeltLabel({ kind: "moving", slack_ticks: [2, 4] })).toBe("moving (+2–4 ticks)");
        });

        it("names a backed-up belt, and nothing when no clocked inserter picks up from a belt", () => {
            expect(clockBeltLabel({ kind: "backed_up" })).toBe("backed-up");
            expect(clockBeltLabel(null)).toBe("");
        });
    });

    // Three inserters take bioflux off a belt for their biochambers, and the nutrients the biochambers burn. Without
    // room for a hand of nutrients the windows of batched swings close on partly filled hands of bioflux: recorded on
    // the scaffold, 377 of 400 a period. With it the clock is the one that has belt pickup slack with belts that move,
    // which the game tests record at 400 in every period.
    describe("agricultural science, with backed-up belts", () => {
        let selected: ClockAlternative;
        let batched: ClockAlternative;
        let problems: string[];

        beforeAll(async () => {
            const config = await loadConfigFromFile(ConfigPaths.AGRICULTURAL_SCIENCE);
            const generated = generateClockAlternatives(backedUpBelts(config), { logger: quiet });
            problems = alwaysOnReasonProblemsOf(backedUpBelts(config), generated);
            selected = generated.alternatives[generated.selected_index];
            batched = generated.alternatives.find(a => a.id === "planned-belt-slack")!;
        });

        it("names why every inserter and drill a clock leaves always on is", () => {
            expect(problems).toEqual([]);
        });

        it("makes batched swings with room for a hand of fuel, as a clock for a backed-up belt, and it holds the target rate", () => {
            expect(batched.label).toBe("Batched swings: 5 output swings per cycle");
            expect(batched.verdict).not.toBe("unstable");
            expect(batched.belt).toEqual({ kind: "backed_up" });
            expect(batched.ranking.matches_belt_choice).toBe(true);
            expect(batched.result.belt_pickup_slack_ticks).toEqual({});
            expect(batched.result.fuel_hand_room_ticks).toEqual({ "inserter:1": 4, "inserter:2": 4, "inserter:11": 4 });
            expect(batched.description).toContain("Inserters 1, 2 and 11 take fuel off the belt as well as an ingredient and stay enabled 4 more ticks");
        });

        // It was the clock selected until a clock had to get back from a backpressure loss as well (GOALS.md), and from
        // then the 2-swing clock was, since the build did not get back to its rate under it once the nutrients had run
        // out. Since the rules of issue 152 (GOALS.md, "When a waiting inserter acts") its nutrients trials dip a hand only
        // late in their 40 periods, and since such a trial runs on until 40 periods at its rate follow (docs/stability.md)
        // it gets back from every loss and is selected again.
        it("selects it: the build gets back to its rate under it from every loss", () => {
            expect(batched.assessment.backpressure_loss).toMatchObject({ survives: true, broken_by: [] });
            expect(selected.id).toBe("planned-belt-slack");
            expect(selected.ranking.meets_target_rate).toBe(true);
            expect(selected.belt).toEqual({ kind: "backed_up" });
        });

        // The values the scaffold recordings expect of this build with backed-up belts were seen on one clock. The build is
        // generated here, from the same config, and not again for that test (scaffold-recordings-clock.generation.test.ts).
        it("selects the clock the values of the scaffold recordings of this build were seen on", () => {
            expectPinnedScaffoldClock("agricultural science (belts are backed up)", { config: ConfigPaths.AGRICULTURAL_SCIENCE, backed_up_belts: true }, selected);
        });

        it("lengthens every window of those inserters by the fill of a hand of nutrients", () => {
            const windows = batched.result.clock_windows;
            expect(windows["inserter:11"]).toEqual([0, 96, 192, 288, 384].map(start => ({ start, end: start + 42 })));
            expect(windows["inserter:1"]).toEqual([0, 96, 192, 288, 384].map(start => ({ start, end: start + 20 })));
            expect(windows["inserter:2"]).toEqual(windows["inserter:1"]);
        });
    });

    // At normal speed a backed-up belt refills a pickup slower than a stack a tick: every clock planned for backed-up
    // supply closes its windows before the hand is full, and the selected fractional clock moved 128, 128, 96 of 176 in
    // the game, as its holds false said. A clock planned with the belts moving, given the slack and checked on the
    // backed-up belts, held in the game (recorded on 2026-10-20, #275, 176 in every period). It is no longer made:
    // clocks are made only for the belts the config names, so a backed-up config at normal speed has no stable clock
    // (issue 456).
    describe("the normal side underground exit, with backed-up belts", () => {
        let generated: ClockAlternativesResult;

        beforeAll(async () => {
            const variant = pickupClockSpeedCases("electromagnetic").find(it => it.name === "electromagnetic-normal-underground-exit-backed")!;
            generated = generateClockAlternatives(await pickupClockConfig(variant), { logger: quiet });
        });

        it("makes no clock for a moving belt, and none made for the backed-up belts is stable", () => {
            expect(generated.alternatives.length).toBeGreaterThan(0);
            expect(generated.alternatives.some(a => a.id === "planned-moving-belt")).toBe(false);
            expect(generated.alternatives.every(a => a.verdict !== "stable" && a.belt?.kind === "backed_up")).toBe(true);
            expect(generated.skipped_searches).toEqual([]);
        });

        it("selects a clock that is not stable, made for the backed-up belts the config describes", () => {
            const selected = generated.alternatives[generated.selected_index];
            expect(selected.verdict).not.toBe("stable");
            expect(selected.belt).toEqual({ kind: "backed_up" });
        });
    });

    describe("processing units, where no inserter picks up from a belt", () => {
        let alternatives: ClockAlternative[];

        beforeAll(async () => {
            const config = await loadConfigFromFile(ConfigPaths.PROCESSING_UNITS);
            ({ alternatives } = generateClockAlternatives(config, { logger: quiet }));
        });

        it("names no belt", () => {
            expect(alternatives.map(a => a.belt)).toEqual(alternatives.map(() => null));
            expect(alternatives[0].description).not.toMatch(/moving belt/);
        });
    });
});
