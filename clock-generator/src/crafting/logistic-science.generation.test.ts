import {beforeAll, describe, expect, it} from "vitest";
import {loadConfigFromFile} from "../config/loader";
import {ConfigPaths} from "../config/config-paths";
import {generateClockAlternatives, type ClockAlternativesResult} from "./generate-blueprint";
import {quiet, withSearches, SEARCH_IDS, alternativeIdsOf as idsOf, selectedAlternativeOf as selectedOf} from "./generate-blueprint-test-helpers";

// The logistic science sample (LOGISTIC_SCIENCE_240) as it is, with the belt its clocks are made for, is a job of the record, with its checks
// (tests/game/builds/job-checks/samples.ts); here the same sample with the searches asked for.
describe("the searches only run when they are needed", () => {
    describe("logistic science, where a clock made without a search is stable", () => {
        let searched: ClockAlternativesResult;

        beforeAll(async () => {
            searched = generateClockAlternatives(withSearches(await loadConfigFromFile(ConfigPaths.LOGISTIC_SCIENCE_240)), {logger: quiet});
        });

        it("runs the searches when the config asks for them, and keeps the planned clock that beats them", () => {
            // #527 runs observed and shifted searches past a stable short clock; only the other two need the override.
            expect(searched.skipped_searches).toEqual([]);
            // the other three searches find no clock for this build
            expect(idsOf(searched).filter(id => SEARCH_IDS.includes(id))).toEqual(["derived"]);
            // the planned clock wakes 61.7 a minute, fewer than the derived clock the search finds (102.9): the
            // searches run, and the planned clock keeps winning
            const selected = selectedOf(searched);
            expect(selected.id).toBe("planned-belt-slack");
            expect(selected.verdict).toBe("stable");
            expect(selected.assessment.wake_ups_per_minute!).toBeCloseTo(61.7, 1);
        });
    });
});
