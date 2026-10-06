import { beforeAll, describe, expect, it } from "vitest";
import { ConfigPaths } from "../../config/config-paths";
import type { Config } from "../../config/schema";
import { loadConfigFromFile } from "../../config/loader";
import { FactorioDataService } from "../../data";
import { SimulationContext } from "../../crafting/sequence/simulation-context";
import { TickControlLogic } from "../../control-logic/tick-control-logic";
import { EntityState, InserterStatus } from "../../state";
import { Entity } from "../entity";
import { EntityId } from "../entity-id";
import { handSizeFor } from "./inserter";

beforeAll(() => {
    FactorioDataService.findRecipeOrThrow("iron-gear-wheel");
});

describe("handSizeFor", () => {
    const inserterOf = async (id: number) => {
        const config = await loadConfigFromFile(ConfigPaths.GLEBA_ROCKET_FUEL);
        const registry = SimulationContext.fromConfig(config).entity_registry;
        const inserter = registry.getEntityByIdOrThrow(EntityId.forInserter(id));
        if (!Entity.isInserter(inserter)) {
            throw new Error(`${id} is not an inserter`);
        }
        return inserter;
    };

    it("is limited by what the item stacks to, and unloads early on a belt rather than leave a partial stack", async () => {
        // inserter 10 drops jellynut-seed (stacks to 10) on a belt lane that stacks to 4: 8 items, not 4, 4 and 2
        const seed_inserter = await inserterOf(10);
        expect(seed_inserter.metadata.stack_size).toBe(16);
        expect(handSizeFor(seed_inserter, "jellynut-seed")).toBe(8);
    });

    it("is the inserter's stack size for an item that stacks to more, dropped on a machine", async () => {
        // inserter 6 moves jelly (stacks to 100) from one machine to another
        const machine_inserter = await inserterOf(6);
        expect(handSizeFor(machine_inserter, "jelly")).toBe(16);
    });

    it("falls back to the inserter's stack size for an item it does not carry", async () => {
        const machine_inserter = await inserterOf(6);
        expect(handSizeFor(machine_inserter, "something-else")).toBe(16);
    });
});

describe("handSizeFor with a stack size set on the inserter", () => {
    type Sink = { type: "belt", lane_stack_size: number } | { type: "chest" } | { type: "machine", recipe: string };

    /** The hand of an inserter taking `item` off a machine that makes it and dropping it on the sink */
    const handSize = (recipe: string, item: string, sink: Sink, stack_size: number): number => {
        const sink_config = sink.type === "machine" ? { type: "machine", id: 2 } : { type: sink.type, id: 1 };
        const config = {
            target_output: { recipe: item, items_per_second: 1, copies: 1 },
            machines: [
                { id: 1, recipe, productivity: 0, crafting_speed: 1 },
                ...(sink.type === "machine" ? [{ id: 2, recipe: sink.recipe, productivity: 0, crafting_speed: 1 }] : []),
            ],
            inserters: [{ id: 1, source: { type: "machine", id: 1 }, sink: sink_config, stack_size, filters: [item] }],
            belts: sink.type === "belt"
                ? [{ id: 1, type: "transport-belt", lanes: [{ ingredient: item, stack_size: sink.lane_stack_size }] }]
                : [],
            chests: sink.type === "chest" ? [{ type: "buffer-chest", id: 1, storage_size: 100, item_filter: item }] : [],
        } as unknown as Config;
        const registry = SimulationContext.fromConfig(config).entity_registry;
        const inserter = registry.getEntityByIdOrThrow(EntityId.forInserter(1));
        if (!Entity.isInserter(inserter)) {
            throw new Error("not an inserter");
        }
        return handSizeFor(inserter, item);
    };

    // jellynut-processing makes jellynut-seed, which stacks to 10
    const seed = (sink: Sink, stack_size: number) => handSize("jellynut-processing", "jellynut-seed", sink, stack_size);

    describe("dropping on a belt", () => {
        const lane_of_4 = { type: "belt", lane_stack_size: 4 } as const;

        it("unloads early at the largest whole number of belt stacks the item stack allows", () => {
            // 10 would drop 4, 4 and 2
            expect(seed(lane_of_4, 16)).toBe(8);
        });

        it("honors a stack size set on the inserter, rounded down to whole belt stacks", () => {
            expect(seed(lane_of_4, 8)).toBe(8);
            expect(seed(lane_of_4, 6)).toBe(4);
            expect(seed(lane_of_4, 5)).toBe(4);
        });

        it("keeps a hand smaller than a belt stack, since there is no whole stack to unload at", () => {
            expect(seed(lane_of_4, 3)).toBe(3);
            expect(seed(lane_of_4, 1)).toBe(1);
        });

        it("is not rounded when the item stack is a whole number of belt stacks", () => {
            expect(seed({ type: "belt", lane_stack_size: 2 }, 16)).toBe(10);
            expect(seed({ type: "belt", lane_stack_size: 1 }, 16)).toBe(10);
        });

        it("is limited by the inserter's stack size when the item stacks to much more", () => {
            // iron gear wheels stack to 100
            expect(handSize("iron-gear-wheel", "iron-gear-wheel", lane_of_4, 16)).toBe(16);
            expect(handSize("iron-gear-wheel", "iron-gear-wheel", { type: "belt", lane_stack_size: 3 }, 16)).toBe(15);
            expect(handSize("iron-gear-wheel", "iron-gear-wheel", lane_of_4, 6)).toBe(4);
        });
    });

    describe("dropping in a chest", () => {
        it("fills the whole item stack before dropping, with no belt stacks to unload at", () => {
            // a full stack of 10 seeds, which takes a whole slot of the chest
            expect(seed({ type: "chest" }, 16)).toBe(10);
        });

        it("honors a stack size set on the inserter when the item stack is not reached first", () => {
            expect(seed({ type: "chest" }, 6)).toBe(6);
            expect(seed({ type: "chest" }, 1)).toBe(1);
        });

        it("is the item stack when the inserter's stack size is the same or more", () => {
            expect(seed({ type: "chest" }, 10)).toBe(10);
            expect(seed({ type: "chest" }, 12)).toBe(10);
        });
    });

    describe("dropping in a machine", () => {
        it("is limited by the item stack and the stack size of the inserter, with no belt stacks to unload at", () => {
            // artificial jellynut soil takes seeds; transport belts take gear wheels
            const soil = { type: "machine", recipe: "artificial-jellynut-soil" } as const;
            expect(seed(soil, 16)).toBe(10);
            expect(seed(soil, 6)).toBe(6);
            expect(handSize("iron-gear-wheel", "iron-gear-wheel", { type: "machine", recipe: "transport-belt" }, 16)).toBe(16);
        });
    });
});

describe("an inserter in the simulation takes the hand size it is limited to", () => {
    /** Items in the hand of an inserter taking seeds off a machine when it starts to swing to the sink */
    const heldWhenSwinging = (sink: "belt" | "chest", stack_size: number): number | undefined => {
        const config = {
            target_output: { recipe: "jellynut-seed", items_per_second: 1, copies: 1 },
            machines: [{ id: 1, recipe: "jellynut-processing", productivity: 0, crafting_speed: 1 }],
            inserters: [{ id: 1, source: { type: "machine", id: 1 }, sink: { type: sink, id: 1 }, stack_size, filters: ["jellynut-seed"] }],
            belts: sink === "belt" ? [{ id: 1, type: "transport-belt", lanes: [{ ingredient: "jellynut-seed", stack_size: 4 }] }] : [],
            chests: sink === "chest" ? [{ type: "buffer-chest", id: 1, storage_size: 100, item_filter: "jellynut-seed" }] : [],
        } as unknown as Config;
        const context = SimulationContext.fromConfig(config);
        const machine_state = context.state_registry.getAllStates().find(EntityState.isMachine)!;
        // more seeds than any hand takes
        machine_state.inventoryState.setQuantity("jellynut-seed", 30);

        const tick_control_logic = new TickControlLogic(context.tick_provider);
        const inserter = context.inserters[0];
        for (let tick = 0; tick < 300; tick++) {
            tick_control_logic.executeForTick();
            inserter.executeForTick();
            if (inserter.inserter_state.status === InserterStatus.SWING) {
                return inserter.inserter_state.held_item?.quantity;
            }
        }
        return undefined;
    };

    it("unloads early with 8 seeds before a belt lane of 4 rather than wait for 10", () => {
        expect(heldWhenSwinging("belt", 16)).toBe(8);
    });

    it("fills a stack of 10 seeds before dropping them in a chest", () => {
        expect(heldWhenSwinging("chest", 16)).toBe(10);
    });

    it("honors a smaller stack size set on the inserter", () => {
        expect(heldWhenSwinging("chest", 6)).toBe(6);
        expect(heldWhenSwinging("belt", 6)).toBe(4);
    });
});
