import { describe, expect, test } from "vitest";
import { constructionOf, strategyOf, StrategyFindings } from "./clock-strategy";

// The strategy of a clock is read off what the run made, as ids. Hand-made result stubs here; no generation (the grouped hands and
// shared windows cases on real builds are in shared-windows.generation.test.ts, every job of the record in record-properties.ts).
const result = (extra: Record<string, unknown> = {}) => ({ fuel_hand_room_ticks: {}, used_terminal_swing_count: 2, ...extra }) as Parameters<typeof strategyOf>[1];
const findings = (extra: Partial<StrategyFindings> = {}): StrategyFindings => ({ definition_qualifiers: [], destroyed_target: false, ...extra });

describe("constructionOf", () => {
    test("is the planning run unless a maker leaves its mark", () => {
        expect(constructionOf({})).toBe("planning-run");
        expect(constructionOf({ window_maker: "arithmetic" })).toBe("arithmetic");
    });

    test("is the grouped hands for the grouped hands rule's result and for small batches", () => {
        expect(constructionOf({ grouped_hands: { shared_windows: false } })).toBe("grouped-hands");
        expect(constructionOf({ primitive_grouped: {} as never })).toBe("grouped-hands");
        // the grouped hands win over the arithmetic mark: the mark is only of a clock made by arithmetic
        expect(constructionOf({ window_maker: "arithmetic", grouped_hands: { shared_windows: false } })).toBe("grouped-hands");
    });
});

describe("strategyOf", () => {
    test("batched swings are takt batches from the planning run and from arithmetic, round-robin polling from the grouped hands", () => {
        expect(strategyOf("batched-swings", result(), findings())).toEqual({ family: "takt-batches", qualifiers: ["output-swings"], construction: "planning-run", output_swings: 2, routing: { router: "direct" } });
        expect(strategyOf("batched-swings", result({ window_maker: "arithmetic" }), findings()).construction).toBe("arithmetic");
        const grouped = strategyOf("batched-swings", result({ grouped_hands: { shared_windows: false } }), findings());
        expect(grouped).toMatchObject({ family: "round-robin-polling", construction: "grouped-hands" });
    });

    test("shared windows are read off the result, and the definition's qualifiers follow", () => {
        const shared = strategyOf("batched-swings", result({ grouped_hands: { shared_windows: true } }), findings({ definition_qualifiers: ["window-a-swing"] }));
        expect(shared.qualifiers).toEqual(["output-swings", "shared-enable-windows", "window-a-swing"]);
    });

    test("small batches are round-robin polling with a shorter window cycle", () => {
        const small = strategyOf("round-robin-polling", result({ primitive_grouped: {} }), findings({ definition_qualifiers: ["shorter-window-cycle"] }));
        expect(small).toEqual({ family: "round-robin-polling", qualifiers: ["output-swings", "shorter-window-cycle"], construction: "grouped-hands", output_swings: 2, routing: { router: "direct" } });
    });

    test("a family of its own has no construction, and a search says so", () => {
        const searched = strategyOf("signal-offset", result({ window_maker: "arithmetic" }), findings({ definition_qualifiers: ["found-by-search"] }));
        expect(searched).toEqual({ family: "signal-offset", qualifiers: ["output-swings", "found-by-search"], output_swings: 2, routing: { router: "direct" } });
        expect(strategyOf("euclidean-swings", result(), findings()).construction).toBe("planning-run");
    });

    test("pickups counted from their entry and the rounded-up hands of rule F leave a mark each", () => {
        expect(strategyOf("batched-swings", result({ pickups_from_entry: true }), findings()).qualifiers).toEqual(["output-swings", "pickups-from-entry"]);
        const harmonic = strategyOf("batched-swings", result({ grouped_hands: { shared_windows: false, harmonic_window_cycle: true } }), findings());
        expect(harmonic).toMatchObject({ family: "round-robin-polling", qualifiers: ["output-swings", "harmonic-window-cycle"] });
        expect(strategyOf("batched-swings", result({ grouped_hands: { shared_windows: false } }), findings()).qualifiers).toEqual(["output-swings"]);
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
        expect(strategyOf("batched-swings", result({ grouped_hands: { shared_windows: false } }), findings()).routing).toEqual({ router: "direct" });
        expect(strategyOf("exhaust", result(), findings()).routing).toEqual({ router: "direct" });
    });

    test("is Coordinated Sources on the per-branch clock, with the sources the run recorded", () => {
        const sources = [{ source: "machine:1", entities: { "inserter:1": { kind: "strategy" as const, family: "exhaust" as const } } }];
        expect(strategyOf("per-branch", result({ per_branch: { parts: { "machine:1": "exhaust" }, sources } }), findings()).routing)
            .toEqual({ router: "coordinated_sources", sources });
    });
});
