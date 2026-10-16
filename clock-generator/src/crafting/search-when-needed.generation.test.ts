import { describe, it, expect, beforeAll } from "vitest";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import type { Config } from "../config/schema";
import { generateClockAlternatives, planClockAlternatives, selectableAsStable, type ClockAlternativesResult } from "./generate-blueprint";
import { quiet, withSearches } from "./generate-blueprint-test-helpers";

const SEARCH_IDS = ["derived", "uneven-output", "shifted-swings", "full-hand"];
const SEARCH_LABELS = ["Observed windows", "Uneven output swings", "Shifted swings", "Full-hand output swings"];

const idsOf = (generated: ClockAlternativesResult) => generated.alternatives.map(a => a.id);
const selectedOf = (generated: ClockAlternativesResult) => generated.alternatives[generated.selected_index];

// The four searches take most of the time of a generation, and only run when no clock made without one can be
// selected as stable, unless the config asks for them (`overrides.search_for_fewer_wake_ups`).
describe("the searches only run when they are needed", () => {

    // planned with belt slack is stable at 26.8 wake-ups a minute (from the staged start; 10.7 from the prepared build);
    // the searches find shifted swings, stable at 21.4, and observed windows, which gets back from no loss, at 32.1
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
            expect(by_default.skipped_searches).toEqual(SEARCH_LABELS);
            expect(idsOf(by_default).filter(id => SEARCH_IDS.includes(id))).toEqual([]);
        });

        it("selects a stable clock made without a search", () => {
            const selected = selectedOf(by_default);
            expect(selected.id).toBe("planned-belt-slack");
            expect(selected.verdict).toBe("stable");
            expect(selectableAsStable(selected.ranking)).toBe(true);
        });

        // from the staged start the search for shifted swings finds a clock with fewer wake-ups than the clock made
        // without a search, so the search selects it
        it("runs the searches when the config asks for them, and selects a clock with fewer wake-ups", () => {
            expect(searched.skipped_searches).toEqual([]);
            // the search for uneven output swings finds no clock for this build from the staged start (the prepared
            // build gave one), nor does the search for full-hand swings
            expect(idsOf(searched).filter(id => SEARCH_IDS.includes(id)).sort()).toEqual(["derived", "shifted-swings"]);
            const selected = selectedOf(searched);
            expect(selected.id).toBe("shifted-swings");
            expect(selected.verdict).toBe("stable");
            expect(selected.assessment.wake_ups_per_minute!).toBeCloseTo(21.43, 2);
            expect(selected.assessment.wake_ups_per_minute!).toBeLessThan(selectedOf(by_default).assessment.wake_ups_per_minute!);
        });

        it("lists the clocks made without a search in the same order either way", () => {
            expect(idsOf(searched).filter(id => !SEARCH_IDS.includes(id))).toEqual(idsOf(by_default));
        });

        it("plans the searches as tasks that wait for the others, and as tasks like the others when the config asks for them", () => {
            const waiting = (planned: Config) => planClockAlternatives(planned, { logger: quiet }).tasks.filter(task => task.only_when_needed).map(task => task.id);
            expect(waiting(config)).toEqual(SEARCH_IDS);
            expect(waiting(withSearches(config))).toEqual([]);
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
