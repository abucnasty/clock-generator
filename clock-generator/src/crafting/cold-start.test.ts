import { beforeAll, describe, expect, it } from "vitest";
import { simulateClockOnly, generateClockForConfig, type BlueprintGenerationResult } from "./generate-blueprint";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import type { Config } from "../config/schema";
import { InserterStatus } from "../state";
import type { StockRecording } from "./machine-stock";
import { quiet } from "./generate-blueprint-test-helpers";
import { DEFAULT_LOOP_SEED_ITEMS } from "./runner/cold-start";

// docs/stability.md, "How a clock is started": a clock is tried from the staged scaffold, belts full and nothing else in the build
describe("a clock-only run starts as the staged scaffold does", () => {
    let config: Config;
    let result: BlueprintGenerationResult;
    /** The first period of the clock with no warm-up of its own, from the start named */
    let first_period: (start?: Parameters<typeof simulateClockOnly>[5]) => StockRecording;

    beforeAll(async () => {
        config = await loadConfigFromFile(ConfigPaths.LOW_DENSITY_STRUCTURE);
        result = generateClockForConfig(config, { logger: quiet });
        first_period = start => simulateClockOnly(config, result.clock_windows, result.simulation_duration.ticks, 1, quiet, { warmup_periods: 0, ...start });
    });

    it("has the machines empty when the clock starts: nothing crafted, nothing in an output", () => {
        const stock = first_period();
        expect(stock.machines.every(machine => machine.products_finished[0] === 0)).toBe(true);
        expect(stock.machines.every(machine => Object.values(machine.outputs).every(series => series[0] === 0))).toBe(true);
    });

    it("starts the clock at its tick 0, with no free run: an inserter outside its window is disabled within a few ticks", () => {
        const stock = first_period();
        const outside = Object.entries(result.clock_windows).filter(([, ranges]) => ranges[0].start > 10).map(([id]) => id);
        expect(outside.length).toBeGreaterThan(0);
        for (const id of outside) {
            expect(stock.inserters.find(it => it.inserter_id === id)!.status[5], id).toBe(InserterStatus.DISABLED);
        }
    });

    it("starts from the build filled until its output is blocked where the start is named", () => {
        const kept = first_period({ keep_output_buffers: true });
        expect(kept.machines.some(machine => machine.products_finished[0] > 0)).toBe(true);
    });
});

describe("a recipe that makes its own ingredient", () => {
    // no windows: every inserter is always enabled, which is all the seed needs
    const eggs = async (overrides: Partial<NonNullable<Config["overrides"]>> = {}): Promise<number> => {
        const sample = await loadConfigFromFile(ConfigPaths.AGRICULTURAL_SCIENCE);
        const config = { ...sample, overrides: { ...sample.overrides, ...overrides } };
        const stock = simulateClockOnly(config, {}, 480, 1, quiet, { warmup_periods: 0 });
        return Math.max(...stock.machines.map(machine => machine.inputs["pentapod-egg"]?.[0] ?? 0));
    };

    it("is given the 200 eggs of the harness once, when the clock starts", async () => {
        expect(DEFAULT_LOOP_SEED_ITEMS).toBe(200);
        // an egg machine crafts from the first tick, so a few are gone by the end of it
        expect(await eggs()).toBeGreaterThan(190);
        expect(await eggs()).toBeLessThanOrEqual(200);
    });

    it("is given the number of eggs the config asks for", async () => {
        expect(await eggs({ loop_seed_items: 50 })).toBeLessThanOrEqual(50);
        expect(await eggs({ loop_seed_items: 50 })).toBeGreaterThan(40);
    });
});
