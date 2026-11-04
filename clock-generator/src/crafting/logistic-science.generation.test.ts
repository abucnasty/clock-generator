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
            // the 88-tick clock of 2 output swings wakes 124.14 a minute, fewer than the one of 1 swing (165.52), which
            // recovers in 2 periods against its 3. Both are stable.
            const other = alternative("swings-1");
            expect(other.verdict).toBe("stable");
            expect(other.ranking.meets_target_rate).toBe(true);
            expect(clockHash(moving_selected.result.subtick ?? moving_selected.result))
                .toBe("dd150acf0843c894f8964ec2c05dd800edfbfe8aba29a081bd3dc8b45e751c11");
            expect(other.assessment.wake_ups_per_minute).toBeCloseTo(165.52, 2);
            expect(moving_selected.id).toBe("swings-2");
            expect(moving_selected.verdict).toBe("stable");
            expect(moving_selected.assessment.wake_ups_per_minute).toBeCloseTo(124.14, 2);
            expect(other.ranking.recovery_periods).toBe(2);
            expect(moving_selected.ranking.recovery_periods).toBe(3);
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
            expect(selectedOf(by_default).id).toBe("swings-2");
            expect(searched.skipped_searches).toEqual([]);
            // the other three searches find no clock for this build
            expect(idsOf(searched).filter(id => SEARCH_IDS.includes(id))).toEqual(["derived"]);
            // the planned swings-2 wakes 124.14 a minute, fewer than the derived clock the search finds (194.59): the
            // searches run, and the planned clock keeps winning
            const selected = selectedOf(searched);
            expect(selected.id).toBe("swings-2");
            expect(selected.verdict).toBe("stable");
            expect(selected.assessment.wake_ups_per_minute!).toBeCloseTo(124.14, 2);
        });
    });
});
