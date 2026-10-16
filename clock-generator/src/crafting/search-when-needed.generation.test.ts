import { describe, it, expect, beforeAll } from "vitest";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import type { Config } from "../config/schema";
import { generateClockAlternatives, planClockAlternatives, selectableAsStable, type ClockAlternativesResult } from "./generate-blueprint";
import { quiet, withSearches } from "./generate-blueprint-test-helpers";

const SEARCH_IDS = ["derived", "uneven-output", "shifted-swings", "full-hand"];
const SEARCH_LABELS = ["Observed windows", "Uneven output swings", "Shifted swings", "Full-hand output swings"];
// utility science has an item that sets its period (the low density structure), so it also has the search for a shorter period
const SHORTER_PERIOD_SEARCH_ID = "derived-lean-low-density-structure";
const SHORTER_PERIOD_SEARCH_LABEL = "Observed windows, shorter period (low density structure not in the period)";

const idsOf = (generated: ClockAlternativesResult) => generated.alternatives.map(a => a.id);
const selectedOf = (generated: ClockAlternativesResult) => generated.alternatives[generated.selected_index];

// The four searches take most of the time of a generation, and only run when no clock made without one can be
// selected as stable, unless the config asks for them (`overrides.search_for_fewer_wake_ups`).
describe("the searches only run when they are needed", () => {

    // fractional is stable at 16.1 wake-ups a minute (from the staged start, with the belt wake rule); planned with
    // belt slack is stable at 26.8; the searches find shifted swings, stable at 26.8, and observed windows, which
    // gets back from no loss, at 32.1: no search beats the clock made without one
    describe("utility science, where a clock made without a search is stable", () => {
        let config: Config;
        let by_default: ClockAlternativesResult;
        let searched: ClockAlternativesResult;

        beforeAll(async () => {
            config = await loadConfigFromFile(ConfigPaths.UTILITY_SCIENCE);
            by_default = generateClockAlternatives(config, { logger: quiet });
            searched = generateClockAlternatives(withSearches(config), { logger: quiet });
        });

        it("leaves the searches out by default, and says which", () => {
            expect(by_default.skipped_searches).toEqual([...SEARCH_LABELS, SHORTER_PERIOD_SEARCH_LABEL]);
            expect(idsOf(by_default).filter(id => SEARCH_IDS.includes(id))).toEqual([]);
        });

        it("selects a stable clock made without a search", () => {
            const selected = selectedOf(by_default);
            // "fractional" since the belt wake rule (docs/simulator.md): 16.07 wake-ups against 26.79 for planned-belt-slack
            expect(selected.id).toBe("fractional");
            expect(selected.verdict).toBe("stable");
            expect(selectableAsStable(selected.ranking)).toBe(true);
        });

        it("lists the clocks made without a search in the same order either way", () => {
            expect(idsOf(searched).filter(id => ![...SEARCH_IDS, SHORTER_PERIOD_SEARCH_ID].includes(id))).toEqual(idsOf(by_default));
        });

        it("plans the searches as tasks that wait for the others, and as tasks like the others when the config asks for them", () => {
            const waiting = (planned: Config) => planClockAlternatives(planned, { logger: quiet }).tasks.filter(task => task.only_when_needed).map(task => task.id);
            expect(waiting(config)).toEqual([...SEARCH_IDS, SHORTER_PERIOD_SEARCH_ID]);
            expect(waiting(withSearches(config))).toEqual([]);
        });
    });

    // Where a clock made without a search is stable, the searches can still win: swings-3 is selected at 177.3 wake-ups
    // a minute without them, and the search for observed windows finds a stable clock at 163.6. (On utility science
    // the searches stopped winning with the belt wake rule, docs/simulator.md: the fractional clock fell to 16.1
    // wake-ups there, below shifted swings at 26.8; they won it at 21.4 against 26.8 before.)
    describe("logistic science, where a clock made without a search is stable", () => {
        let by_default: ClockAlternativesResult;
        let searched: ClockAlternativesResult;

        beforeAll(async () => {
            const config = await loadConfigFromFile(ConfigPaths.LOGISTIC_SCIENCE);
            by_default = generateClockAlternatives(config, { logger: quiet });
            searched = generateClockAlternatives(withSearches(config), { logger: quiet });
        });

        it("runs the searches when the config asks for them, and selects a clock with fewer wake-ups", () => {
            expect(by_default.skipped_searches).toEqual(SEARCH_LABELS);
            expect(selectedOf(by_default).id).toBe("swings-3");
            expect(searched.skipped_searches).toEqual([]);
            // the other three searches find no clock for this build
            expect(idsOf(searched).filter(id => SEARCH_IDS.includes(id))).toEqual(["derived"]);
            const selected = selectedOf(searched);
            expect(selected.id).toBe("derived");
            expect(selected.verdict).toBe("stable");
            expect(selected.assessment.wake_ups_per_minute!).toBeCloseTo(163.64, 2);
            expect(selected.assessment.wake_ups_per_minute!).toBeLessThan(selectedOf(by_default).assessment.wake_ups_per_minute!);
        });
    });

    // batched swings loses a hand a period here; only full-hand output swings, a search, holds the target rate
    describe("automation science, where no clock made without a search is stable", () => {
        let by_default: ClockAlternativesResult;

        beforeAll(async () => {
            by_default = generateClockAlternatives(await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE), { logger: quiet });
        });

        it("runs the searches by default", () => {
            expect(by_default.skipped_searches).toEqual([]);
            expect(by_default.alternatives.filter(a => !SEARCH_IDS.includes(a.id)).some(a => selectableAsStable(a.ranking))).toBe(false);
        });

        it("selects the stable clock a search finds", () => {
            expect(selectedOf(by_default).id).toBe("full-hand");
            expect(selectedOf(by_default).verdict).toBe("stable");
        });
    });
});
