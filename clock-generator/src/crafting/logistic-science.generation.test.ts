import {beforeAll, describe, expect, it} from "vitest";
import {loadConfigFromFile} from "../config/loader";
import {ConfigPaths} from "../config/config-paths";
import type {Config} from "../config/schema";
import {generateClockAlternatives, type ClockAlternative, type ClockAlternativesResult} from "./generate-blueprint";
import {alwaysOnReasonProblemsOf, quiet, withSearches, SEARCH_IDS, SEARCH_LABELS, alternativeIdsOf as idsOf, selectedAlternativeOf as selectedOf} from "./generate-blueprint-test-helpers";

const backedUpBelts = (config: Config): Config => ({...config, overrides: {...config.overrides, backed_up_belts: true}});
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

describe("the belt a clock is made for", () => {
    describe("logistic science", () => {
        // the alternatives for the belts as the config has them, for moving belts: the ones made for backed-up belts are compared with them
        const alternative = (id: string) => moving.find(a => a.id === id)!;

        describe("by default", () => {
            it("makes batched swings for a moving belt, with 4 ticks of belt pickup slack", () => {
                const batched = alternative("planned-belt-slack");
                expect(batched.label).toBe("Batched swings: 4 output swings per cycle");
                expect(batched.belt).toEqual({ kind: "moving", slack_ticks: [4] });
                expect(batched.description).toContain("Made for a moving belt: every inserter that picks up from a belt stays enabled 4 more ticks");
            });

            it("offers batched swings for a backed-up belt as a clock of its own", () => {
                const backed_up = alternative("planned");
                expect(backed_up.label).toBe("Batched swings, backed-up belt: 4 output swings per cycle");
                expect(backed_up.belt).toEqual({ kind: "backed_up" });
                expect(backed_up.ranking.matches_belt_choice).toBe(false);
                expect(backed_up.description).toContain("Made for a backed-up belt");
            });

            it("names a clock it left the slack out of a backed-up belt clock, and says why", () => {
                // since belt windows close before their last return swing, swings-2 and swings-1 hold with the
                // slack and export as moving clocks: planned is the one backed-up fallback left
                expect(moving.filter(a => a.belt?.kind === "backed_up").map(a => a.id)).toEqual(["planned"]);
                expect(alternative("swings-2").ranking.matches_belt_choice).toBe(true);
                expect(alternative("swings-2").belt).toEqual({ kind: "moving", slack_ticks: [4] });
                expect(alternative("planned").ranking.matches_belt_choice).toBe(false);
            });

            it("selects the moving clock with the fewest wake-ups", () => {
                // swings-2's trimmed windows wake 82.76 a minute, the fewest of the stable moving clocks
                expect(alternative("swings-2").assessment.wake_ups_per_minute).toBeCloseTo(82.76, 2);
                expect(alternative("swings-2").ranking.meets_target_rate).toBe(true);
                expect(moving_selected.id).toBe("swings-2");
                expect(moving_selected.belt).toEqual({ kind: "moving", slack_ticks: [4] });
            });
        });

        describe("with backed-up belts", () => {
            let alternatives: ClockAlternative[];
            let selected: ClockAlternative;

            beforeAll(() => {
                const generated = generateClockAlternatives(backedUpBelts(config), { logger: quiet });
                alternatives = generated.alternatives;
                selected = alternatives[generated.selected_index];
            });

            it("gives no clock belt pickup slack, as each holds the expected output without it", () => {
                expect(alternatives.map(a => a.belt)).toEqual(alternatives.map(() => ({ kind: "backed_up" })));
                expect(alternatives.every(a => Object.keys(a.result.belt_pickup_slack_ticks).length === 0)).toBe(true);
            });

            it("lists batched swings once, with the windows of the backed-up belt clock", () => {
                expect(alternatives.filter(a => a.label.startsWith("Batched swings")).map(a => a.id)).toEqual(["planned-belt-slack"]);
                expect(alternatives[0].label).toBe("Batched swings: 4 output swings per cycle");
                expect(alternatives[0].result.clock_windows).toEqual(alternative("planned").result.clock_windows);
                expect(alternatives[0].description).toContain("The config says the input belts are backed up");
            });

            it("holds no clock to the slack, and selects the one with the fewest wake-ups", () => {
                expect(alternatives.every(a => a.ranking.matches_belt_choice)).toBe(true);
                expect(selected.id).toBe("swings-2");
                expect(selected.assessment.wake_ups_per_minute).toBe(0);
            });
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
            expect(by_default.skipped_searches).toEqual(SEARCH_LABELS);
            expect(selectedOf(by_default).id).toBe("swings-2");
            expect(searched.skipped_searches).toEqual([]);
            // the other three searches find no clock for this build
            expect(idsOf(searched).filter(id => SEARCH_IDS.includes(id))).toEqual(["derived"]);
            // since belt windows close before their last return swing, the planned swings-2 wakes 82.76 a minute,
            // fewer than the derived clock the search finds: the searches run, and the planned clock keeps winning
            const selected = selectedOf(searched);
            expect(selected.id).toBe("swings-2");
            expect(selected.verdict).toBe("stable");
            expect(selected.assessment.wake_ups_per_minute!).toBeCloseTo(82.76, 2);
        });
    });
});
