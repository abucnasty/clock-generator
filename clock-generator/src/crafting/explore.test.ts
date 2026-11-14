import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ConfigPaths } from "../config/config-paths";
import { loadConfigFromFile } from "../config/loader";
import { planClockAlternatives, runClockAlternativeTask, type ClockAlternative } from "./alternatives";
import { clockIdentity } from "./clock-identity";
import { exploredClocksOf, isExplored, STRATEGY_STATUS } from "./explore";
import { generateClockAlternatives } from "./generate-blueprint";
import { quiet } from "./generate-blueprint-test-helpers";
import type { ClockRanking } from "./rank";

const options = { logger: quiet, factorio_states: false, fuel_consumption_view: false };

/** An alternative with the ranking only, which is all the selection reads */
const ranked = (id: string, ranking: Partial<ClockRanking> = {}): ClockAlternative => ({
    id,
    ranking: { meets_target_rate: true, rate_off_target: 0, holds_expected_output: true, wake_ups_per_minute: 100, window_count: 10, ...ranking },
}) as unknown as ClockAlternative;
const run = (alternative: ClockAlternative) => ({ signature: alternative.id, alternatives: [alternative] });

describe("the explored clocks of a generation", () => {
    it("have no best clock where the explored strategies made none", () => {
        expect(exploredClocksOf(ranked("selected"), [], [])).toEqual({ alternatives: [], best_index: null, beats_selection: false, same_as_shipped: [] });
        expect(exploredClocksOf(ranked("selected"), [null], ["x"])).toMatchObject({ best_index: null, beats_selection: false, same_as_shipped: ["x"] });
    });

    it("beat the selected clock by the ranking that selects, a tie not beating it", () => {
        const selected = ranked("selected", { wake_ups_per_minute: 100 });
        const fewer = exploredClocksOf(selected, [run(ranked("a", { wake_ups_per_minute: 120 })), run(ranked("b", { wake_ups_per_minute: 40 }))], []);
        expect(fewer.best_index).toBe(1);
        expect(fewer.beats_selection).toBe(true);
        expect(exploredClocksOf(selected, [run(ranked("c", { wake_ups_per_minute: 100 }))], []).beats_selection).toBe(false);
        expect(exploredClocksOf(selected, [run(ranked("d", { wake_ups_per_minute: 101 }))], []).beats_selection).toBe(false);
        // goal 1 comes before the wake-ups
        expect(exploredClocksOf(selected, [run(ranked("e", { wake_ups_per_minute: 0, meets_target_rate: false }))], []).beats_selection).toBe(false);
    });
});

describe("the option with every strategy shipped", () => {
    it("reports no explored clock and leaves the generation as it is", async () => {
        expect(Object.values(STRATEGY_STATUS)).not.toContain("explored");
        const config = await loadConfigFromFile(ConfigPaths.IRON_PLATE_80_CAR_CHEST);
        const without = generateClockAlternatives(config, options);
        const { explored, ...with_option } = generateClockAlternatives(config, { ...options, explore_strategies: true });
        expect(explored).toEqual({ alternatives: [], best_index: null, beats_selection: false, same_as_shipped: [] });
        expect(without).not.toHaveProperty("explored");
        expect(with_option.alternatives.map(it => it.id)).toEqual(without.alternatives.map(it => it.id));
        expect(with_option.selected_index).toBe(without.selected_index);
    }, 120_000);
});

// A strategy marked explored here only: no strategy of the shipped code is. Time-Study Windows is offered on this sample, and makes a clock the other alternatives do not.
describe("a strategy that is explored", () => {
    const shipped_status = STRATEGY_STATUS.time_study_windows;
    const identityOf = (alternative: ClockAlternative) => JSON.stringify(clockIdentity(alternative.result.subtick ?? alternative.result));
    let config: Awaited<ReturnType<typeof loadConfigFromFile>>;

    beforeAll(async () => {
        config = await loadConfigFromFile(ConfigPaths.IRON_PLATE_80_CAR_CHEST);
        STRATEGY_STATUS.time_study_windows = "explored";
    });
    afterAll(() => { STRATEGY_STATUS.time_study_windows = shipped_status; });

    it("is marked by its status alone", () => {
        expect(isExplored("time_study_windows")).toBe(true);
        expect(isExplored("batched_swings")).toBe(false);
        expect(isExplored("coordinated_sources")).toBe(false);
    });

    it("is not planned or run without the option", () => {
        const plan = planClockAlternatives(config, options);
        expect(plan.tasks.map(task => task.id)).not.toContain("derived");
        expect(() => runClockAlternativeTask(config, plan.context, "derived", options)).toThrow("Unknown clock task");
        expect(generateClockAlternatives(config, options).explored).toBeUndefined();
    }, 120_000);

    it("is planned, run and reported with the option, and the selection is the one without it", () => {
        const plan = planClockAlternatives(config, { ...options, explore_strategies: true });
        expect(plan.tasks.find(task => task.id === "derived")).toMatchObject({ explored: true });
        expect(plan.tasks.filter(task => task.explored === true).map(task => task.id)).toEqual(["derived"]);
        expect(runClockAlternativeTask(config, plan.context, "derived", { ...options, explore_strategies: true })).not.toBeNull();

        const without = generateClockAlternatives(config, options);
        const explore = generateClockAlternatives(config, { ...options, explore_strategies: true });
        const { explored, ...selection } = explore;
        expect(explored).toBeDefined();
        expect(explored!.best_index).not.toBeNull();
        const best = explored!.alternatives[explored!.best_index!];
        expect(best.strategy.id).toBe("time_study_windows");
        expect(explored!.alternatives.every(it => it.strategy.id === "time_study_windows")).toBe(true);
        // the shipped alternatives and the selected one are the ones without the option
        expect(selection.alternatives.map(it => it.id)).toEqual(without.alternatives.map(it => it.id));
        expect(selection.alternatives.map(identityOf)).toEqual(without.alternatives.map(identityOf));
        expect(selection.selected_index).toBe(without.selected_index);
        expect(selection.alternatives.some(it => it.strategy.id === "time_study_windows")).toBe(false);
        expect(selection.not_made).toEqual(without.not_made);
        expect(selection.why_not_stable).toEqual(without.why_not_stable);
        // and it beats the selection exactly when the ranking says so
        const selected = selection.alternatives[selection.selected_index];
        expect(explored).toEqual(exploredClocksOf(selected, [{ signature: "explored", alternatives: explored!.alternatives }], explored!.same_as_shipped));
    }, 300_000);
});
