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

        beforeAll(async () => {
            config = await loadConfigFromFile(ConfigPaths.LOGISTIC_SCIENCE);
        });

        describe("by default", () => {
            let alternatives: ClockAlternative[];
            let selected: ClockAlternative;
            const alternative = (id: string) => alternatives.find(a => a.id === id)!;

            beforeAll(() => {
                const generated = generateClockAlternatives(config, { logger: quiet });
                alternatives = generated.alternatives;
                selected = alternatives[generated.selected_index];
            });

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
                expect(non_moving.matches_belt_choice).toBe(false);
                expect(non_moving.description).toContain("Made for a non-moving belt");
            });

            it("names a clock it left the slack out of a non-moving belt clock, and says why", () => {
                expect(alternatives.filter(a => a.belt?.kind === "non_moving").map(a => a.id)).toEqual(["planned", "swings-2", "swings-1"]);
                expect(alternative("swings-2").matches_belt_choice).toBe(false);
                expect(alternative("swings-2").description).toContain("This clock did not hold the expected output with the slack");
            });

            it("selects a clock for a moving belt over the non-moving belt clock with no wake-ups", () => {
                expect(alternative("swings-2").wake_ups_per_minute).toBe(0);
                expect(alternative("swings-2").meets_target_rate).toBe(true);
                expect(selected.id).toBe("swings-3");
                expect(selected.belt).toEqual({ kind: "moving", slack_ticks: [4] });
            });
        });

        describe("with belts that do not move", () => {
            let moving: ClockAlternative[];
            let alternatives: ClockAlternative[];
            let selected: ClockAlternative;

            beforeAll(() => {
                moving = generateClockAlternatives(config, { logger: quiet }).alternatives;
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
                expect(alternatives[0].result.clock_windows).toEqual(moving.find(a => a.id === "planned")!.result.clock_windows);
                expect(alternatives[0].description).toContain("The config says the belts do not move");
            });

            it("holds no clock to the slack, and selects the one with the fewest wake-ups", () => {
                expect(alternatives.every(a => a.matches_belt_choice)).toBe(true);
                expect(selected.id).toBe("swings-2");
                expect(selected.wake_ups_per_minute).toBe(0);
            });
        });
    });

    // Two belt inserters that each take two ingredients off a belt split between them. Without the slack, batched
    // swings runs at half the rate from some starts of the clock; with it, at the target rate from every start.
    describe("utility science, with belts that do not move", () => {
        let alternatives: ClockAlternative[];
        let selected: ClockAlternative;
        const alternative = (id: string) => alternatives.find(a => a.id === id)!;

        beforeAll(async () => {
            const config = await loadConfigFromFile(ConfigPaths.UTILITY_SCIENCE);
            const generated = generateClockAlternatives(beltsDoNotMove(config), { logger: quiet });
            alternatives = generated.alternatives;
            selected = alternatives[generated.selected_index];
        }, 60_000);

        it("falls back to the clock for a moving belt where a clock only holds with the slack", () => {
            const batched = alternative("planned-belt-slack");
            expect(batched.is_stable).toBe(true);
            expect(batched.belt).toEqual({ kind: "moving", slack_ticks: [4] });
            expect(batched.result.belt_pickup_slack_ticks).toEqual({ "inserter:1": 4, "inserter:2": 4 });
            expect(batched.description).toContain("this clock did not hold the expected output without the slack");
        });

        it("keeps a clock without the slack when it does not hold with it either", () => {
            const four_swings = alternative("swings-4");
            expect(four_swings.is_stable).toBe(false);
            expect(four_swings.belt).toEqual({ kind: "non_moving" });
            expect(four_swings.matches_belt_choice).toBe(true);
        });

        it("selects a clock without the slack over the one that kept it", () => {
            expect(alternatives.filter(a => !a.matches_belt_choice).map(a => a.id)).toEqual(["planned-belt-slack"]);
            expect(alternative("planned-belt-slack").meets_target_rate).toBe(true);
            expect(selected.belt).toEqual({ kind: "non_moving" });
            expect(selected.meets_target_rate).toBe(true);
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
            expect(batched.is_stable).toBe(false);
            expect(batched.result.stability_check.as_built?.actual_output_items).toBe(48);
            expect(batched.result.stability_check.expected_output_items).toBe(32);
            expect(alternatives.map(a => a.id)).toEqual(["planned-belt-slack", "full-hand"]);
        });

        it("selects full-hand output swings without the slack", () => {
            expect(selected.id).toBe("full-hand");
            expect(selected.meets_target_rate).toBe(true);
            expect(selected.belt).toEqual({ kind: "non_moving" });
            expect(selected.result.clock_windows).toEqual({
                "inserter:1": [{ start: 1, end: 23 }],
                "inserter:2": [{ start: 0, end: 3 }, { start: 36, end: 39 }],
            });
        });
    });

    // belt pickup slack is not given to a period that is not a whole number of ticks
    describe("iron bacteria, on a clock of 90.947 ticks", () => {
        let alternatives: ClockAlternative[];

        beforeAll(async () => {
            const config = await loadConfigFromFile(ConfigPaths.IRON_BACTERIA_CULTIVATION);
            ({ alternatives } = generateClockAlternatives(config, { logger: quiet }));
        });

        it("names every clock a non-moving belt clock, the subtick one and the rounded one", () => {
            expect(alternatives.length).toBeGreaterThan(0);
            expect(alternatives.map(a => a.belt)).toEqual(alternatives.map(() => ({ kind: "non_moving" })));
            expect(alternatives.some(a => a.id.endsWith("-subtick"))).toBe(true);
        });

        it("counts none of them as having left the slack out", () => {
            expect(alternatives.every(a => a.matches_belt_choice)).toBe(true);
            expect(alternatives[0].description).toContain("The slack is not given to a clock whose period is not a whole number of ticks");
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
