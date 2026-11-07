import { describe, expect, test } from "vitest";
import { alternativeIdOf, strategyListedAs, strategyOf, StrategyFindings } from "./clock-strategy";
import type { ClockSettings } from "./strategy-catalog";

// The strategy of a clock is read off what the run made, as ids. Hand-made result stubs here; no generation (the Round-Robin Polling and
// shared windows cases on real builds are in shared-windows.generation.test.ts, every job of the record in record-properties.ts).
const result = (extra: Record<string, unknown> = {}) => ({ fuel_hand_room_ticks: {}, used_terminal_swing_count: 2, ...extra }) as Parameters<typeof strategyOf>[1];
const plain: ClockSettings = { output_count: { kind: "output_swings", count: 2 }, window_cycle: [], belt_pickups: [] };
const findings = (extra: Partial<StrategyFindings> = {}): StrategyFindings => ({ destroyed_target: false, ...extra });

describe("strategyOf", () => {
    test("batched swings are Takt Batches, calculated where the arithmetic made them and observed from the unclocked run, and Round-Robin Polling from its rule", () => {
        expect(strategyOf("batched_swings", result(), findings())).toEqual({ id: "takt_batches", tuning_method: "observed", settings: plain, output_swings: 2, routing: { router: "direct" } });
        expect(strategyOf("batched_swings", result({ window_maker: "arithmetic" }), findings())).toMatchObject({ id: "takt_batches", tuning_method: "calculated" });
        const polling = strategyOf("batched_swings", result({ round_robin_polling: { shared_windows: false } }), findings());
        expect(polling).toMatchObject({ id: "round_robin_polling", tuning_method: "calculated" });
        // Round-Robin Polling wins over the arithmetic mark: the mark is only of a clock made by arithmetic
        expect(strategyOf("batched_swings", result({ window_maker: "arithmetic", round_robin_polling: { shared_windows: false } }), findings()).id).toBe("round_robin_polling");
    });

    test("shared windows are read off the result, and a window a swing from the definition (the per-hand clock's result shares none)", () => {
        const shared = strategyOf("batched_swings", result({ round_robin_polling: { shared_windows: true } }), findings());
        expect(shared.settings.shared_windows).toBe("shared_enable_windows");
        const a_swing = strategyOf("batched_swings", result({ round_robin_polling: { shared_windows: false } }), findings({ definition_settings: { shorter_window_cycle: true, window_a_swing: true } }));
        expect(a_swing.settings).toEqual({ ...plain, window_cycle: [{ kind: "shorter_window_cycle" }], shared_windows: "window_a_swing" });
    });

    test("small batches are Round-Robin Polling with a shorter window cycle", () => {
        const small = strategyOf("round_robin_polling", result({ primitive_round_robin_polling: {} }), findings({ definition_settings: { shorter_window_cycle: true } }));
        expect(small).toEqual({ id: "round_robin_polling", tuning_method: "calculated", settings: { ...plain, window_cycle: [{ kind: "shorter_window_cycle" }] }, output_swings: 2, routing: { router: "direct" } });
    });

    test("every other strategy has the tuning method of its catalog row", () => {
        expect(strategyOf("phase_shifted_batch", result({ window_maker: "arithmetic" }), findings())).toEqual({ id: "phase_shifted_batch", tuning_method: "observed", settings: plain, output_swings: 2, routing: { router: "direct" } });
        expect(strategyOf("euclidean_swings", result(), findings()).tuning_method).toBe("observed");
        expect(strategyOf("exhaust", result(), findings()).tuning_method).toBe("calculated");
    });

    test("pickups counted from their entry and the rounded-up hands of rule F leave a mark each", () => {
        expect(strategyOf("batched_swings", result({ pickups_from_entry: true }), findings()).settings.belt_pickups).toEqual(["counted_from_entry"]);
        const harmonic = strategyOf("batched_swings", result({ round_robin_polling: { shared_windows: false, harmonic_window_cycle: true } }), findings());
        expect(harmonic).toMatchObject({ id: "round_robin_polling" });
        expect(harmonic.settings.window_cycle).toEqual([{ kind: "harmonic_window_cycle" }]);
        expect(strategyOf("batched_swings", result({ round_robin_polling: { shared_windows: false } }), findings()).settings).toEqual(plain);
    });

    test("loop windows, the chest drill fallback and room for fuel are read off what the run kept", () => {
        const all = strategyOf("batched_swings", result({ loop_windows: { inserter_ids: ["a"], window_count_without_loop_windows: 1, in_loop_ids: ["b"] } }), findings());
        expect(all.settings.loops).toBe("loop_windows");
        const exits = strategyOf("batched_swings", result({ loop_windows: { inserter_ids: ["a"], window_count_without_loop_windows: 1 } }), findings());
        expect(exits.settings.loops).toBe("loop_exits_only");
        expect(strategyOf("batched_swings", result(), findings({ chest_drill_fallback: "tick-longer" })).settings.drill_windows).toBe("a_tick_longer");
        // drills left always enabled are an always-on reason of the clock, not a setting
        expect(strategyOf("batched_swings", result(), findings({ chest_drill_fallback: "always-on" })).settings).toEqual(plain);
        expect(strategyOf("batched_swings", result({ fuel_hand_room_ticks: { "inserter:3": 4 } }), findings()).settings.belt_pickups).toEqual(["room_for_a_hand_of_fuel"]);
    });
});

describe("the router of a strategy", () => {
    test("is direct for every clock but the Coordinated Sources one", () => {
        expect(strategyOf("takt_batches", result(), findings()).routing).toEqual({ router: "direct" });
        expect(strategyOf("batched_swings", result({ round_robin_polling: { shared_windows: false } }), findings()).routing).toEqual({ router: "direct" });
        expect(strategyOf("exhaust", result(), findings()).routing).toEqual({ router: "direct" });
    });

    test("is Coordinated Sources on its clock, which has no strategy of its own, with the sources the run recorded", () => {
        const sources = [{ source: "machine:1", entities: { "inserter:1": { kind: "strategy" as const, id: "exhaust" as const, tuning_method: "calculated" as const } } }];
        const clock = strategyOf("coordinated_sources", result({ coordinated_sources: { parts: { "machine:1": "exhaust" }, sources } }), findings());
        expect(clock.routing).toEqual({ router: "coordinated_sources", sources });
        expect(clock).toMatchObject({ id: null, tuning_method: null });
    });
});

describe("the settings of a strategy", () => {
    test("hold the output count as the clock was made, and found by search and drills left always enabled are not settings", () => {
        expect(strategyOf("time_division_windows", result(), findings({ destroyed_target: true })).settings.output_count).toEqual({ kind: "hands_brought_in", count: 2 });
        expect(strategyOf("phase_shifted_batch", result(), findings({ chest_drill_fallback: "always-on" })).settings).toEqual(plain);
    });

    test("read loops, the drill windows and the belt pickups off what the run kept; the belt pickups can both be set", () => {
        const kept = strategyOf("batched_swings", result({ pickups_from_entry: true, fuel_hand_room_ticks: { "inserter:3": 4 },
            loop_windows: { inserter_ids: ["a"], window_count_without_loop_windows: 1 } }), findings({ chest_drill_fallback: "tick-longer" }));
        expect(kept.settings).toEqual({ ...plain, loops: "loop_exits_only", drill_windows: "a_tick_longer", belt_pickups: ["counted_from_entry", "room_for_a_hand_of_fuel"] });
    });

    test("add what the listing of a clock adds to the window cycle, which can follow a harmonic or shorter one", () => {
        const harmonic = strategyOf("batched_swings", result({ round_robin_polling: { shared_windows: false, harmonic_window_cycle: true } }), findings());
        const subtick = strategyListedAs(harmonic, { subtick_clock: true });
        expect(subtick.settings.window_cycle).toEqual([{ kind: "harmonic_window_cycle" }, { kind: "subtick_clock" }]);
        const rounded = strategyListedAs(harmonic, { rounded: { period_ticks: 1199, runs_fast: 0.0008 } });
        expect(rounded.settings.window_cycle).toEqual([{ kind: "harmonic_window_cycle" }, { kind: "rounded_clock", period_ticks: 1199, runs_fast: 0.0008 }]);
        expect(strategyListedAs(harmonic, {})).toEqual(harmonic);
    });
});

describe("the id of an alternative", () => {
    const made = (definition: Parameters<typeof strategyOf>[0], extra: Record<string, unknown> = {}, found: Partial<StrategyFindings> = {}) =>
        strategyOf(definition, result(extra), findings(found));

    test("is the strategy's id, with _observed for the Takt Batches whose windows are read off the unclocked run", () => {
        expect(alternativeIdOf(made("batched_swings", { window_maker: "arithmetic" }), {})).toBe("takt_batches");
        expect(alternativeIdOf(made("batched_swings"), {})).toBe("takt_batches_observed");
        expect(alternativeIdOf(made("euclidean_swings"), {})).toBe("euclidean_swings");
        expect(alternativeIdOf(made("phase_shifted_batch"), {})).toBe("phase_shifted_batch");
    });

    test("is the router's for Coordinated Sources", () => {
        expect(alternativeIdOf(made("coordinated_sources"), {})).toBe("coordinated_sources");
    });

    test("says the output count of a maker that offers another than the plan's", () => {
        expect(alternativeIdOf(strategyOf("batched_swings", result({ window_maker: "arithmetic", used_terminal_swing_count: 6 }), findings()), { offers_output_count: true })).toBe("takt_batches_swings_6");
    });

    test("says the settings that set clocks of one strategy apart: shorter window cycle, shared or per-hand windows, subtick clock", () => {
        const polling = { round_robin_polling: { shared_windows: false } };
        expect(alternativeIdOf(made("batched_swings", polling), {})).toBe("round_robin_polling");
        expect(alternativeIdOf(made("round_robin_polling", { primitive_round_robin_polling: {} }, { definition_settings: { shorter_window_cycle: true } }), {})).toBe("round_robin_polling_shorter_window_cycle");
        expect(alternativeIdOf(made("batched_swings", { round_robin_polling: { shared_windows: true } }), {})).toBe("round_robin_polling_shared");
        expect(alternativeIdOf(made("batched_swings", polling, { definition_settings: { window_a_swing: true } }), {})).toBe("round_robin_polling_per_hand");
        expect(alternativeIdOf(strategyListedAs(made("batched_swings", polling), { subtick_clock: true }), {})).toBe("round_robin_polling_subtick");
    });
});
