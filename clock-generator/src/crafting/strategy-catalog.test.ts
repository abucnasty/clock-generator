import { describe, expect, test } from "vitest";
import type { StrategyConstruction, StrategyFamily } from "./clock-strategy";
import { catalogRowOf, routerRowOf, settingChipsOf, type ClockSettings, type EnableControlStrategyRouter, type StrategyCatalogRow } from "./strategy-catalog";

// Every family and construction of a strategy has its row; typed so that a family added to the union fails here until it is listed.
const CONSTRUCTIONS: Record<StrategyFamily, (StrategyConstruction | undefined)[]> = {
    "takt-batches": ["arithmetic", "planning-run"],
    "round-robin-polling": ["grouped-hands"],
    "euclidean-swings": ["planning-run"],
    "time-division-slots": [undefined],
    "time-study-windows": [undefined],
    "moved-output-swing": [undefined],
    "signal-offset": [undefined],
    "pitch-pickups": [undefined],
    "exhaust": [undefined],
    "per-branch": [undefined],
};
const ROUTERS: Record<EnableControlStrategyRouter, true> = { direct: true, coordinated_sources: true };

const words = (row: StrategyCatalogRow) => [row.name, row.line, row.definition, row.practice];

describe("the catalog", () => {
    test("has a row of words for every family and construction", () => {
        for (const [family, constructions] of Object.entries(CONSTRUCTIONS) as [StrategyFamily, (StrategyConstruction | undefined)[]][]) {
            for (const construction of constructions) {
                const row = catalogRowOf({ family, ...(construction !== undefined && { construction }) });
                expect(words(row).every(text => text.length > 0), `${family} ${construction}`).toBe(true);
            }
        }
    });

    test("tells the two Takt Batches apart by the tuning method", () => {
        expect(catalogRowOf({ family: "takt-batches", construction: "arithmetic" }).tuning_method).toBe("calculated");
        expect(catalogRowOf({ family: "takt-batches", construction: "planning-run" }).tuning_method).toBe("observed");
        expect(catalogRowOf({ family: "takt-batches", construction: "arithmetic" }).name).toBe(catalogRowOf({ family: "takt-batches", construction: "planning-run" }).name);
    });

    test("has a row of words for every router, and Coordinated Sources is the per-branch row", () => {
        for (const router of Object.keys(ROUTERS) as EnableControlStrategyRouter[]) expect(words(routerRowOf(router)).every(text => text.length > 0), router).toBe(true);
        expect(routerRowOf("coordinated_sources")).toBe(catalogRowOf({ family: "per-branch" }));
        expect(routerRowOf("direct").tuning_method).toBeNull();
    });
});

describe("the chip words of the settings", () => {
    const plain: ClockSettings = { output_count: { kind: "output_swings", count: 2 }, window_cycle: [], belt_pickups: [] };

    test("name the output count, and nothing else for the whole window cycle with no other setting", () => {
        expect(settingChipsOf(plain).map(it => it.label)).toEqual(["output swings 2"]);
        expect(settingChipsOf({ ...plain, output_count: { kind: "hands_brought_in", count: 3 } }).map(it => it.label)).toEqual(["hands brought in 3"]);
    });

    test("have a word for every value, in the order of the fields, all in lower case", () => {
        const labels = settingChipsOf({
            output_count: { kind: "output_swings", count: 1 },
            window_cycle: [{ kind: "shorter_window_cycle" }, { kind: "harmonic_window_cycle" }, { kind: "subtick_clock" }, { kind: "rounded_clock", period_ticks: 1199, runs_fast: 0.0232 }],
            shared_windows: "window_a_swing", loops: "loop_exits_only", drill_windows: "a_tick_longer",
            belt_pickups: ["counted_from_entry", "room_for_a_hand_of_fuel"],
        }).map(it => it.label);
        expect(labels).toEqual(["output swings 1", "shorter window cycle", "harmonic window cycle", "subtick clock", "rounded to 1199 ticks, 2.32% fast",
            "one enable window a swing", "kanban pull: loop exits only", "drill windows a tick longer", "pickups counted from entry", "room for a hand of fuel"]);
        expect(labels.every(label => label === label.toLowerCase())).toBe(true);
        expect(settingChipsOf({ ...plain, shared_windows: "shared_enable_windows", loops: "loop_windows" }).map(it => it.label).slice(1))
            .toEqual(["shared enable windows", "kanban pull: loop windows"]);
        expect(settingChipsOf({ ...plain, window_cycle: [{ kind: "rounded_clock", period_ticks: 10, runs_fast: 0.00001 }] })[1].label).toBe("rounded to 10 ticks, under 0.01% fast");
    });
});
