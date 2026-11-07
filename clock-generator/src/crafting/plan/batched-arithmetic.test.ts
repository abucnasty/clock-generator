import { describe, expect, it } from "vitest";
import { loadConfigFromFile } from "../../config/loader";
import { ConfigPaths } from "../../config/config-paths";
import { quiet } from "../generate-blueprint-test-helpers";
import { unclockedRun } from "./unclocked-run";
import { ArithmeticWindowsNotApplicable, batchedSwingsWindowsByArithmetic } from "./batched-arithmetic";

/** The windows by arithmetic of a sample's plan, at its planned output swings or the count given */
async function arithmeticOf(key: keyof typeof ConfigPaths, swings?: number) {
    const config = await loadConfigFromFile(ConfigPaths[key]);
    const planned = swings === undefined ? config : { ...config, overrides: { ...config.overrides, terminal_swing_count: swings } };
    const { run } = unclockedRun(planned, { logger: quiet });
    return () => batchedSwingsWindowsByArithmetic({ entity_registry: run.simulation_context.entity_registry, output_cycle_plan: run.output_cycle_plan,
        window_cycle_ticks: run.duration.ticks, recipe_lcm: run.recipe_lcm, always_enabled_by_config: run.always_enabled_by_config });
}
const ranges = (windows: Map<string, { start_inclusive: number; end_inclusive: number }[]>, id: string) =>
    windows.get(id)!.map(range => [range.start_inclusive, range.end_inclusive]);

describe("batched swings by arithmetic", () => {
    // PROCESSING_UNIT_15_CHEST_FED: inserter 1 brings 11/2 hands of circuits a cycle from a chest into the processing unit
    // machine, inserter 2 takes one hand of 16 a cycle into a chest; two cycles of 64 ticks
    it("takes each cycle's output in one batch from the tick after the cycle starts, a swing and a tick long", async () => {
        const { windows, walks } = (await arithmeticOf("PROCESSING_UNIT_15_CHEST_FED"))();
        expect(ranges(windows, "inserter:2")).toEqual([[1, 9], [65, 73]]);
        expect(walks.get("machine:1")!.converged).toBe(true);
    });

    it("gives the filler its hands of each cycle in one window, as the stock walk of the machine has them", async () => {
        const { windows, walks } = (await arithmeticOf("PROCESSING_UNIT_15_CHEST_FED"))();
        const walk = walks.get("machine:1")!;
        const hands = walk.hands.filter(hand => hand.id === "inserter:1");
        // 11/2 hands a cycle: 5 and 6, 11 a window cycle
        expect(hands).toHaveLength(11);
        // one window a cycle at most, each from a pickup of the walk
        const filler = ranges(windows, "inserter:1");
        expect(filler.length).toBeLessThanOrEqual(3);
        for (const hand of hands) {
            expect(filler.some(([start, end]) => hand.pickup_tick - 1 >= start && hand.pickup_tick - 1 <= end)).toBe(true);
        }
    });

    it("refuses what it has no rule for, saying why", async () => {
        const refusal = async (key: keyof typeof ConfigPaths) => {
            try {
                (await arithmeticOf(key))();
            } catch (error) {
                expect(error).toBeInstanceOf(ArithmeticWindowsNotApplicable);
                return (error as Error).message;
            }
            return null;
        };
        expect(await refusal("STONE_BRICK_120_DRILL_DIRECT_INSERT")).toMatch(/drills/);
        expect(await refusal("IRON_ORE_VOIDER_400_EXACT_SPEED")).toMatch(/destroyed/);
        expect(await refusal("METALLURGIC_SCIENCE_45")).toMatch(/not whole/);
        expect(await refusal("LDS_240")).toMatch(/chest the build fills/);
    });
});
