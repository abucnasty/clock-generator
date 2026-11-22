import { describe, expect, it } from "vitest";
import { loadConfigFromFile } from "../../config/loader";
import { ConfigPaths } from "../../config/config-paths";
import { ConfigSchema } from "../../config/schema";
import { Duration } from "../../data-types/duration";
import { fraction } from "../../data-types/fraction";
import { Entity, EntityId, Machine, RecipeMetadata } from "../../entities";
import { quiet } from "../generate-blueprint-test-helpers";
import { EntityTransferCountMap } from "../sequence/cycle/swing-counts";
import { createEntityRegistryFromConfig } from "../sequence/simulation-context";
import { TargetProductionRate } from "../target-production-rate";
import { unclockedRun } from "./unclocked-run";
import { ArithmeticBatchesFallBehind, ArithmeticWindowsNotApplicable, batchedSwingsWindowsByArithmetic } from "./batched-arithmetic";

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

function refusal(run: () => unknown) {
    try {
        run();
    } catch (error) {
        if (error instanceof ArithmeticWindowsNotApplicable) return error;
        throw error;
    }
    throw new Error("Expected the batched arithmetic to refuse");
}

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
        expect(refusal(await arithmeticOf("STONE_BRICK_120_DRILL_DIRECT_INSERT")).message).toBe("a build with drills");
        expect(refusal(await arithmeticOf("IRON_ORE_VOIDER_400_EXACT_SPEED")).message).toBe("a target that counts an item destroyed is planned by its own arithmetic");
        expect(refusal(await arithmeticOf("METALLURGIC_SCIENCE_45")).message).toMatch(/not whole/);
    });

    it("names the first of the alike inserters taking plastic bar from a chest filled by this build", async () => {
        const error = refusal(await arithmeticOf("LDS_240"));
        expect(error.constructor).toBe(ArithmeticWindowsNotApplicable);
        expect(error.message).toBe("The inserter (inserter 6) that takes plastic bar out of a chest takes from a chest the build fills");
    });
});

/** An arithmetic plan for one gear assembler, supplied by one chest, with the two transfer counts under test. */
function gears({ window = 64, speed = 1, feed = fraction(2), output = fraction(1), takesOutput = true } = {}) {
    const config = ConfigSchema.parse({
        setpoint: { item: "iron-gear-wheel", items_per_second: 1, copies: 1 },
        machines: [{ id: 3, recipe: "iron-gear-wheel", prototype: "assembling-machine-3", crafting_speed: speed, productivity: 0 }],
        belts: [],
        chests: [
            { id: 1, type: "infinity-chest", item_filter: [{ item_name: "iron-plate", request_count: 100 }] },
            { id: 2, type: "infinity-chest", item_filter: [], remove_unfiltered_items: true },
        ],
        inserters: [
            { id: 6, source: { type: "chest", id: 1 }, sink: { type: "machine", id: 3 }, filters: ["iron-plate"], stack_size: 16 },
            ...(takesOutput ? [{ id: 7, source: { type: "machine", id: 3 }, sink: { type: "chest", id: 2 }, stack_size: 16 }] : []),
        ],
    });
    const registry = createEntityRegistryFromConfig(config);
    const [filler, taker] = registry.getAll().filter(Entity.isInserter);
    const transfers = new EntityTransferCountMap();
    const plan = {
        total_duration: Duration.ofTicks(window), total_duration_ticks: fraction(window),
        entity_transfer_map: transfers, production_rate: TargetProductionRate.fromConfig(config.setpoint),
        fractional_swings_enabled: false, terminal_swing_count_overridden: false,
    };
    const setHands = (entity: typeof filler, item_name: string, count: ReturnType<typeof fraction>) => transfers.set(entity.entity_id, {
        entity, item_transfers: [{ item_name, transfer_count: count }], total_transfer_count: count, stack_size: entity.metadata.stack_size,
    });
    setHands(filler, "iron-plate", feed);
    if (taker !== undefined) setHands(taker, "iron-gear-wheel", output);
    const run = () => batchedSwingsWindowsByArithmetic({ entity_registry: registry, output_cycle_plan: plan,
        window_cycle_ticks: window, recipe_lcm: 1, always_enabled_by_config: new Set() });
    return { run, registry, filler, transfers };
}

describe("what the batched arithmetic refuses about an entity", () => {
    const machine = "the assembling machine 3 that makes iron gear wheel";

    it("names the owner of a non-whole hand count", () => {
        const { run } = gears({ feed: fraction(11, 2) });
        expect(refusal(run).message).toBe("The inserter that takes iron plate out of a chest moves 11/2 hands each output cycle, not whole in 1 output cycles");
    });

    it("names a machine whose stock walk does not repeat", () => {
        const { run } = gears({ speed: 0.01, window: 16, takesOutput: false });
        expect(refusal(run).message).toBe(`The stock walk of ${machine} does not repeat`);
    });

    it("keeps the more specific class when the output cannot keep up with its batches", () => {
        const { run } = gears({ output: fraction(100) });
        const error = refusal(run);
        expect(error.constructor).toBe(ArithmeticBatchesFallBehind);
        expect(error.message).toBe(`The output of ${machine} does not keep up with its batches`);
    });

    it("distinguishes alike machines and refuses multiple results before self-placement", () => {
        const { run, registry } = gears();
        const spec = { recipe: RecipeMetadata.fromRecipeName("processing-unit-recycling"), crafting_speed: 1, productivity: 0, prototype: "recycler" };
        registry.add(Machine.createMachine(3, spec, EntityId.forChest(2)));
        registry.add(Machine.createMachine(4, spec));
        expect(refusal(run).message).toBe("The recycler (machine 3) that makes processing unit recycling makes more than one result");
    });

    it("describes a recipe even when the machine has no prototype", () => {
        const { run, registry } = gears();
        registry.add(Machine.createMachine(3, {
            recipe: RecipeMetadata.fromRecipeName("processing-unit-recycling"), crafting_speed: 1, productivity: 0,
        }));
        expect(refusal(run).message).toBe("The machine that makes processing unit recycling makes more than one result");
    });

    it("names a placer that has only one result", () => {
        const { run, registry } = gears();
        registry.add(Machine.createMachine(3, {
            recipe: RecipeMetadata.fromRecipeName("iron-ore-recycling"), crafting_speed: 1, productivity: 0, prototype: "recycler",
        }, EntityId.forChest(2)));
        expect(refusal(run).message).toBe("The recycler that makes iron ore recycling places its results itself");
    });

    it("names a machine that burns fuel", () => {
        const { run, registry } = gears();
        registry.add(Machine.createMachine(3, {
            recipe: RecipeMetadata.fromRecipeName("nutrients-from-yumako-mash"), crafting_speed: 1, productivity: 0, prototype: "biochamber",
        }));
        expect(refusal(run).message).toBe("The biochamber that makes nutrients from yumako mash burns fuel");
    });

    it("uses the numbered fallback for an inserter whose items and hands are unknown", () => {
        const { run, registry, filler: input, transfers } = gears();
        registry.add({ ...input, filtered_items: new Set() });
        transfers.delete(input.entity_id);
        expect(refusal(run).message).toBe("Inserter 6 has no hands in the plan");
    });

    it("names an inserter on a transfer with neither end a machine", () => {
        const { run, registry, filler: input } = gears();
        registry.add({ ...input, sink: { ...input.sink, entity_id: EntityId.forChest(2) } });
        expect(refusal(run).message).toBe("The inserter that takes iron plate out of a chest moves between no machines");
    });

    it("names both entities when a planned filler brings no item the machine takes", () => {
        const { run, registry, filler: input } = gears();
        registry.add({ ...input, filtered_items: new Set(["plastic-bar"]) });
        expect(refusal(run).message).toBe(`The inserter that takes plastic bar out of a chest brings nothing ${machine} takes`);
    });

    it("names both entities when a filler misses its quota in the fixed stock walk", () => {
        const { run } = gears({ feed: fraction(3), takesOutput: false });
        expect(refusal(run).message).toBe(`The inserter that takes iron plate out of a chest moves 0 hands each window cycle in the stock walk of ${machine}, not 3`);
    });
});
