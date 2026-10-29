import { describe, expect, it } from "vitest";
import { ConfigSchema } from "../../config/schema";
import { FactorioDataService } from "../../data";
import { SimulationContext } from "../../crafting/sequence/simulation-context";
import { TickByHand } from "../../crafting/runner/tick-by-hand.fixture";
import { EntityId } from "../entity-id";
import { Entity } from "../entity";
import { buildTraits, InserterTraits } from "../traits/build-traits";

FactorioDataService.findRecipeOrThrow("transport-belt");
FactorioDataService.findRecipeOrThrow("copper-cable");

/**
 * An inserter with no `filters` carries the items its source gives that its sink takes (carriedItems): a belt gives its
 * lanes' items, a machine its products, a chest its filters; a machine takes its ingredients and fuel, a chest what it
 * accepts, a belt anything.
 */
const chain = () => ConfigSchema.parse({
    target_output: { recipe: "transport-belt", items_per_second: 1, copies: 1 },
    machines: [
        { id: 1, recipe: "iron-gear-wheel", productivity: 0, crafting_speed: 1 },
        { id: 2, recipe: "transport-belt", productivity: 0, crafting_speed: 1 },
    ],
    inserters: [
        // belt to machine
        { id: 1, source: { type: "belt", id: 1 }, sink: { type: "machine", id: 1 }, stack_size: 4 },
        // machine to machine
        { id: 2, source: { type: "machine", id: 1 }, sink: { type: "machine", id: 2 }, stack_size: 4 },
        { id: 3, source: { type: "belt", id: 1 }, sink: { type: "machine", id: 2 }, stack_size: 4 },
        // machine to chest
        { id: 4, source: { type: "machine", id: 2 }, sink: { type: "chest", id: 1 }, stack_size: 4 },
    ],
    belts: [{ id: 1, type: "transport-belt", lanes: [{ ingredient: "iron-plate", stack_size: 4 }] }],
    chests: [{ type: "buffer-chest", id: 1, storage_size: 100, item_filter: "transport-belt" }],
});

const carriedBy = (context: SimulationContext, id: number) => {
    const inserter = context.entity_registry.getEntityByIdOrThrow(EntityId.forInserter(id));
    if (!Entity.isInserter(inserter)) throw new Error("not an inserter");
    return [...inserter.filtered_items];
};

const stateOf = (context: SimulationContext, id: number) =>
    context.inserters.find(it => it.inserter_state.inserter.entity_id.id === EntityId.forInserter(id).id)!.inserter_state;

describe("the items an inserter carries when its config names no filters", () => {
    it("are the iron plates a belt gives to a machine that takes them, and the machine moves them", () => {
        const context = SimulationContext.fromConfig(chain());
        expect(carriedBy(context, 1)).toEqual(["iron-plate"]);
        const tick = new TickByHand(context);
        for (let i = 0; i < 600; i++) tick.executeForTick();
        const state = stateOf(context, 1);
        expect(state.items_dropped).toBeGreaterThan(0);
        expect(context.machines[0].machine_state.totalCrafted).toBeGreaterThan(0);
    });

    it("are the product of a machine that its sink machine takes as an ingredient, and not its other ingredient", () => {
        const context = SimulationContext.fromConfig(chain());
        // the second machine takes iron plates and gears; the first makes only gears
        expect(carriedBy(context, 2)).toEqual(["iron-gear-wheel"]);
        expect(carriedBy(context, 3)).toEqual(["iron-plate"]);
        const tick = new TickByHand(context);
        for (let i = 0; i < 1_200; i++) tick.executeForTick();
        expect(stateOf(context, 2).items_dropped).toBeGreaterThan(0);
        expect(context.machines[1].machine_state.totalCrafted).toBeGreaterThan(0);
    });

    it("are the product of a machine that a chest accepts, and the chest fills with it", () => {
        const context = SimulationContext.fromConfig(chain());
        expect(carriedBy(context, 4)).toEqual(["transport-belt"]);
        const tick = new TickByHand(context);
        for (let i = 0; i < 2_400; i++) tick.executeForTick();
        const chest = context.state_registry.getAllStates().find(it => it.entity_id.id === EntityId.forChest(1).id) as unknown as
            { getCurrentQuantity(item: string): number };
        expect(stateOf(context, 4).items_dropped).toBeGreaterThan(0);
        expect(chest.getCurrentQuantity("transport-belt")).toBeGreaterThan(0);
    });

    it("leave out a lane of the belt that the machine does not take", () => {
        const context = SimulationContext.fromConfig(ConfigSchema.parse({
            target_output: { recipe: "copper-cable", items_per_second: 1, copies: 1 },
            machines: [{ id: 1, recipe: "copper-cable", productivity: 0, crafting_speed: 1 }],
            inserters: [{ id: 1, source: { type: "belt", id: 1 }, sink: { type: "machine", id: 1 }, stack_size: 4 }],
            belts: [{ id: 1, type: "transport-belt", lanes: [{ ingredient: "iron-plate", stack_size: 4 }, { ingredient: "copper-plate", stack_size: 4 }] }],
            chests: [],
        }));
        expect(carriedBy(context, 1)).toEqual(["copper-plate"]);
        const tick = new TickByHand(context);
        for (let i = 0; i < 600; i++) tick.executeForTick();
        expect(stateOf(context, 1).items_dropped).toBeGreaterThan(0);
        expect(context.machines[0].machine_state.totalCrafted).toBeGreaterThan(0);
    });

    it("are the product of a machine on a belt that has a lane for it, and the belt receives it", () => {
        const context = SimulationContext.fromConfig(ConfigSchema.parse({
            target_output: { recipe: "iron-gear-wheel", items_per_second: 1, copies: 1 },
            machines: [{ id: 1, recipe: "iron-gear-wheel", productivity: 0, crafting_speed: 1 }],
            inserters: [
                { id: 1, source: { type: "chest", id: 1 }, sink: { type: "machine", id: 1 }, stack_size: 4 },
                { id: 2, source: { type: "machine", id: 1 }, sink: { type: "belt", id: 1 }, stack_size: 4 },
            ],
            belts: [{ id: 1, type: "transport-belt", lanes: [{ ingredient: "iron-gear-wheel", stack_size: 4 }] }],
            chests: [{ type: "infinity-chest", id: 1, item_filter: [{ item_name: "iron-plate", request_count: 100 }] }],
        }));
        // a chest gives the items of its filter
        expect(carriedBy(context, 1)).toEqual(["iron-plate"]);
        expect(carriedBy(context, 2)).toEqual(["iron-gear-wheel"]);
        const tick = new TickByHand(context);
        for (let i = 0; i < 1_200; i++) tick.executeForTick();
        expect(stateOf(context, 1).items_dropped).toBeGreaterThan(0);
        expect(stateOf(context, 2).items_dropped).toBeGreaterThan(0);
    });

    it("are nothing for a chest that accepts none of what the machine makes, and nothing moves", () => {
        const context = SimulationContext.fromConfig(ConfigSchema.parse({
            target_output: { recipe: "iron-gear-wheel", items_per_second: 1, copies: 1 },
            machines: [{ id: 1, recipe: "iron-gear-wheel", productivity: 0, crafting_speed: 1 }],
            inserters: [
                { id: 1, source: { type: "chest", id: 2 }, sink: { type: "machine", id: 1 }, stack_size: 4 },
                { id: 2, source: { type: "machine", id: 1 }, sink: { type: "chest", id: 1 }, stack_size: 4 },
            ],
            belts: [],
            chests: [
                { type: "buffer-chest", id: 1, storage_size: 10, item_filter: "iron-plate" },
                { type: "infinity-chest", id: 2, item_filter: [{ item_name: "iron-plate", request_count: 100 }] },
            ],
        }));
        expect(carriedBy(context, 2)).toEqual([]);
        const tick = new TickByHand(context);
        for (let i = 0; i < 1_200; i++) tick.executeForTick();
        expect(stateOf(context, 2).items_dropped).toBe(0);
    });

    it("are the same in the traits as in the entity", () => {
        const config = chain();
        const context = SimulationContext.fromConfig(config);
        const traits = buildTraits(config);
        [1, 2, 3, 4].forEach(id => {
            const t = traits[EntityId.forInserter(id).id] as InserterTraits;
            expect([...t.hand.items]).toEqual(carriedBy(context, id));
        });
    });
});
