import { describe, it, expect } from "vitest";
import { simulateClockOnly, type SerializableClockWindows } from "./generate-blueprint";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import type { Config } from "../config/schema";
import { simulatedWakeUpsByStart } from "../verification/simulated-recording";

// Utility science: inserter 1 takes flying robot frames and low density structures off belt 1, inserter 2 takes
// processing units and low density structures off belt 2, inserter 3 takes the packs away. Recorded in Factorio
// 2.1.21 on 2026-10-10 under the clock below, 36,000 ticks each: with the low density structures of belt 2 on the lane
// nearest to inserter 2 it takes them first, and a period moves 64 items through inserter 1 and 128 through inserter
// 2; with the lanes of belt 2 swapped it takes the processing units first and each moves 96. The filters of the
// inserter were the same in both.
describe("an inserter that picks up from a belt with two items", () => {
    const PERIOD = 672;
    const input_windows = [{ start: 37, end: 64 }, { start: 181, end: 197 }, { start: 361, end: 388 }, { start: 517, end: 533 }];
    const windows: SerializableClockWindows = {
        "inserter:3": [{ start: 1, end: 49 }, { start: 169, end: 215 }, { start: 337, end: 373 }, { start: 505, end: 541 }],
        "inserter:1": input_windows,
        "inserter:2": input_windows,
    };

    /** The sample with belt 2 as given and inserter 2 nearest to the lane given, or not told which */
    const build = async (belt_2_lanes: [string, string], near_lane?: 1 | 2): Promise<Config> => {
        const config = structuredClone(await loadConfigFromFile(ConfigPaths.UTILITY_SCIENCE));
        config.belts[1].lanes = belt_2_lanes.map(ingredient => ({ ingredient, stack_size: 4 })) as typeof config.belts[1]["lanes"];
        config.inserters[1].filters = ["processing-unit", "low-density-structure"];
        config.inserters[1].source = { type: "belt", id: 2, ...(near_lane === undefined ? {} : { near_lane }) };
        return config;
    };

    /** What inserter 2 takes first in each period, and what the two input inserters move in the last period run */
    const run = (config: Config) => {
        const periods = 12;
        const stock = simulateClockOnly(config, windows, PERIOD, periods);
        const series = (id: number) => stock.inserters.find(s => s.inserter_id === `inserter:${id}`)!;
        const moved = (id: number) => {
            const held = series(id).held;
            let items = 0;
            for (let tick = (periods - 1) * PERIOD + 1; tick < periods * PERIOD; tick++) {
                items += Math.max(0, held[tick - 1] - held[tick]);
            }
            return items;
        };
        const first_items = new Set<string>();
        const { held, held_item } = series(2);
        for (let period = 1; period < periods; period++) {
            for (let tick = period * PERIOD; tick < (period + 1) * PERIOD; tick++) {
                if (held[tick] > 0) {
                    first_items.add(held_item[tick]);
                    break;
                }
            }
        }
        return { first_items: Array.from(first_items), inserter_1: moved(1), inserter_2: moved(2) };
    };

    it("takes from the lane nearest to it first, whatever the order of its filters", async () => {
        const config = await build(["low-density-structure", "processing-unit"], 1);
        expect(run(config)).toEqual({ first_items: ["low-density-structure"], inserter_1: 64, inserter_2: 128 });
    });

    it("takes the other item first when the lanes are the other way round", async () => {
        const config = await build(["processing-unit", "low-density-structure"], 1);
        expect(run(config)).toEqual({ first_items: ["processing-unit"], inserter_1: 96, inserter_2: 96 });
    });

    it("counts the lanes from the left of the belt: 2 is the right lane", async () => {
        const config = await build(["low-density-structure", "processing-unit"], 2);
        expect(run(config).first_items).toEqual(["processing-unit"]);
    });

    it("takes its items in the order of its filters when it is not told which lane is nearest", async () => {
        const config = await build(["low-density-structure", "processing-unit"]);
        expect(run(config).first_items).toEqual(["processing-unit"]);
    });
});

// Batched swings with belt pickup slack on the utility science sample, the clock selected for it. Recorded in
// Factorio 2.1.21 on 2026-10-10: 192 packs in each of 53 periods at 26.8 wake-ups a minute. The generator's long run,
// which starts the clock at its beginning on the empty build of the scaffold's staged start, counts the game's 26.8
// too (from the prepared build it counted 10.7).
describe("a clock with more than one steady state", () => {
    const windows: SerializableClockWindows = {
        "inserter:3": [{ start: 1, end: 49 }, { start: 169, end: 193 }, { start: 337, end: 385 }, { start: 505, end: 529 }],
        "inserter:1": [{ start: 37, end: 53 }, { start: 181, end: 197 }, { start: 373, end: 389 }, { start: 517, end: 533 }],
        "inserter:2": [{ start: 37, end: 64 }, { start: 181, end: 208 }, { start: 373, end: 400 }, { start: 517, end: 544 }],
    };

    it("counts the wake-ups of each, by where in its period the clock starts", async () => {
        const config = await loadConfigFromFile(ConfigPaths.UTILITY_SCIENCE);
        const figures = simulatedWakeUpsByStart(config, windows, 672, 24).map(figure => figure.toFixed(1));
        // from the staged start; the prepared build gave 10.7 here
        expect(figures[0]).toBe("26.8");
        // of the starts tried, 32.1 is no longer reached from the staged start; the prepared build reached 10.7, 26.8 and 32.1
        expect(Array.from(new Set(figures)).sort()).toEqual(["10.7", "26.8"]);
    });

    it("has none for a period that is not a whole number of ticks", async () => {
        const config = await loadConfigFromFile(ConfigPaths.UTILITY_SCIENCE);
        expect(simulatedWakeUpsByStart(config, windows, 672.5, 24)).toEqual([]);
    });
});
