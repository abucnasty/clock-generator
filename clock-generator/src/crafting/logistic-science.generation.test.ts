import {beforeAll, describe, expect, it} from "vitest";
import {loadConfigFromFile} from "../config/loader";
import {ConfigPaths} from "../config/config-paths";
import {generateClockAlternatives, type ClockAlternativesResult} from "./generate-blueprint";
import {quiet, withSearches, SEARCH_MAKERS, alternativeMakersOf as idsOf, selectedAlternativeOf as selectedOf} from "./generate-blueprint-test-helpers";

// The logistic science sample (LOGISTIC_SCIENCE_240) as it is, with the belt its clocks are made for, is a job of the record, with its checks
// (tests/game/builds/job-checks/samples.ts); here the same sample with the searches asked for.
describe("the searches only run when they are needed", () => {
    describe("logistic science, where a clock made without a search is stable", () => {
        let searched: ClockAlternativesResult;

        beforeAll(async () => {
            searched = generateClockAlternatives(withSearches(await loadConfigFromFile(ConfigPaths.LOGISTIC_SCIENCE_240)), {logger: quiet});
        });

        it("runs the searches when the config asks for them, and keeps the batched clock that beats them", () => {
            // #527 runs observed and shifted searches past a stable short clock; only the other two need the override.
            expect(searched.skipped_searches).toEqual([]);
            // the other two searches find no clock for this build; full-hand output swings finds one on the 4-swing plan
            expect(idsOf(searched).filter(id => SEARCH_MAKERS.includes(id))).toEqual(["derived", "full-hand"]);
            // the 4-swing clock, its two pickup windows a window cycle with the belt pickup slack inside them (#595), wakes
            // 20.6 a minute, no more than any clock the searches find (derived 102.9): the searches run, and it keeps winning
            const selected = selectedOf(searched);
            expect(selected.maker).toBe("planned-belt-slack");
            expect(selected.verdict).toBe("stable");
            expect(selected.assessment.wake_ups_per_minute!).toBeCloseTo(20.57, 1);
        });
    });
});
