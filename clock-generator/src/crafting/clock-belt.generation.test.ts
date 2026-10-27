import { describe, it, expect, beforeAll } from "vitest";
import { clockBeltLabel, generateClockAlternatives, type ClockAlternative, type ClockAlternativesResult } from "./generate-blueprint";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import type { Config } from "../config/schema";
import { alwaysOnReasonProblemsOf, quiet, withSearches } from "./generate-blueprint-test-helpers";
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

    // Two belt inserters that each take two ingredients off a belt split between them, each from the lane nearest to
    // it first. Batched swings holds the target rate without the slack: recorded on the scaffold on 2026-10-10, 192 in
    // every period. With 2 and with 1 output swings per cycle a clock only holds with the slack, and with belts that
    // do not move it is offered without and listed as unstable: until 2026-10-10 such a clock was made again with the
    // slack and listed as a clock for a moving belt.
    describe("utility science, with backed-up belts", () => {
        let alternatives: ClockAlternative[];
        let selected: ClockAlternative;
        const alternative = (id: string) => alternatives.find(a => a.id === id)!;

        let by_default: ClockAlternativesResult;
        let problems: string[];

        beforeAll(async () => {
            const config = await loadConfigFromFile(ConfigPaths.UTILITY_SCIENCE);
            by_default = generateClockAlternatives(backedUpBelts(config), { logger: quiet });
            problems = alwaysOnReasonProblemsOf(backedUpBelts(config), by_default);
            // with the searches, for the clocks of theirs that get back from every loss
            const generated = generateClockAlternatives(withSearches(backedUpBelts(config)), { logger: quiet });
            alternatives = generated.alternatives;
            selected = alternatives[generated.selected_index];
        });

        it("names why every inserter and drill a clock leaves always on is", () => {
            expect(problems).toEqual([]);
        });

        it("makes every clock without the slack, also one that only holds with it", () => {
            expect(alternatives.map(a => a.belt)).toEqual(alternatives.map(() => ({ kind: "backed_up" })));
            expect(alternatives.every(a => a.ranking.matches_belt_choice)).toBe(true);
            const two_swings = alternative("swings-2");
            expect(two_swings.verdict).not.toBe("stable");
            expect(two_swings.result.belt_pickup_slack_ticks).toEqual({});
        });

        it("has batched swings hold the target rate without the slack, at a few wake-ups", () => {
            const batched = alternative("planned-belt-slack");
            expect(batched.belt).toEqual({ kind: "backed_up" });
            expect(batched.verdict).not.toBe("unstable");
            // from the staged start (empty machines); 10.71 before the belt wake rule (docs/simulator.md): a belt-fed
            // inserter whose window opens on a machine at its output block now starts a tick later, as in the game
            expect(batched.assessment.wake_ups_per_minute).toBeCloseTo(0, 2);
        });

        // The build has a deadlock risk (GOALS.md, "Two inserters that bring the same item"), which the trials for
        // backpressure loss do not see: uneven output swings gets back from every loss in the simulator and made 0 of
        // 192 a period in the game, where batched swings made 192. So on this build the verdict does not decide.
        // From the staged start (empty machines) batched swings also gets back from the loss of the packs not being
        // taken away; from the prepared build it did not.
        it("selects it, and the build gets back to its rate under it from every loss", () => {
            const batched = alternative("planned-belt-slack");
            expect(batched.assessment.backpressure_loss).toMatchObject({ survives: true, broken_by: [] });
            expect(batched.verdict).toBe("stable");
            expect(batched.deadlock_risks).toHaveLength(1);
            expect(batched.ranking.meets_target_rate).toBe(true);
            expect(selected.id).toBe("planned-belt-slack");
            // from the staged start the search for uneven output swings finds no clock for this build, so there is none
            // to compare with (the prepared build gave one that got back from every loss, at more wake-ups)
            expect(alternatives.some(a => a.id === "uneven-output")).toBe(false);
        });

        // what the selection takes for goal 1 on this build is what the searches are left out for: a clock that
        // holds at the target rate, whether it gets back from every loss or not
        it("does not search for another clock by default, since batched swings can be selected as it is", () => {
            expect(by_default.skipped_searches).toEqual([
                "Observed windows", "Uneven output swings", "Shifted swings", "Full-hand output swings",
            ]);
            expect(by_default.alternatives[by_default.selected_index].id).toBe("planned-belt-slack");
            // from the staged start (empty machines) some clock is stable here; with the prepared build none was
            expect(by_default.alternatives.some(a => a.verdict === "stable")).toBe(true);
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

    // One belt inserter that takes two ingredients off a belt split between them. Since the belt window-end trim,
    // batched swings move exactly the expected output as built (32, where the untrimmed windows moved 48), but the
    // verdict is "no recovery"; full-hand output swings holds it without the slack. The game agrees with the batched
    // simulation: recorded on 2026-10-20 (record-clock.js, #265; the recording was not kept in the repository),
    // 460 of 499 periods moved exactly 32 and the rest alternated 16 and 48 in the periods the simulator names
    // (offset by the recording start), every 16 paired with a 48 ten periods on.
    describe("automation science, with backed-up belts", () => {
        let alternatives: ClockAlternative[];
        let selected: ClockAlternative;
        let problems: string[];

        beforeAll(async () => {
            const config = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE);
            const generated = generateClockAlternatives(backedUpBelts(config), { logger: quiet });
            problems = alwaysOnReasonProblemsOf(backedUpBelts(config), generated);
            alternatives = generated.alternatives;
            selected = alternatives[generated.selected_index];
        });

        it("names why every inserter and drill a clock leaves always on is", () => {
            expect(problems).toEqual([]);
        });

        it("makes full-hand output swings from batched swings that cannot get back to their rate", () => {
            const batched = alternatives.find(a => a.id === "planned-belt-slack")!;
            expect(batched.verdict).toBe("no recovery");
            expect(batched.result.stability_check.as_built?.actual_output_items).toBe(32);
            expect(batched.result.stability_check.expected_output_items).toBe(32);
            expect(alternatives.map(a => a.id)).toEqual(["planned-belt-slack", "derived", "shifted-swings", "full-hand"]);
        });

        it("selects full-hand output swings without the slack", () => {
            expect(selected.id).toBe("full-hand");
            expect(selected.ranking.meets_target_rate).toBe(true);
            expect(selected.belt).toEqual({ kind: "backed_up" });
            // inserter 1's window ends a tick earlier since its hands after a craft start come a tick sooner
            expect(selected.result.clock_windows).toEqual({
                "inserter:1": [{ start: 1, end: 19 }],
                "inserter:2": [{ start: 0, end: 3 }, { start: 36, end: 39 }],
            });
        });
    });

    // At normal speed a backed-up belt refills a pickup slower than a stack a tick: every clock planned for backed-up
    // supply closes its windows before the hand is full, and the selected fractional clock moved 128, 128, 96 of 176 in
    // the game, as its holds false said. The clock planned with the belts moving, given the slack and checked on the
    // backed-up belts, holds: recorded on 2026-10-20 (#275), 176 in every period and after every disturbance, at the
    // side underground entrance and exit and the front exit alike.
    describe("the normal side underground exit, with backed-up belts", () => {
        let generated: ClockAlternativesResult;

        beforeAll(async () => {
            const variant = pickupClockSpeedCases("electromagnetic").find(it => it.name === "electromagnetic-normal-underground-exit-backed")!;
            generated = generateClockAlternatives(await pickupClockConfig(variant), { logger: quiet });
        });

        it("makes a clock for a moving belt last, when no clock for a backed-up belt can be selected as stable", () => {
            const others = generated.alternatives.filter(a => a.id !== "planned-moving-belt");
            expect(others.length).toBeGreaterThan(0);
            expect(others.every(a => a.verdict !== "stable" && a.belt?.kind === "backed_up")).toBe(true);
            expect(generated.skipped_searches).toEqual([]);
        });

        it("selects it, judged on the backed-up belts the config describes", () => {
            const selected = generated.alternatives[generated.selected_index];
            expect(selected.id).toBe("planned-moving-belt");
            expect(selected.verdict).toBe("stable");
            expect(selected.belt).toEqual({ kind: "moving", slack_ticks: [4] });
            expect(selected.result.used_terminal_swing_count).toBe(1);
            // its planning run, on moving belts, over-produces; it holds by its check on the backed-up belts
            expect(selected.result.stability_check.actual_output_items).toBe(192);
            expect(selected.result.stability_check.as_built?.actual_output_items).toBe(176);
            expect(selected.description).toMatch(/The config says the input belts are backed up/);
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
