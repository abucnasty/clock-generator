import {beforeAll, describe, expect, it} from "vitest";
import {loadConfigFromFile} from "../config/loader";
import {ConfigPaths} from "../config/config-paths";
import type {Config} from "../config/schema";
import {generateClockAlternatives, planClockAlternatives, selectableAsStable, type ClockAlternative, type ClockAlternativesResult} from "./generate-blueprint";
import {alwaysOnReasonProblemsOf, quiet, withSearches, SEARCH_IDS, SEARCH_LABELS, alternativeIdsOf as idsOf, selectedAlternativeOf as selectedOf} from "./generate-blueprint-test-helpers";

let config: Config;
let by_default: ClockAlternativesResult;
let alternatives: ClockAlternative[];
let selected: ClockAlternative;

beforeAll(async () => {
    config = await loadConfigFromFile(ConfigPaths.UTILITY_SCIENCE);
    by_default = generateClockAlternatives(config, {logger: quiet});
    alternatives = by_default.alternatives;
    selected = selectedOf(by_default);
});

it("names why every inserter and drill a clock leaves always on is", () => {
    expect(alwaysOnReasonProblemsOf(config, by_default)).toEqual([]);
});

describe("the searches only run when they are needed", () => {
    describe("utility science, where a clock made without a search is stable", () => {
        let searched: ClockAlternativesResult;

        beforeAll(() => {
            searched = generateClockAlternatives(withSearches(config), {logger: quiet});
        });

        it("leaves the searches out by default, and says which", () => {
            expect(by_default.skipped_searches).toEqual(SEARCH_LABELS);
            expect(idsOf(by_default).filter(id => SEARCH_IDS.includes(id))).toEqual([]);
        });

        it("selects a stable clock made without a search", () => {
            const selected = selectedOf(by_default);
            // "planned-belt-slack" since belt windows close before their last return swing: fractional no longer
            // holds under its trimmed windows, and planned-belt-slack's wake-ups fell from 26.79 to 10.73 a minute
            expect(selected.id).toBe("planned-belt-slack");
            expect(selected.verdict).toBe("stable");
            expect(selectableAsStable(selected.ranking)).toBe(true);
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
});

describe("the clocks of a build with a deadlock risk", () => {

    it("all name the risk, in an insight of the build", () => {
        for (const alternative of alternatives) {
            expect(alternative.deadlock_risks, alternative.id).toHaveLength(1);
            const insight = alternative.insights.find(it => it.id === "deadlock-risk");
            expect(insight?.scope, alternative.id).toBe("build");
            expect(insight?.what).toContain("Inserters 1 and 2 both bring low-density-structure to machine 1");
        }
    });

    it("are ranked by what they hold, not by whether they get back from a loss: the verdict is shown and does not decide", () => {
        for (const alternative of alternatives.filter(it => Number.isInteger(it.result.simulation_duration.ticks))) {
            expect(alternative.ranking.meets_target_rate, alternative.id).toBe(alternative.verdict !== "unstable");
        }
        const no_recovery = alternatives.filter(it => it.verdict === "no recovery");
        // from the staged start (empty machines) every clock that holds gets back from every loss on this build, so
        // none is listed as having no recovery; from the prepared build "planned" was
        expect(no_recovery).toHaveLength(0);
        expect(no_recovery.every(it => it.assessment.backpressure_loss?.survives === false)).toBe(true);
        // "planned-belt-slack" since belt windows close before their last return swing: fractional no longer holds
        // under its trimmed windows, and planned-belt-slack wakes 10.73 a minute
        expect(selected.id).toBe("planned-belt-slack");
    });
});
