import { describe, it, expect, beforeAll } from "vitest";
import { clockBeltLabel, generateClockAlternatives, type ClockAlternative } from "./generate-blueprint";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import type { Config } from "../config/schema";
import { quiet } from "./generate-blueprint-test-helpers";

const beltsDoNotMove = (config: Config): Config => ({ ...config, overrides: { ...config.overrides, non_moving_belts: true } });

// GOALS.md: a clock that only works when its inserters pick up from a belt that does not move, and a clock that also
// works when the items on the belt are moving
describe("the belt a clock is made for", () => {

    describe("clockBeltLabel", () => {
        it("names a moving belt with the ticks of belt pickup slack", () => {
            expect(clockBeltLabel({ kind: "moving", slack_ticks: [4] })).toBe("moving (+4 ticks)");
            expect(clockBeltLabel({ kind: "moving", slack_ticks: [1] })).toBe("moving (+1 tick)");
            expect(clockBeltLabel({ kind: "moving", slack_ticks: [2, 4] })).toBe("moving (+2–4 ticks)");
        });

        it("names a non-moving belt, and nothing when no clocked inserter picks up from a belt", () => {
            expect(clockBeltLabel({ kind: "non_moving" })).toBe("non-moving");
            expect(clockBeltLabel(null)).toBe("");
        });
    });

    // Two belt inserters with hands of 16 from stacks of 4. With 2 and with 1 output swing per cycle the clock does not
    // hold the expected output with the slack, so the generator leaves it out of those two.
    describe("logistic science", () => {
        let config: Config;
        // the alternatives for the belts as the config has them, for moving belts: the ones made for belts that do not move are compared with them
        let moving: ClockAlternative[];
        let moving_selected: ClockAlternative;
        const alternative = (id: string) => moving.find(a => a.id === id)!;

        beforeAll(async () => {
            config = await loadConfigFromFile(ConfigPaths.LOGISTIC_SCIENCE);
            const generated = generateClockAlternatives(config, { logger: quiet });
            moving = generated.alternatives;
            moving_selected = moving[generated.selected_index];
        });

        describe("by default", () => {
            it("makes batched swings for a moving belt, with 4 ticks of belt pickup slack", () => {
                const batched = alternative("planned-belt-slack");
                expect(batched.label).toBe("Batched swings: 4 output swings per cycle");
                expect(batched.belt).toEqual({ kind: "moving", slack_ticks: [4] });
                expect(batched.description).toContain("Made for a moving belt: every inserter that picks up from a belt stays enabled 4 more ticks");
            });

            it("offers batched swings for a non-moving belt as a clock of its own", () => {
                const non_moving = alternative("planned");
                expect(non_moving.label).toBe("Batched swings, non-moving belt: 4 output swings per cycle");
                expect(non_moving.belt).toEqual({ kind: "non_moving" });
                expect(non_moving.ranking.matches_belt_choice).toBe(false);
                expect(non_moving.description).toContain("Made for a non-moving belt");
            });

            it("names a clock it left the slack out of a non-moving belt clock, and says why", () => {
                expect(moving.filter(a => a.belt?.kind === "non_moving").map(a => a.id)).toEqual(["planned", "swings-2", "swings-1"]);
                expect(alternative("swings-2").ranking.matches_belt_choice).toBe(false);
                expect(alternative("swings-2").description).toContain("This clock did not hold the expected output with the slack");
            });

            it("selects a clock for a moving belt over the non-moving belt clock with no wake-ups", () => {
                expect(alternative("swings-2").assessment.wake_ups_per_minute).toBe(0);
                expect(alternative("swings-2").ranking.meets_target_rate).toBe(true);
                expect(moving_selected.id).toBe("swings-3");
                expect(moving_selected.belt).toEqual({ kind: "moving", slack_ticks: [4] });
            });
        });

        describe("with belts that do not move", () => {
            let alternatives: ClockAlternative[];
            let selected: ClockAlternative;

            beforeAll(() => {
                const generated = generateClockAlternatives(beltsDoNotMove(config), { logger: quiet });
                alternatives = generated.alternatives;
                selected = alternatives[generated.selected_index];
            });

            it("gives no clock belt pickup slack, as each holds the expected output without it", () => {
                expect(alternatives.map(a => a.belt)).toEqual(alternatives.map(() => ({ kind: "non_moving" })));
                expect(alternatives.every(a => Object.keys(a.result.belt_pickup_slack_ticks).length === 0)).toBe(true);
            });

            it("lists batched swings once, with the windows of the non-moving belt clock", () => {
                expect(alternatives.filter(a => a.label.startsWith("Batched swings")).map(a => a.id)).toEqual(["planned-belt-slack"]);
                expect(alternatives[0].label).toBe("Batched swings: 4 output swings per cycle");
                expect(alternatives[0].result.clock_windows).toEqual(alternative("planned").result.clock_windows);
                expect(alternatives[0].description).toContain("The config says the belts do not move");
            });

            it("holds no clock to the slack, and selects the one with the fewest wake-ups", () => {
                expect(alternatives.every(a => a.ranking.matches_belt_choice)).toBe(true);
                expect(selected.id).toBe("swings-2");
                expect(selected.assessment.wake_ups_per_minute).toBe(0);
            });
        });
    });

    // Two belt inserters that each take two ingredients off a belt split between them, each from the lane nearest to
    // it first. Batched swings holds the target rate without the slack: recorded on the scaffold on 2026-10-10, 192 in
    // every period. With 2 and with 1 output swings per cycle a clock only holds with the slack, and with belts that
    // do not move it is offered without and listed as unstable: until 2026-10-10 such a clock was made again with the
    // slack and listed as a clock for a moving belt.
    describe("utility science, with belts that do not move", () => {
        let alternatives: ClockAlternative[];
        let selected: ClockAlternative;
        const alternative = (id: string) => alternatives.find(a => a.id === id)!;

        beforeAll(async () => {
            const config = await loadConfigFromFile(ConfigPaths.UTILITY_SCIENCE);
            const generated = generateClockAlternatives(beltsDoNotMove(config), { logger: quiet });
            alternatives = generated.alternatives;
            selected = alternatives[generated.selected_index];
        });

        it("makes every clock without the slack, also one that only holds with it", () => {
            expect(alternatives.map(a => a.belt)).toEqual(alternatives.map(() => ({ kind: "non_moving" })));
            expect(alternatives.every(a => a.ranking.matches_belt_choice)).toBe(true);
            const two_swings = alternative("swings-2");
            expect(two_swings.verdict).not.toBe("stable");
            expect(two_swings.result.belt_pickup_slack_ticks).toEqual({});
        });

        it("has batched swings hold the target rate without the slack, at no wake-ups at all", () => {
            const batched = alternative("planned-belt-slack");
            expect(batched.belt).toEqual({ kind: "non_moving" });
            expect(batched.verdict).not.toBe("unstable");
            expect(batched.assessment.wake_ups_per_minute).toBe(0);
        });

        // The build has a deadlock risk (GOALS.md, "Two inserters that bring the same item"), which the trials for
        // backpressure loss do not see: uneven output swings gets back from every loss in the simulator and made 0 of
        // 192 a period in the game, where batched swings made 192. So on this build the verdict does not decide.
        it("selects it though the build does not get back to its rate under it once the packs have not been taken away for a while", () => {
            const batched = alternative("planned-belt-slack");
            expect(batched.assessment.backpressure_loss).toMatchObject({ survives: false, broken_by: ["utility-science-pack is not taken away"] });
            expect(batched.verdict).not.toBe("stable");
            expect(batched.deadlock_risks).toHaveLength(1);
            expect(batched.ranking.meets_target_rate).toBe(true);
            expect(selected.id).toBe("planned-belt-slack");
            // the clocks that do get back hold the rate at more wake-ups
            const uneven = alternative("uneven-output");
            expect(uneven.verdict).toBe("stable");
            expect(uneven.assessment.wake_ups_per_minute!).toBeGreaterThan(0);
        });
    });

    // Three inserters take bioflux off a belt for their biochambers, and the nutrients the biochambers burn. Without
    // room for a hand of nutrients the windows of batched swings close on partly filled hands of bioflux: recorded on
    // the scaffold, 377 of 400 a period. With it the clock is the one that has belt pickup slack with belts that move,
    // which the game tests record at 400 in every period.
    describe("agricultural science, with belts that do not move", () => {
        let selected: ClockAlternative;
        let batched: ClockAlternative;

        beforeAll(async () => {
            const config = await loadConfigFromFile(ConfigPaths.AGRICULTURAL_SCIENCE);
            const generated = generateClockAlternatives(beltsDoNotMove(config), { logger: quiet });
            selected = generated.alternatives[generated.selected_index];
            batched = generated.alternatives.find(a => a.id === "planned-belt-slack")!;
        });

        it("makes batched swings with room for a hand of fuel, as a clock for a belt that does not move, and it holds the target rate", () => {
            expect(batched.label).toBe("Batched swings: 5 output swings per cycle");
            expect(batched.verdict).not.toBe("unstable");
            expect(batched.belt).toEqual({ kind: "non_moving" });
            expect(batched.ranking.matches_belt_choice).toBe(true);
            expect(batched.result.belt_pickup_slack_ticks).toEqual({});
            expect(batched.result.fuel_hand_room_ticks).toEqual({ "inserter:1": 4, "inserter:2": 4, "inserter:11": 4 });
            expect(batched.description).toContain("Inserters 1, 2 and 11 take fuel off the belt as well as an ingredient and stay enabled 4 more ticks");
        });

        // It was the clock selected until a clock had to get back from a backpressure loss as well (GOALS.md)
        it("does not select it: the build does not get back to its rate under it once the nutrients have run out", () => {
            expect(batched.assessment.backpressure_loss).toMatchObject({ survives: false, broken_by: ["nutrients stops arriving"] });
            expect(selected.id).toBe("swings-2");
            expect(selected.ranking.meets_target_rate).toBe(true);
            expect(selected.belt).toEqual({ kind: "non_moving" });
        });

        it("lengthens every window of those inserters by the fill of a hand of nutrients", () => {
            const windows = batched.result.clock_windows;
            expect(windows["inserter:11"]).toEqual([0, 96, 192, 288, 384].map(start => ({ start, end: start + 42 })));
            expect(windows["inserter:1"]).toEqual([0, 96, 192, 288, 384].map(start => ({ start, end: start + 20 })));
            expect(windows["inserter:2"]).toEqual(windows["inserter:1"]);
        });
    });

    // One belt inserter that takes two ingredients off a belt split between them. Batched swings moves more than the
    // expected output, with the slack and without it; full-hand output swings holds it, also without the slack.
    describe("automation science, with belts that do not move", () => {
        let alternatives: ClockAlternative[];
        let selected: ClockAlternative;

        beforeAll(async () => {
            const config = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE);
            const generated = generateClockAlternatives(beltsDoNotMove(config), { logger: quiet });
            alternatives = generated.alternatives;
            selected = alternatives[generated.selected_index];
        });

        it("makes full-hand output swings from batched swings that move more than the expected output", () => {
            const batched = alternatives.find(a => a.id === "planned-belt-slack")!;
            expect(batched.verdict).not.toBe("stable");
            expect(batched.result.stability_check.as_built?.actual_output_items).toBe(48);
            expect(batched.result.stability_check.expected_output_items).toBe(32);
            expect(alternatives.map(a => a.id)).toEqual(["planned-belt-slack", "full-hand"]);
        });

        it("selects full-hand output swings without the slack", () => {
            expect(selected.id).toBe("full-hand");
            expect(selected.ranking.meets_target_rate).toBe(true);
            expect(selected.belt).toEqual({ kind: "non_moving" });
            expect(selected.result.clock_windows).toEqual({
                "inserter:1": [{ start: 1, end: 23 }],
                "inserter:2": [{ start: 0, end: 3 }, { start: 36, end: 39 }],
            });
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
