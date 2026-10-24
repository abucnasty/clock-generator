import { beforeAll, describe, expect, it } from "vitest";
import { parseConfig } from "../config/loader";
import type { Config } from "../config/schema";
import { createEntityRegistryFromConfig } from "./sequence/simulation-context";
import { exportShortfallsOfPeriod, exportShortfallsOfRun, exportedItemsOf } from "./export-delivery";
import { clockFromWindows, generateClockForConfig, type SerializableClockWindows } from "./generate-blueprint";
import { quiet } from "./generate-blueprint-test-helpers";

// Gears are the target; a second machine makes copper cable, which two inserters put on belt 2, an export belt of two
// lanes of cable that consumers outside the config take 3 a second each from
const SMALL_BUILD = JSON.stringify({
    target_output: { recipe: "iron-gear-wheel", items_per_second: 4, copies: 1 },
    machines: [
        { id: 1, recipe: "iron-gear-wheel", productivity: 0, crafting_speed: 2, type: "machine" },
        { id: 2, recipe: "copper-cable", productivity: 0, crafting_speed: 2, type: "machine" },
    ],
    belts: [
        { id: 1, type: "turbo-transport-belt", lanes: [{ ingredient: "iron-plate", stack_size: 4 }, { ingredient: "copper-plate", stack_size: 4 }] },
        { id: 2, type: "turbo-transport-belt", strategy: "export", lanes: [
            { ingredient: "copper-cable", stack_size: 4, consumption_per_second: 3 },
            { ingredient: "copper-cable", stack_size: 4, consumption_per_second: 3 },
        ] },
        { id: 3, type: "turbo-transport-belt", lanes: [{ ingredient: "iron-gear-wheel", stack_size: 4 }] },
    ],
    inserters: [
        { id: 1, source: { type: "belt", id: 1 }, sink: { type: "machine", id: 1 }, stack_size: 16, filters: ["iron-plate"] },
        { id: 2, source: { type: "machine", id: 1 }, sink: { type: "belt", id: 3 }, stack_size: 16, filters: ["iron-gear-wheel"] },
        { id: 3, source: { type: "belt", id: 1 }, sink: { type: "machine", id: 2 }, stack_size: 16, filters: ["copper-plate"] },
        { id: 4, source: { type: "machine", id: 2 }, sink: { type: "belt", id: 2 }, stack_size: 16, filters: ["copper-cable"] },
        { id: 5, source: { type: "machine", id: 2 }, sink: { type: "belt", id: 2 }, stack_size: 16, filters: ["copper-cable"] },
    ],
    chests: [],
});

const ranges = (pairs: [number, number][]) => pairs.map(([start, end]) => ({ start, end }));

describe("what a belt with a consumption rate receives", () => {
    let config: Config;

    beforeAll(async () => {
        config = await parseConfig(SMALL_BUILD);
    });

    describe("exportedItemsOf", () => {
        it("takes the two lanes of cable on belt 2 as one demand of 6 a second, filled by inserters 4 and 5", () => {
            const exported = exportedItemsOf(createEntityRegistryFromConfig(config), new Set(["inserter:2"]));
            expect(exported).toHaveLength(1);
            expect(exported[0]).toMatchObject({ belt_number: 2, item: "copper-cable", items_per_second: 6, filler_numbers: [4, 5], hand: 16 });
        });

        it("leaves out a belt that the output inserters fill: its items are the build's output", () => {
            expect(exportedItemsOf(createEntityRegistryFromConfig(config), new Set(["inserter:4", "inserter:5"]))).toEqual([]);
        });
    });

    describe("in one period", () => {
        const exported = () => exportedItemsOf(createEntityRegistryFromConfig(config), new Set());

        it("is short when both inserters together move less than both lanes take, though more than one lane takes", () => {
            // 6 a second over 1920 ticks is 192 items; 128 are 4 a second, which is above one lane's 3
            const short = exportShortfallsOfPeriod(exported(), (id) => (id === "inserter:4" || id === "inserter:5" ? 64 : 0), 1920, 1);
            expect(short).toEqual([{ belt_id: 2, item: "copper-cable", item_label: "copper cable", expected_per_second: 6, delivered_per_second: 4, inserter_ids: [4, 5] }]);
        });

        it("is not short when the lanes get their rate, or more", () => {
            expect(exportShortfallsOfPeriod(exported(), () => 96, 1920, 1)).toEqual([]);
            expect(exportShortfallsOfPeriod(exported(), () => 200, 1920, 1)).toEqual([]);
        });
    });

    describe("over the judged part of a long run", () => {
        // a hand of 16 is held for 8 ticks and dropped at the end of them, every `every` ticks from tick 2
        const held = (every: number, skipped_from = Infinity, skipped_to = Infinity) => Array.from({ length: 4800 }, (_, t) =>
            (t >= 2 && (t - 2) % every < 8 && !(t >= skipped_from && t < skipped_to) ? 16 : 0));
        // 20 bins of 160 ticks from tick 1600; the lanes take 6 a second together: 16 items a bin
        const run = (inserter_4: number[], inserter_5: number[], proven: boolean) => exportShortfallsOfRun(
            exportedItemsOf(createEntityRegistryFromConfig(config), new Set()),
            new Map([["inserter:4", inserter_4], ["inserter:5", inserter_5]]),
            { first_tick: 1600, bin_ticks: 160, ticks: 4800, count: 20, proven });
        const none = new Array<number>(4800).fill(0);

        it("is not short when each bin gets its 16", () => {
            expect(run(held(160), none, true)).toEqual([]);
            expect(run(held(160), held(160), true)).toEqual([]);
        });

        it("is short when the inserters deliver every other bin only: a bin may be a hand short, the run may not", () => {
            // 8 items a bin over the run is 3 a second of the 6
            const short = run(held(320), none, false);
            expect(short).toHaveLength(1);
            expect(short[0].delivered_per_second).toBeCloseTo(3, 5);
        });

        it("counts a cycle that repeats for ever to the item", () => {
            // one hand short over the whole run: within a hand for a sampled run, not for a proven cycle
            const one_hand_short = held(160, 3000, 3100);
            expect(run(one_hand_short, none, false)).toEqual([]);
            expect(run(one_hand_short, none, true)).toHaveLength(1);
        });
    });

    describe("the clock check", () => {
        // the windows the generator makes for this build with observed windows (period 1920); inserters 4 and 5 are the exports
        const derived: SerializableClockWindows = {
    "inserter:1": ranges([[1, 17], [40, 55], [241, 257], [280, 295], [481, 497], [520, 535], [721, 737], [760, 775], [961, 977], [1000, 1015], [1201, 1217], [1240, 1255], [1441, 1457], [1480, 1495], [1681, 1697], [1720, 1735]]),
    "inserter:2": ranges([[1, 13], [241, 253], [481, 493], [721, 733], [961, 973], [1201, 1213], [1441, 1453], [1681, 1693]]),
    "inserter:3": ranges([[157, 172], [397, 412], [637, 652], [877, 892], [1117, 1132], [1357, 1372], [1597, 1612], [1837, 1852]]),
    "inserter:4": ranges([[0, 168], [186, 393], [411, 618], [636, 843], [861, 1068], [1086, 1293], [1311, 1518], [1536, 1743], [1761, 1919]]),
    "inserter:5": ranges([[0, 78], [96, 333], [351, 588], [621, 858], [876, 1113], [1131, 1368], [1386, 1623], [1641, 1878], [1896, 1919]]),
        };

        it("holds the clock whose export windows give both lanes their 3 a second", () => {
            const result = clockFromWindows(config, derived, 1920, quiet);
            expect(result.stability_check.as_built).toMatchObject({ holds: true });
            expect(result.stability_check.as_built?.export_shortfalls).toBeUndefined();
        });

        it("does not hold the clock whose export windows stop after four of nine, and says what the belt got", () => {
            const thinned = { ...derived, "inserter:4": derived["inserter:4"].slice(0, 4), "inserter:5": derived["inserter:5"].slice(0, 4) };
            const result = clockFromWindows(config, thinned, 1920, quiet);
            const as_built = result.stability_check.as_built!;
            // the gears are all there: the cable machine makes more than it is asked for
            expect(as_built.actual_output_items).toBe(result.stability_check.expected_output_items);
            expect(as_built.holds).toBe(false);
            expect(as_built.export_shortfalls).toEqual([expect.objectContaining({ belt_id: 2, item: "copper-cable", expected_per_second: 6, inserter_ids: [4, 5] })]);
            expect(as_built.export_shortfalls![0].delivered_per_second).toBeCloseTo(4, 1);
        });

        it("does not hold a plan whose exports come up short in the period it measures", () => {
            const result = generateClockForConfig(config, { logger: quiet });
            expect(result.stability_check.holds).toBe(false);
            expect(result.stability_check.export_shortfalls).toEqual([expect.objectContaining({ belt_id: 2, expected_per_second: 6, delivered_per_second: 4 })]);
        });
    });
});
