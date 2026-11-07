import {beforeAll, describe, expect, it} from "vitest";
import {loadConfigFromFile} from "../config/loader";
import {ConfigPaths} from "../config/config-paths";
import type {Config} from "../config/schema";
import {generateClockAlternatives, planClockAlternatives, type ClockAlternativesResult} from "./generate-blueprint";
import {quiet, withSearches, SEARCH_MAKERS, alternativeMakersOf as idsOf} from "./generate-blueprint-test-helpers";
import {readRecordJob} from "../../tests/game/builds/clock-controls";

// The utility science build (UTILITY_SCIENCE_120) as it is, with no search asked for, is a job of the record, with its checks
// (tests/game/builds/job-checks/samples.ts); here the same build with the searches asked for.
describe("the searches only run when they are needed", () => {
    describe("utility science, where a clock made without a search is stable", () => {
        let config: Config;
        let searched: ClockAlternativesResult;

        beforeAll(async () => {
            config = await loadConfigFromFile(ConfigPaths.UTILITY_SCIENCE_120);
            searched = generateClockAlternatives(withSearches(config), {logger: quiet});
        });

        it("lists the clocks made without a search in the same order either way", () => {
            // the clocks of the build as it is are the record's job
            const by_default = readRecordJob("config-UTILITY_SCIENCE_120")!.alternatives.map(it => it.id);
            expect(idsOf(searched).filter(id => !SEARCH_MAKERS.includes(id))).toEqual(by_default);
        });

        it("plans the searches as tasks that wait for the others, and as tasks like the others when the config asks for them", () => {
            const waiting = (planned: Config) => planClockAlternatives(planned, {logger: quiet}).tasks.filter(task => task.only_when_needed).map(task => task.id);
            // Small batches, where no planned count holds, is a fallback: it waits either way
            expect(waiting(config)).toEqual([...SEARCH_MAKERS, "primitive-grouped"]);
            expect(waiting(withSearches(config))).toEqual(["primitive-grouped"]);
        });
    });
});
