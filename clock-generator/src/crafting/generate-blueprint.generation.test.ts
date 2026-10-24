import { describe, it, expect, beforeAll } from "vitest";
import { generateClockForConfig, generateClockAlternatives, validateConfig, type BlueprintGenerationResult, type ClockAlternative, type ConfigValidation, type SerializableClockWindows } from "./generate-blueprint";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import { EntityId } from "../entities";
import { alwaysOnReasonProblems, alwaysOnReasonProblemsOf, quiet, withSearches } from "./generate-blueprint-test-helpers";

// The samples of generate-blueprint.test.ts whose generation takes longest: the clock alternatives of iron bacteria,
// and two builds whose single generation runs the long checks.
describe("generateClockForConfig", () => {

    // The builds are generated in beforeAll hooks, not in the describe bodies: those all run when the file is collected,
    // so a run of one test by name would generate every build in the file first.

    describe("belt lane consumed outside the config", async () => {
        const config = await loadConfigFromFile(ConfigPaths.PROCESSING_UNITS_BELT_EXPORT);
        let result: BlueprintGenerationResult;

        beforeAll(() => {
            result = generateClockForConfig(config);
        });

        it("names why every inserter and drill the clock leaves always on is", () => {
            expect(alwaysOnReasonProblems(config, result, "planned")).toEqual([]);
        });

        it("fills the lane at its consumption rate", () => {
            const lane = config.belts.find(belt => belt.id === 5)!.lanes[0];
            const consumption_per_second = "consumption_per_second" in lane ? lane.consumption_per_second! : 0;
            const [, transfers] = Array.from(result.transfer_history.entries())
                .find(([id]) => id.id === EntityId.forInserter(12).id)!;
            const exported = transfers.reduce((sum, t) => sum + t.amount, 0);
            expect(exported).toBe(consumption_per_second * result.simulation_duration.ticks / 60);
        });
    });

    // Two iron bacteria cultivation biochambers that give each other the bacteria a craft starts from. Each has two
    // inserters to a chest (1 and 3, 4 and 6); 7 and 8 go between the machines; 9 and 10 bring bioflux and nutrients.
    // Recorded in Factorio 2.1.21 for 36000 ticks a clock: 576 bacteria in each of 399 periods on the subtick clock,
    // exactly 380 a second, and in each of 400 periods on the clock rounded to 90 ticks, 384 a second. With belt
    // windows of 8 ticks the subtick clock made 373: a fifth of them closed on a partly filled hand.
    // Recorded again on 2026-10-09 on the scaffold in the samples, for 72,576 ticks: 10,944 in each of the 42 repeats
    // of 1728 ticks the subtick clock counts, which cut into their 19 periods are 576 in each of 798. These tests
    // were skipped for a day because the long run counted a period of 90.947 ticks in bins of 90, which hold 570 of
    // the 576; the clock and the belt pickup rules were never at fault.
    // Recorded on 2026-10-10 on that scaffold, 36,000 ticks each: batched swings at 2 output swings a cycle and
    // observed windows move 10,944 in each of 20 repeats too. The simulator had batched swings at 2 swings at 338 a
    // second for as long as it opened every window a tick early.
    describe("iron bacteria from two biochambers, each with two output inserters", async () => {
        const config = await loadConfigFromFile(ConfigPaths.IRON_BACTERIA_CULTIVATION);
        let validation: ConfigValidation;
        let alternatives: ClockAlternative[];
        let selected: ClockAlternative;
        let windows: SerializableClockWindows;

        beforeAll(() => {
            validation = validateConfig(config);
            // with the searches, for the observed windows: the clock with 6 output swings is selected either way
            const generated = generateClockAlternatives(withSearches(config), { logger: quiet });
            alternatives = generated.alternatives;
            selected = alternatives[generated.selected_index];
            windows = selected.result.clock_windows;
        });

        it("names why every inserter and drill a clock leaves always on is", () => {
            expect(alwaysOnReasonProblemsOf(config, { alternatives })).toEqual([]);
        });

        it("validates with the hands a machine gives up a cycle, over both of its output inserters", () => {
            // 190 a second a machine: 3 hands of 16 every 15.158 ticks
            expect(validation.output_swings_per_cycle).toBe(3);
            expect(validation.cycle_ticks).toBeCloseTo(15.158, 3);
        });

        it("holds the target of 380 a second with 3 hands an inserter a cycle", () => {
            expect(selected.label).toBe("6 output swings per cycle, subtick clock");
            expect(selected.verdict).toBe("stable");
            expect(selected.assessment.items_per_second).toBeCloseTo(380, 6);
            // 6 hands a machine in each of the 3 cycles of the period, over all four output inserters
            expect(selected.result.stability_check.expected_output_items).toBe(2 * 6 * 16 * 3);
        });

        it("does not call a clock stable whose swings do not come out whole for each output inserter", () => {
            const odd = alternatives.filter(a => /(: | )?[135] output swings? per cycle/.test(a.label));
            expect(odd.length).toBeGreaterThan(0);
            expect(odd.every(a => a.verdict !== "stable")).toBe(true);
        });

        it("opens one window a cycle for each output inserter, for its 3 hands", () => {
            for (const id of ["inserter:1", "inserter:3", "inserter:4", "inserter:6"]) {
                expect(windows[id]).toEqual([{ start: 0, end: 20 }, { start: 30, end: 50 }, { start: 60, end: 80 }]);
            }
        });

        it("keeps the window of an inserter on the belt open long enough for a pickup that starts late or fills slowly", () => {
            for (const id of ["inserter:9", "inserter:10"]) {
                expect(windows[id]).toEqual([{ start: 0, end: 16 }, { start: 30, end: 46 }, { start: 60, end: 76 }]);
            }
        });

        it("leaves the inserters between the machines always enabled, in observed windows too", () => {
            expect(windows["inserter:7"]).toBeUndefined();
            expect(windows["inserter:8"]).toBeUndefined();
            const observed = alternatives.find(a => a.id === "derived-subtick")!;
            expect(observed.verdict).toBe("stable");
            expect(observed.result.clock_windows["inserter:7"]).toBeUndefined();
            expect(observed.result.clock_windows["inserter:8"]).toBeUndefined();
        });

        it("holds the target with batched swings at 2 output swings a cycle too, as it does in the game", () => {
            const batched = alternatives.find(a => a.id === "planned-belt-slack-subtick")!;
            expect(batched.label).toBe("Batched swings: 2 output swings per cycle, subtick clock");
            expect(batched.verdict).toBe("stable");
            expect(batched.assessment.items_per_second).toBeCloseTo(380, 6);
        });

        // belt pickup slack is not given to a period that is not a whole number of ticks (GOALS.md, the belt a clock is made for)
        it("names every clock a backed-up belt clock on its clock of 90.947 ticks, the subtick one and the rounded one, and counts none as having left the slack out", () => {
            expect(alternatives.length).toBeGreaterThan(0);
            expect(alternatives.map(a => a.belt)).toEqual(alternatives.map(() => ({ kind: "backed_up" })));
            expect(alternatives.some(a => a.id.endsWith("-subtick"))).toBe(true);
            expect(alternatives.every(a => a.ranking.matches_belt_choice)).toBe(true);
            expect(alternatives[0].description).toContain("The slack is not given to a clock whose period is not a whole number of ticks");
        });
    });

    // Recorded in game: the planned windows ran at 48/96 because the furnace/module window
    // landed before the output inserter cleared the machine; the derived windows ran stable.
    //
    // That recording was of one start of the clock. An inserter that waits for a machine at its output block takes
    // its items a tick after the output inserter has cleared it (see IdleModeTransitionEvaluator), and with that tick
    // the simulator found a start of the clock from which the derived windows with 2 ticks of padding make 92 of 96 a
    // period: they passed from 12 starts and failed the check of them all, and the search of the padding then needed two
    // paddings in a row to pass, so it found nothing. The search since 2026-10-11 confirms a padding without a passing
    // neighbour when there is none with one: the windows with no padding pass from every start and over the long run,
    // where a tick of padding does not. Whether the game has that state is not recorded; there is no scaffold of this
    // build. From the staged start of the simulator (empty machines) that state is gone: every padding passes.
    describe("PRODUCTION_SCIENCE_JSON derived clock windows", async () => {
        const config = await loadConfigFromFile(ConfigPaths.PRODUCTION_SCIENCE_JSON);

        it("planned windows fail the clock-only check", () => {
            const result = generateClockForConfig(config, { verify_as_built: true });
            expect(result.stability_check.as_built?.holds).toBe(false);
            expect(alwaysOnReasonProblems(config, result, "planned")).toEqual([]);
        });

        // From the staged start (empty machines, the clock at its tick 0) every padding tried passes, so the search
        // picks the first one that has a passing neighbour: 1 tick. The state that needed 0 ticks existed only from the
        // prepared build.
        it("derives windows with 1 tick of padding: from the staged start every padding tried passes", () => {
            const result = generateClockForConfig({
                ...config,
                overrides: { ...config.overrides, derive_clock_windows: true },
            }, { logger: quiet });
            expect(result.derived_clock_windows).toMatchObject({ succeeded: true, kept_planned_windows: false, end_padding_ticks: 1 });
            expect(result.stability_check.holds).toBe(true);
            expect(result.search).toMatchObject({ kind: "padding", picked: { row: 1, setting: 1 } });
            expect(alwaysOnReasonProblems(config, result, "derived")).toEqual([]);
            expect(result.search!.candidates.find(candidate => candidate.setting === 0)!.holds).toBe(true);
            expect(result.search!.candidates.find(candidate => candidate.setting === 2)!.holds).toBe(true);
        });
    });
});
