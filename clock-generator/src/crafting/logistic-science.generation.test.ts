import {beforeAll, describe, expect, it} from "vitest";
import {loadConfigFromFile} from "../config/loader";
import {ConfigPaths} from "../config/config-paths";
import {clockHash} from "../../tests/game/builds/clock-controls";
import type {Config} from "../config/schema";
import {generateClockAlternatives, type ClockAlternative, type ClockAlternativesResult} from "./generate-blueprint";
import {alwaysOnReasonProblemsOf, quiet, withSearches, SEARCH_IDS, alternativeIdsOf as idsOf, selectedAlternativeOf as selectedOf} from "./generate-blueprint-test-helpers";

let config: Config;
let by_default: ClockAlternativesResult;
let moving: ClockAlternative[];
let moving_selected: ClockAlternative;

beforeAll(async () => {
    config = await loadConfigFromFile(ConfigPaths.LOGISTIC_SCIENCE);
    by_default = generateClockAlternatives(config, {logger: quiet});
    moving = by_default.alternatives;
    moving_selected = selectedOf(by_default);
});

it("names why every inserter and drill a clock leaves always on is", () => {
    expect(alwaysOnReasonProblemsOf(config, by_default)).toEqual([]);
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

        it("offers no clock made for a backed-up belt, and every clock holds the slack", () => {
            // since belt windows close before their last return swing, swings-2 and swings-1 hold with the slack and
            // export as moving clocks
            expect(moving.some(a => a.id === "planned")).toBe(false);
            expect(moving.some(a => a.label.includes("backed-up belt"))).toBe(false);
            expect(moving.filter(a => a.belt?.kind === "backed_up").map(a => a.id)).toEqual([]);
            expect(moving.every(a => a.ranking.matches_belt_choice)).toBe(true);
            expect(alternative("swings-2").belt).toEqual({kind: "moving", slack_ticks: [4]});
        });

        it("selects the moving clock with the fewest wake-ups", () => {
            // #524 breaks equal wake-ups by recovery: both wake 82.76 a minute, but swings-1 recovers in 2
            // periods instead of 3. The previous selected clock is still offered with its exact windows.
            const previous = alternative("swings-2");
            expect(previous.verdict).toBe("stable");
            expect(previous.ranking.meets_target_rate).toBe(true);
            expect(clockHash(previous.result.subtick ?? previous.result))
                .toBe("367560d392bb2891d5f82ac3731b39eee04439222e7e86937ad993d759223625");
            expect(previous.assessment.wake_ups_per_minute).toBeCloseTo(82.76, 2);
            expect(moving_selected.id).toBe("swings-1");
            expect(moving_selected.verdict).toBe("stable");
            expect(moving_selected.assessment.wake_ups_per_minute).toBe(previous.assessment.wake_ups_per_minute);
            expect(previous.ranking.recovery_periods).toBe(3);
            expect(moving_selected.ranking.recovery_periods).toBe(2);
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
            expect(selectedOf(by_default).id).toBe("swings-1");
            expect(searched.skipped_searches).toEqual([]);
            // the other three searches find no clock for this build
            expect(idsOf(searched).filter(id => SEARCH_IDS.includes(id))).toEqual(["derived"]);
            // since belt windows close before their last return swing, the planned swings-1 wakes 82.76 a minute,
            // fewer than the derived clock the search finds: the searches run, and the planned clock keeps winning
            const selected = selectedOf(searched);
            expect(selected.id).toBe("swings-1");
            expect(selected.verdict).toBe("stable");
            expect(selected.assessment.wake_ups_per_minute!).toBeCloseTo(82.76, 2);
        });
    });
});
