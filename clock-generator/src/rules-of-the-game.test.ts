import { beforeAll, describe, expect, it } from "vitest";
import { ConfigSchema } from "./config";
import { ConfigPaths } from "./config/config-paths";
import { loadConfigFromFile } from "./config/loader";
import { Entity, ReadableEntityRegistry } from "./entities";
import { Lane } from "./entities/belt/belt";
import { createEntityRegistryFromConfig } from "./crafting/sequence/simulation-context";
import { actsInTheTickTheBlockIsLifted, fuelHandRoomTicks, laneHandRoomTicks, miningDrillMaxInsertion, nearestLaneFirst } from "./rules-of-the-game";

/**
 * The tables of recorded cases of the rules of the game that have no table elsewhere (see rules-of-the-game.ts for
 * where the others are). Each case is a figure read off the game, in Factorio 2.1.21 unless said otherwise.
 */
const registryOf = async (path: string): Promise<ReadableEntityRegistry> => createEntityRegistryFromConfig(await loadConfigFromFile(path));

describe("the rules of the game", () => {

    describe("the automated insertion limit", () => {
        let advanced_circuit: ReadableEntityRegistry;

        beforeAll(async () => {
            advanced_circuit = await registryOf(ConfigPaths.ADVANCED_CIRCUIT_240);
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
        // 114 items, the stack of stone (50) + 64. The function takes the larger of the stack and the limit, + 64.
        const machineInto = (recipe: string) => createEntityRegistryFromConfig(ConfigSchema.parse({
            setpoint: { recipe, items_per_second: 0.1, copies: 1 }, belts: [], inserters: [],
            machines: [{ id: 1, recipe, crafting_speed: 0.5, productivity: 0 }],
            drills: { configs: [{ id: 1, type: "big-mining-drill", mined_item_name: "stone", speed_bonus: 5, productivity: 440, target: { type: "machine", id: 1 } }] } }));

        // recorded in the game (the drills mechanics family, #308): a big mining drill on stone into an assembling
        // machine 1 stopped at 114 on rail (1 stone a craft, limit 3) and at 214 on landfill (50 a craft, limit 150),
        // at 0.43 to 1.35 stone a tick
        it.each([["rail", 3, 114], ["landfill", 150, 214]])("fills an assembler on %s (limit %i) to %i", (recipe, limit, stop) => {
            const registry = machineInto(recipe as string);
            const drill = registry.getAll().filter(Entity.isDrill)[0];
            const machine = registry.getAll().filter(Entity.isMachine)[0];
            expect(machine.inputs.getOrThrow("stone").automated_insertion_limit.quantity).toBe(limit);
            expect(miningDrillMaxInsertion(drill, machine)).toBe(stop);
        });

        // the function on the stone brick sample, whose furnaces have a limit of 70 for stone, above the stack
        it("fills a stone furnace to its insertion limit for stone plus 64", async () => {
            const registry = await registryOf(ConfigPaths.STONE_BRICK_120_DRILL_DIRECT_INSERT);
            const drill = registry.getAll().filter(Entity.isDrill)[0];
            const furnace = registry.getAll().filter(Entity.isMachine).find(it => it.inputs.has("stone"))!;
            expect(furnace.inputs.getOrThrow("stone").automated_insertion_limit.quantity).toBe(70);
            expect(drill.item.stack_size).toBe(50);
            expect(miningDrillMaxInsertion(drill, furnace)).toBe(70 + 64);
        });
    });

    describe("when a waiting inserter acts", () => {
        // recorded on the scaffolds, at the tick another inserter took the products of a machine at its output block
        // down: on inserters that take from a machine or a chest and had waited 6 ticks or more, and on hands from a
        // belt that had stopped part way at the block, which go by the same rule
        it.each([
            ["an inserter takes its first items a tick later when no craft was finished the tick before (5,777 cases of 5,777)", false, false],
            ["an inserter takes them in the same tick when a craft was finished the tick before, which had woken it already (3,756 of 3,756)", true, true],
            ["a belt hand stopped at the block goes on a tick later without a craft the tick before (843 hands of 843)", false, false],
            ["a belt hand stopped at the block goes on in that tick with a craft the tick before (248 of 248)", true, true],
        ])("%s", (_case, finished_craft_in_last_tick, acts_this_tick) => {
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

    describe("room for one more hand", () => {
        type LaneEnd = { kind: "dead_end" } | { kind: "unknown" } | { kind: "outlet" };
        // one inserter of a hand of `hand` that takes iron plates off lane 1 and copper cable off lane 2 of a turbo belt
        const roomOf = (lanes: { iron_stack: number; iron_end?: LaneEnd; cable_stack?: number; cable_end?: LaneEnd },
            hand = 16, backed_up_belts = false) => laneHandRoomTicks(createEntityRegistryFromConfig(ConfigSchema.parse({
            setpoint: { recipe: "electronic-circuit", items_per_second: 1, copies: 1 },
            machines: [{ id: 1, recipe: "electronic-circuit", crafting_speed: 1, productivity: 0 }],
            inserters: [
                { id: 1, source: { type: "belt", id: 1 }, sink: { type: "machine", id: 1 }, stack_size: hand },
                { id: 2, source: { type: "machine", id: 1 }, sink: { type: "chest", id: 1 }, stack_size: 16 },
            ],
            belts: [{ id: 1, type: "turbo-transport-belt", lanes: [
                { ingredient: "iron-plate", stack_size: lanes.iron_stack, ...(lanes.iron_end !== undefined && { lane_end: lanes.iron_end }) },
                { ingredient: "copper-cable", stack_size: lanes.cable_stack ?? lanes.iron_stack, ...(lanes.cable_end !== undefined && { lane_end: lanes.cable_end }) },
            ] }],
            chests: [{ id: 1, type: "infinity-chest", item_filter: [], remove_unfiltered_items: true }],
            overrides: { backed_up_belts },
        }))).get("inserter:1");

        it("is the ticks one more hand takes at one lane stack a tick: 4 for a hand of 16 from stacks of 4", () => {
            expect(roomOf({ iron_stack: 4 })).toBe(4);
        });

        it("is sized by the hand and the lane's stack, not a fixed count: 3 for a hand of 12 from stacks of 4, 16 for a hand of 16 from stacks of 1", () => {
            expect(roomOf({ iron_stack: 4 }, 12)).toBe(3);
            expect(roomOf({ iron_stack: 1 })).toBe(16);
        });

        it("is none on a lane that is a dead end, stated or set by backed_up_belts", () => {
            expect(roomOf({ iron_stack: 4, iron_end: { kind: "dead_end" }, cable_end: { kind: "dead_end" } })).toBeUndefined();
            expect(roomOf({ iron_stack: 4 }, 16, true)).toBeUndefined();
        });

        it("is set by the lanes that are not dead ends, the slowest fill of those", () => {
            expect(roomOf({ iron_stack: 4, iron_end: { kind: "dead_end" }, cable_stack: 1 })).toBe(16);
            expect(roomOf({ iron_stack: 4, cable_stack: 1, cable_end: { kind: "dead_end" } })).toBe(4);
        });

        // the end is not known, so the lane can move: the room is given as on a lane that is not a dead end
        it("is given on a lane whose end is unknown", () => {
            expect(roomOf({ iron_stack: 4, iron_end: { kind: "unknown" }, cable_end: { kind: "unknown" } }, 16, true)).toBe(4);
        });
    });

    describe("room for a hand of fuel", () => {
        // agricultural science: the three inserters that bring nutrients off the belt with their bioflux; without the
        // room the windows of batched swings closed on partly filled hands, 377 of 400 a window cycle in the game
        it("is the ticks a hand of fuel takes to fill, for an inserter that takes fuel off a belt as well as an ingredient", async () => {
            const registry = await registryOf(ConfigPaths.AGRICULTURAL_SCIENCE_250);
            expect(Object.fromEntries(fuelHandRoomTicks(registry))).toEqual({ "inserter:1": 4, "inserter:2": 4, "inserter:11": 4 });
        });
    });
});
