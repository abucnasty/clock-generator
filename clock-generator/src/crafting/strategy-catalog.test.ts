import { describe, expect, test } from "vitest";
import type { StrategyId, StrategyRef } from "./clock-strategy";
import { catalogRowOf, fixedTuningMethodOf, routerRowOf, settingChipsOf, strategyRowOf, type ClockSettings, type EnableControlStrategyRouter, type StrategyCatalogRow } from "./strategy-catalog";

// Every strategy and tuning method has its row; typed so that a strategy added to the union fails here until it is listed.
const TUNING_METHODS: Record<StrategyId, StrategyRef["tuning_method"][]> = {
    takt_batches: ["calculated", "observed"],
    round_robin_polling: ["calculated"],
    euclidean_swings: ["observed"],
    time_division_windows: ["calculated"],
    time_study_windows: ["observed"],
    moved_output_swing: ["observed"],
    phase_shifted_batch: ["observed"],
    pitch_pickups: ["observed"],
    exhaust: ["calculated"],
};
const ROUTERS: Record<EnableControlStrategyRouter, true> = { direct: true, coordinated_sources: true };

const words = (row: StrategyCatalogRow) => [row.name, row.line, row.definition, row.practice];

describe("the catalog", () => {
    test("has a row of words for every strategy and tuning method, and the tuning method of the row is the strategy's", () => {
        for (const [id, methods] of Object.entries(TUNING_METHODS) as [StrategyId, StrategyRef["tuning_method"][]][]) {
            for (const tuning_method of methods) {
                const row = catalogRowOf({ id, tuning_method });
                expect(words(row).every(text => text.length > 0), `${id} ${tuning_method}`).toBe(true);
                expect(row.tuning_method, `${id} ${tuning_method}`).toBe(tuning_method);
            }
            expect(fixedTuningMethodOf(id), id).toBe(methods.length === 1 ? methods[0] : null);
        }
    });

    test("tells the two Takt Batches apart by the tuning method", () => {
        expect(catalogRowOf({ id: "takt_batches", tuning_method: "calculated" }).tuning_method).toBe("calculated");
        expect(catalogRowOf({ id: "takt_batches", tuning_method: "observed" }).tuning_method).toBe("observed");
        expect(catalogRowOf({ id: "takt_batches", tuning_method: "calculated" }).name).toBe(catalogRowOf({ id: "takt_batches", tuning_method: "observed" }).name);
    });

    test("has a row of words for every router, and a clock without a strategy of its own is read as its router", () => {
        for (const router of Object.keys(ROUTERS) as EnableControlStrategyRouter[]) expect(words(routerRowOf(router)).every(text => text.length > 0), router).toBe(true);
        expect(routerRowOf("direct").tuning_method).toBeNull();
        expect(strategyRowOf({ id: null, tuning_method: null, routing: { router: "coordinated_sources" } })).toBe(routerRowOf("coordinated_sources"));
        expect(strategyRowOf({ id: "exhaust", tuning_method: "calculated", routing: { router: "direct" } })).toBe(catalogRowOf({ id: "exhaust", tuning_method: "calculated" }));
    });
});

describe("the chip words of the settings", () => {
    const plain: ClockSettings = { output_count: { kind: "output_swings", count: 2 }, window_cycle: [], belt_pickups: [] };

    test("name the output count, and nothing else for the whole window cycle with no other setting", () => {
        expect(settingChipsOf(plain).map(it => it.label)).toEqual(["2 output swings each output cycle"]);
        expect(settingChipsOf({ ...plain, output_count: { kind: "hands_brought_in", count: 3 } }).map(it => it.label)).toEqual(["3 hands brought in each output cycle"]);
    });

    test("have a word for every value, in the order of the fields, all in lower case", () => {
        const labels = settingChipsOf({
            output_count: { kind: "output_swings", count: 1 },
            window_cycle: [{ kind: "shorter_window_cycle" }, { kind: "harmonic_window_cycle" }, { kind: "subtick_clock" }, { kind: "rounded_clock", window_cycle_ticks: 1199, runs_fast: 0.0232 }],
            shared_windows: "window_a_swing", loops: "loop_exits_only", drill_windows: "a_tick_longer",
            belt_pickups: ["counted_from_entry", "room_for_a_hand_of_fuel"],
        }).map(it => it.label);
        expect(labels).toEqual(["1 output swing each output cycle", "shorter window cycle", "harmonic window cycle", "subtick clock", "rounded to 1199 ticks, 2.32% fast",
            "one enable window a swing", "kanban pull: loop exits only", "drill windows a tick longer", "pickups counted from entry", "room for a hand of fuel"]);
        expect(labels.every(label => label === label.toLowerCase())).toBe(true);
        expect(settingChipsOf({ ...plain, output_count: { kind: "hands_brought_in", count: 1 } })[0].label).toBe("1 hand brought in each output cycle");
        expect(settingChipsOf({ ...plain, shared_windows: "shared_enable_windows", loops: "loop_windows" }).map(it => it.label).slice(1))
            .toEqual(["shared enable windows", "kanban pull: loop windows"]);
        expect(settingChipsOf({ ...plain, window_cycle: [{ kind: "rounded_clock", window_cycle_ticks: 10, runs_fast: 0.00001 }] })[1].label).toBe("rounded to 10 ticks, under 0.01% fast");
    });
});
