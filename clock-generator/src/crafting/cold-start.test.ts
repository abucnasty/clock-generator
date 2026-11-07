import { beforeAll, describe, expect, it } from "vitest";
import { simulateClockOnly, generateClockForConfig, type BlueprintGenerationResult } from "./generate-blueprint";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import type { Config } from "../config/schema";
import { InserterStatus } from "../state";
import type { StockRecording } from "./machine-stock";
import { quiet } from "./generate-blueprint-test-helpers";
import { DEFAULT_KICK_START_ITEMS, kickStartLoopingRecipes } from "./runner/cold-start";
import { SimulationContext } from "./sequence/simulation-context";

// docs/stability.md, "How a clock is started": a clock is tried from the staged scaffold, belts full and nothing else in the build
describe("a clock-only run starts as the staged scaffold does", () => {
    let config: Config;
    let result: BlueprintGenerationResult;
    /** The first window cycle of the clock with no warm-up of its own, from the start named */
    let first_window_cycle: (start?: Parameters<typeof simulateClockOnly>[5]) => StockRecording;

    beforeAll(async () => {
        config = await loadConfigFromFile(ConfigPaths.LDS_240);
        result = generateClockForConfig(config, { logger: quiet });
        first_window_cycle = start => simulateClockOnly(config, result.clock_windows, result.simulation_duration.ticks, 1, quiet, { warmup_window_cycles: 0, ...start });
    });

    it("has the machines empty when the clock starts: nothing crafted, nothing in an output", () => {
        const stock = first_window_cycle();
        expect(stock.machines.every(machine => machine.products_finished[0] === 0)).toBe(true);
        expect(stock.machines.every(machine => Object.values(machine.outputs).every(series => series[0] === 0))).toBe(true);
    });

    it("starts the clock at its tick 0, with no free run: an inserter outside its window is disabled within a few ticks", () => {
        const stock = first_window_cycle();
        const outside = Object.entries(result.clock_windows).filter(([, ranges]) => ranges[0].start > 10).map(([id]) => id);
        expect(outside.length).toBeGreaterThan(0);
        for (const id of outside) {
            expect(stock.inserters.find(it => it.inserter_id === id)!.status[5], id).toBe(InserterStatus.DISABLED);
        }
    });

    it("starts from the build filled until its output is blocked where the start is named", () => {
        const kept = first_window_cycle({ keep_output_buffers: true });
        expect(kept.machines.some(machine => machine.products_finished[0] > 0)).toBe(true);
    });
});

describe("a recipe that makes its own ingredient", () => {
    // no windows: every inserter is always enabled, which is all the seed needs
    const eggs = async (overrides: Partial<NonNullable<Config["overrides"]>> = {}): Promise<number> => {
        const sample = await loadConfigFromFile(ConfigPaths.AGRICULTURAL_SCIENCE_250);
        const config = { ...sample, overrides: { ...sample.overrides, ...overrides } };
        const stock = simulateClockOnly(config, {}, 480, 1, quiet, { warmup_window_cycles: 0 });
        return Math.max(...stock.machines.map(machine => machine.inputs["pentapod-egg"]?.[0] ?? 0));
    };

    it("is given the 200 eggs of the harness once, when the clock starts: each egg machine takes 84 of them", async () => {
        expect(DEFAULT_KICK_START_ITEMS).toBe(200);
        expect(await eggs()).toBe(84);
    });

    it("is given the number of eggs the config asks for", async () => {
        expect(await eggs({ kick_start_items: 50 })).toBeLessThanOrEqual(50);
        expect(await eggs({ kick_start_items: 50 })).toBeGreaterThan(40);
    });
});

describe("the seed a loop machine takes", () => {
    /** What each machine of the sample that makes its own ingredient holds of it once seeded with `asked` */
    const seeded = async (sample: string, asked: number): Promise<number[]> => {
        const context = SimulationContext.fromConfig(await loadConfigFromFile(sample));
        kickStartLoopingRecipes(context, asked);
        return context.machines.flatMap(({ machine_state }) => [...machine_state.machine.looping_ingredients]
            .map(item => machine_state.selfIngredients.getQuantity(item)));
    };

    // Factorio 2.1.24, staged starts of the two samples' scaffolds asking the harness for 200: each egg machine took 84
    // (stack 20, insertion limit 7), each bacteria machine 114 (stack 50, insertion limit 28)
    it("is what the game takes: the larger of the stack and the insertion limit, + 64", async () => {
        expect(await seeded(ConfigPaths.AGRICULTURAL_SCIENCE_250, DEFAULT_KICK_START_ITEMS)).toEqual([84, 84]);
        expect(await seeded(ConfigPaths.IRON_BACTERIA_380_CULTIVATION, DEFAULT_KICK_START_ITEMS)).toEqual([114, 114]);
    });

    it("is what was asked where the machine takes it all", async () => {
        expect(await seeded(ConfigPaths.AGRICULTURAL_SCIENCE_250, 50)).toEqual([50, 50]);
    });
});
