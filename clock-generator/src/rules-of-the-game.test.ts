import { beforeAll, describe, expect, it } from "vitest";
import { ConfigPaths } from "./config/config-paths";
import { loadConfigFromFile } from "./config/loader";
import { Entity, ReadableEntityRegistry } from "./entities";
import { Lane } from "./entities/belt/belt";
import { createEntityRegistryFromConfig } from "./crafting/sequence/simulation-context";
import { actsInTheTickTheBlockIsLifted, beltPickupSlackTicks, fuelHandRoomTicks, miningDrillMaxInsertion, nearestLaneFirst } from "./rules-of-the-game";

/**
 * The tables of recorded cases of the rules of the game that have no table elsewhere (see rules-of-the-game.ts for
 * where the others are). Each case is a figure read off the game, in Factorio 2.1.21 unless said otherwise.
 */
const registryOf = async (path: string): Promise<ReadableEntityRegistry> => createEntityRegistryFromConfig(await loadConfigFromFile(path));

describe("the rules of the game", () => {

    describe("the automated insertion limit", () => {
        let advanced_circuit: ReadableEntityRegistry;

        beforeAll(async () => {
            advanced_circuit = await registryOf(ConfigPaths.ADVANCED_CIRCUIT);
        });

        // the cryogenic plant that makes plastic in the advanced circuit scaffold: with 100 plastic bars in its output
        // and the status full output it took coal at 69 and left its inserter waiting for space in the destination at 73
        it("is the amount a craft takes times the overload multiplier, rounded up: 73 coal for the plastic plant", () => {
            const plant = advanced_circuit.getAll().filter(Entity.isMachine).find(it => it.output.item_name === "plastic-bar")!;
            expect(plant.inputs.getOrThrow("coal").automated_insertion_limit.quantity).toBe(73);
        });
    });

    describe("the mining drill limit", () => {
        // GOALS.md: the limit is the automated insertion limit + 64, and in practice the drill stops at a minimum of
        // 114 items, the stack of stone (50) + 64. The function takes the stack where the limit is below it, and leaves
        // room for the stone a craft takes on top. The stone furnaces of the sample have a limit of 70 for stone.
        it("fills a stone furnace to its insertion limit for stone plus 64 and one craft's stone", async () => {
            const registry = await registryOf(ConfigPaths.STONE_BRICKS_DIRECT_INSERT);
            const drill = registry.getAll().filter(Entity.isDrill)[0];
            const furnace = registry.getAll().filter(Entity.isMachine).find(it => it.inputs.has("stone"))!;
            expect(furnace.inputs.getOrThrow("stone").automated_insertion_limit.quantity).toBe(70);
            expect(drill.item.stack_size).toBe(50);
            expect(miningDrillMaxInsertion(drill, furnace)).toBe(70 + 64 + 2);
        });
    });

    describe("when a waiting inserter acts", () => {
        // recorded on the scaffolds, on inserters that take from a machine or a chest and had waited 6 ticks or more
        // for a machine at its output block, at the tick another inserter took its products down
        it.each([
            ["no craft was finished the tick before: the first items come a tick later (5,777 cases of 5,777)", false, false],
            ["a craft was finished the tick before: it had woken the inserter already, the items come in the same tick (3,756 of 3,756)", true, true],
        ])("%s", (_case, finished_craft_in_last_tick, acts_this_tick) => {
            expect(actsInTheTickTheBlockIsLifted({ outputBlockedAfterLastTick: true, finishedCraftInLastTick: finished_craft_in_last_tick })).toBe(acts_this_tick);
        });

        // a hand from a belt that stopped part way at the output block goes by the same rule
        it.each([
            ["goes on a tick later without a craft the tick before (843 hands of 843)", false, false],
            ["goes on in that tick with a craft the tick before (248 of 248)", true, true],
        ])("a belt hand stopped at the block %s", (_case, finished_craft_in_last_tick, acts_this_tick) => {
            expect(actsInTheTickTheBlockIsLifted({ outputBlockedAfterLastTick: true, finishedCraftInLastTick: finished_craft_in_last_tick })).toBe(acts_this_tick);
        });

        it("does not apply to a machine that was not at its block", () => {
            expect(actsInTheTickTheBlockIsLifted({ outputBlockedAfterLastTick: false, finishedCraftInLastTick: true })).toBe(false);
        });
    });

    describe("what an inserter takes off a belt first", () => {
        // the utility science scaffold: the inserter that brings processing units and low density structures took the
        // low density structures first while they were on its near lane, and the processing units first once the two
        // lanes were swapped, with the same filters both times
        const lanes: Lane[] = [{ ingredient_name: "low-density-structure", stack_size: 4 }, { ingredient_name: "processing-unit", stack_size: 4 }];
        const filters = () => new Set(["processing-unit", "low-density-structure"]);

        it("takes the item on the lane nearest to it first, whatever the order of its filters", () => {
            expect(Array.from(nearestLaneFirst(filters(), lanes, 1))).toEqual(["low-density-structure", "processing-unit"]);
            expect(Array.from(nearestLaneFirst(filters(), lanes, 2))).toEqual(["processing-unit", "low-density-structure"]);
        });

        it("keeps the order of the filters when the near lane has nothing it takes", () => {
            expect(Array.from(nearestLaneFirst(new Set(["processing-unit"]), lanes, 1))).toEqual(["processing-unit"]);
        });
    });

    describe("belt pickup slack", () => {
        // one more full hand at one belt stack a tick: 4 for a hand of 16 from stacks of 4
        it("is the ticks one more full hand takes, for every inserter that picks up from a belt", async () => {
            const registry = await registryOf(ConfigPaths.LOGISTIC_SCIENCE);
            const slack = beltPickupSlackTicks(registry);
            const belt_fed = registry.getAll().filter(Entity.isInserter).filter(it => Entity.isBelt(registry.getEntityByIdOrThrow(it.source.entity_id)));
            expect(belt_fed.length).toBeGreaterThan(0);
            expect(Array.from(slack.keys()).sort()).toEqual(belt_fed.map(it => it.entity_id.id).sort());
            expect(new Set(slack.values())).toEqual(new Set([4]));
        });
    });

    describe("room for a hand of fuel", () => {
        // agricultural science: the three inserters that bring nutrients off the belt with their bioflux; without the
        // room the windows of batched swings closed on partly filled hands, 377 of 400 a period in the game
        it("is the ticks a hand of fuel takes to fill, for an inserter that takes fuel off a belt as well as an ingredient", async () => {
            const registry = await registryOf(ConfigPaths.AGRICULTURAL_SCIENCE);
            expect(Object.fromEntries(fuelHandRoomTicks(registry))).toEqual({ "inserter:1": 4, "inserter:2": 4, "inserter:11": 4 });
        });
    });
});
