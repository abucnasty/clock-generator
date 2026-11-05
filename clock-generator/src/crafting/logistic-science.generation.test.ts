import {beforeAll, describe, expect, it} from "vitest";
import {loadConfigFromFile} from "../config/loader";
import {ConfigPaths} from "../config/config-paths";
import {clockHash} from "../../tests/game/builds/clock-controls";
import type {Config} from "../config/schema";
import {generateClockAlternatives, type ClockAlternative, type ClockAlternativesResult} from "./generate-blueprint";
import {quiet, withSearches, SEARCH_IDS, alternativeIdsOf as idsOf, selectedAlternativeOf as selectedOf} from "./generate-blueprint-test-helpers";

let config: Config;
let by_default: ClockAlternativesResult;
let moving: ClockAlternative[];
let moving_selected: ClockAlternative;

beforeAll(async () => {
    config = await loadConfigFromFile(ConfigPaths.LOGISTIC_SCIENCE_240);
    by_default = generateClockAlternatives(config, {logger: quiet});
    moving = by_default.alternatives;
    moving_selected = selectedOf(by_default);
});

// The sample's belts move (the default): every clock is made for a moving belt, none for a backed-up belt
describe("the belt a clock is made for", () => {
    describe("logistic science", () => {
        const alternative = (id: string) => moving.find(a => a.id === id)!;

        it("makes batched swings for a moving belt, with 4 ticks of belt pickup slack", () => {
            const batched = alternative("planned-belt-slack");
            expect(batched.label).toBe("Batched swings: 4 output swings per cycle");
            expect(batched.belt).toEqual({kind: "moving", slack_ticks: [4]});
            expect(batched.description).toContain("Made for a moving belt: every inserter that picks up from a belt stays enabled 4 more ticks");
        });

        it("offers one clock made for a backed-up belt, and the rest hold the slack", () => {
            expect(moving.some(a => a.id === "planned")).toBe(false);
            expect(moving.filter(a => a.belt?.kind === "backed_up").map(a => a.id)).toEqual(["swings-1"]);
            expect(alternative("swings-2").belt).toEqual({kind: "moving", slack_ticks: [4]});
            expect(alternative("derived").belt).toEqual({kind: "moving", slack_ticks: [4]});
        });

        it("selects the moving clock with the fewest wake-ups", () => {
            // the 176-tick clock of 4 output swings wakes 61.7 a minute, fewer than the 2-swing clock (82.8) and the
            // derived one (102.9); 5 and 6 swings fall short of the target. All the others hold it.
            const other = alternative("swings-2");
            expect(other.verdict).toBe("stable");
            expect(other.ranking.meets_target_rate).toBe(true);
            expect(clockHash(moving_selected.result.subtick ?? moving_selected.result))
                .toBe("2f07693464e59ecf077c9dc4270c58d5ad6e04b6666c9bb26fac45f8c8d7f4d7");
            expect(other.assessment.wake_ups_per_minute).toBeCloseTo(82.8, 1);
            expect(alternative("swings-5").verdict).toBe("unstable");
            expect(alternative("swings-6").verdict).toBe("unstable");
            expect(moving_selected.id).toBe("planned-belt-slack");
            expect(moving_selected.verdict).toBe("stable");
            expect(moving_selected.assessment.wake_ups_per_minute).toBeCloseTo(61.7, 1);
            expect(moving_selected.belt).toEqual({kind: "moving", slack_ticks: [4]});
        });
    });
});

describe("the searches only run when they are needed", () => {
    describe("logistic science, where a clock made without a search is stable", () => {
        let searched: ClockAlternativesResult;

        beforeAll(() => {
            searched = generateClockAlternatives(withSearches(config), {logger: quiet});
        });

        it("runs the searches when the config asks for them, and keeps the planned clock that beats them", () => {
            // #527 runs observed and shifted searches past a stable short clock; only the other two need the override.
            expect(by_default.skipped_searches).toEqual(["Uneven output swings", "Full-hand output swings"]);
            expect(selectedOf(by_default).id).toBe("planned-belt-slack");
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
