import { describe, expect, test } from "vitest";
import { constructionOf, strategyListedAs, strategyOf, StrategyFindings } from "./clock-strategy";
import type { ClockSettings } from "./strategy-catalog";

// The strategy of a clock is read off what the run made, as ids. Hand-made result stubs here; no generation (the grouped hands and
// shared windows cases on real builds are in shared-windows.generation.test.ts, every job of the record in record-properties.ts).
const result = (extra: Record<string, unknown> = {}) => ({ fuel_hand_room_ticks: {}, used_terminal_swing_count: 2, ...extra }) as Parameters<typeof strategyOf>[1];
const plain: ClockSettings = { output_count: { kind: "output_swings", count: 2 }, window_cycle: [], belt_pickups: [] };
const findings = (extra: Partial<StrategyFindings> = {}): StrategyFindings => ({ definition_qualifiers: [], destroyed_target: false, ...extra });

describe("constructionOf", () => {
    test("is the planning run unless a maker leaves its mark", () => {
        expect(constructionOf({})).toBe("planning-run");
        expect(constructionOf({ window_maker: "arithmetic" })).toBe("arithmetic");
    });

    test("is the grouped hands for the grouped hands rule's result and for small batches", () => {
        expect(constructionOf({ round_robin_polling: { shared_windows: false } })).toBe("grouped-hands");
        expect(constructionOf({ primitive_round_robin_polling: {} as never })).toBe("grouped-hands");
        // the grouped hands win over the arithmetic mark: the mark is only of a clock made by arithmetic
        expect(constructionOf({ window_maker: "arithmetic", round_robin_polling: { shared_windows: false } })).toBe("grouped-hands");
    });
});

describe("strategyOf", () => {
    test("batched swings are takt batches from the planning run and from arithmetic, round-robin polling from the grouped hands", () => {
        expect(strategyOf("batched-swings", result(), findings())).toEqual({ family: "takt-batches", qualifiers: ["output-swings"], settings: plain, construction: "planning-run", output_swings: 2, routing: { router: "direct" } });
        expect(strategyOf("batched-swings", result({ window_maker: "arithmetic" }), findings()).construction).toBe("arithmetic");
        const grouped = strategyOf("batched-swings", result({ round_robin_polling: { shared_windows: false } }), findings());
        expect(grouped).toMatchObject({ family: "round-robin-polling", construction: "grouped-hands" });
    });

    test("shared windows are read off the result, and a window a swing from the definition (the per-hand clock's result shares none)", () => {
        const shared = strategyOf("batched-swings", result({ round_robin_polling: { shared_windows: true } }), findings());
        expect(shared.qualifiers).toEqual(["output-swings", "shared-enable-windows"]);
        expect(shared.settings.shared_windows).toBe("shared_enable_windows");
        const a_swing = strategyOf("batched-swings", result({ round_robin_polling: { shared_windows: false } }), findings({ definition_qualifiers: ["shorter-window-cycle", "window-a-swing"] }));
        expect(a_swing.qualifiers).toEqual(["output-swings", "shorter-window-cycle", "window-a-swing"]);
        expect(a_swing.settings).toEqual({ ...plain, window_cycle: [{ kind: "shorter_window_cycle" }], shared_windows: "window_a_swing" });
    });

    test("small batches are round-robin polling with a shorter window cycle", () => {
        const small = strategyOf("round-robin-polling", result({ primitive_round_robin_polling: {} }), findings({ definition_qualifiers: ["shorter-window-cycle"] }));
        expect(small).toEqual({ family: "round-robin-polling", qualifiers: ["output-swings", "shorter-window-cycle"], settings: { ...plain, window_cycle: [{ kind: "shorter_window_cycle" }] }, construction: "grouped-hands", output_swings: 2, routing: { router: "direct" } });
    });

    test("a family of its own has no construction, and a search says so", () => {
        const searched = strategyOf("signal-offset", result({ window_maker: "arithmetic" }), findings({ definition_qualifiers: ["found-by-search"] }));
        expect(searched).toEqual({ family: "signal-offset", qualifiers: ["output-swings", "found-by-search"], settings: plain, output_swings: 2, routing: { router: "direct" } });
        expect(strategyOf("euclidean-swings", result(), findings()).construction).toBe("planning-run");
    });

    test("pickups counted from their entry and the rounded-up hands of rule F leave a mark each", () => {
        expect(strategyOf("batched-swings", result({ pickups_from_entry: true }), findings()).qualifiers).toEqual(["output-swings", "pickups-from-entry"]);
        const harmonic = strategyOf("batched-swings", result({ round_robin_polling: { shared_windows: false, harmonic_window_cycle: true } }), findings());
        expect(harmonic).toMatchObject({ family: "round-robin-polling", qualifiers: ["output-swings", "harmonic-window-cycle"] });
        expect(strategyOf("batched-swings", result({ round_robin_polling: { shared_windows: false } }), findings()).qualifiers).toEqual(["output-swings"]);
    });

    test("a target that counts an item destroyed brings in hands instead of output swings", () => {
        expect(strategyOf("time-division-slots", result(), findings({ destroyed_target: true })).qualifiers).toEqual(["hands-brought-in"]);
    });

    test("loop windows, the chest drill fallback and room for fuel are read off what the run kept", () => {
        const all = strategyOf("batched-swings", result({ loop_windows: { inserter_ids: ["a"], window_count_without_loop_windows: 1, in_loop_ids: ["b"] } }), findings());
        expect(all.qualifiers).toEqual(["output-swings", "loop-windows"]);
        const exits = strategyOf("batched-swings", result({ loop_windows: { inserter_ids: ["a"], window_count_without_loop_windows: 1 } }), findings());
        expect(exits.qualifiers).toEqual(["output-swings", "loop-exits-only"]);
        expect(strategyOf("batched-swings", result(), findings({ chest_drill_fallback: "tick-longer" })).qualifiers).toEqual(["output-swings", "drill-windows-longer"]);
        expect(strategyOf("batched-swings", result(), findings({ chest_drill_fallback: "always-on" })).qualifiers).toEqual(["output-swings", "drills-always-on"]);
        expect(strategyOf("batched-swings", result({ fuel_hand_room_ticks: { "inserter:3": 4 } }), findings()).qualifiers).toEqual(["output-swings", "fuel-hand-room"]);
    });
});

describe("the router of a strategy", () => {
    test("is direct for every clock but the per-branch one", () => {
        expect(strategyOf("takt-batches", result(), findings()).routing).toEqual({ router: "direct" });
        expect(strategyOf("batched-swings", result({ round_robin_polling: { shared_windows: false } }), findings()).routing).toEqual({ router: "direct" });
        expect(strategyOf("exhaust", result(), findings()).routing).toEqual({ router: "direct" });
    });

    test("is Coordinated Sources on the per-branch clock, with the sources the run recorded", () => {
        const sources = [{ source: "machine:1", entities: { "inserter:1": { kind: "strategy" as const, family: "exhaust" as const } } }];
        expect(strategyOf("per-branch", result({ coordinated_sources: { parts: { "machine:1": "exhaust" }, sources } }), findings()).routing)
            .toEqual({ router: "coordinated_sources", sources });
    });
});

describe("the settings of a strategy", () => {
    test("hold the output count as the clock was made, and found by search and drills left always enabled are not settings", () => {
        expect(strategyOf("time-division-slots", result(), findings({ destroyed_target: true })).settings.output_count).toEqual({ kind: "hands_brought_in", count: 2 });
        const searched = strategyOf("signal-offset", result(), findings({ definition_qualifiers: ["found-by-search"], chest_drill_fallback: "always-on" }));
        expect(searched.settings).toEqual(plain);
        expect(searched.qualifiers).toEqual(["output-swings", "found-by-search", "drills-always-on"]);
    });

    test("read loops, the drill windows and the belt pickups off what the run kept; the belt pickups can both be set", () => {
        const kept = strategyOf("batched-swings", result({ pickups_from_entry: true, fuel_hand_room_ticks: { "inserter:3": 4 },
            loop_windows: { inserter_ids: ["a"], window_count_without_loop_windows: 1 } }), findings({ chest_drill_fallback: "tick-longer" }));
        expect(kept.settings).toEqual({ ...plain, loops: "loop_exits_only", drill_windows: "a_tick_longer", belt_pickups: ["counted_from_entry", "room_for_a_hand_of_fuel"] });
        expect(kept.qualifiers).toEqual(["output-swings", "pickups-from-entry", "loop-exits-only", "drill-windows-longer", "fuel-hand-room"]);
    });

    test("add what the listing of a clock adds to the window cycle, which can follow a harmonic or shorter one", () => {
        const harmonic = strategyOf("batched-swings", result({ round_robin_polling: { shared_windows: false, harmonic_window_cycle: true } }), findings());
        const subtick = strategyListedAs(harmonic, { qualifiers: ["phase-accumulator"] });
        expect(subtick.settings.window_cycle).toEqual([{ kind: "harmonic_window_cycle" }, { kind: "subtick_clock" }]);
        expect(subtick.qualifiers).toEqual(["output-swings", "harmonic-window-cycle", "phase-accumulator"]);
        const rounded = strategyListedAs(harmonic, { qualifiers: ["rounded-clock"], rounded: { period_ticks: 1199, runs_fast: 0.0008 } });
        expect(rounded.settings.window_cycle).toEqual([{ kind: "harmonic_window_cycle" }, { kind: "rounded_clock", period_ticks: 1199, runs_fast: 0.0008 }]);
        expect(() => strategyListedAs(harmonic, { qualifiers: ["rounded-clock"] })).toThrow("rounded");
        expect(strategyListedAs(harmonic, {})).toEqual(harmonic);
    });
});
