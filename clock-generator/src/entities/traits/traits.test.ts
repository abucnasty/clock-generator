import fs from "fs";
import { describe, expect, it } from "vitest";
import { ConfigPaths } from "../../config/config-paths";
import { parseConfig } from "../../config/loader";
import { Config, ConfigSchema } from "../../config/schema";
import { buildTraits, DrillTraits, InserterTraits, LaneTraits, MachineTraits } from "./build-traits";
import { energyValue } from "./energy";

type Parts = Partial<Pick<Config, "machines" | "inserters" | "belts" | "chests" | "drills">>;

/** The traits of a build of these entities, with a target that nothing here reads */
function traitsOf(parts: Parts) {
    return buildTraits(ConfigSchema.parse({
        target_output: { recipe: parts.machines?.[0]?.recipe ?? "iron-gear-wheel", items_per_second: 1, copies: 1 },
        machines: [], belts: [], inserters: [], ...parts,
    }) as Config);
}

const machineOf = (parts: Parts, id = 1) => traitsOf(parts)[`machine:${id}`] as MachineTraits;

async function sampleTraits(file: string) {
    return buildTraits(await parseConfig(fs.readFileSync(file, "utf8")) as Config);
}

describe("the hand and the timing of an inserter (docs/rules-of-the-game.md, An inserter's swing)", () => {
    // gears from an assembler into an engine assembler, by three kinds of inserter
    const traits = traitsOf({
        machines: [{ id: 1, recipe: "iron-gear-wheel", crafting_speed: 1, productivity: 0 }, { id: 2, recipe: "engine-unit", crafting_speed: 1, productivity: 0 }],
        inserters: [
            { id: 1, source: { type: "machine", id: 1 }, sink: { type: "machine", id: 2 } },
            { id: 2, source: { type: "machine", id: 1 }, sink: { type: "machine", id: 2 }, prototype: "fast-inserter", quality: "normal" },
            { id: 3, source: { type: "machine", id: 1 }, sink: { type: "machine", id: 2 }, prototype: "inserter", quality: "normal" },
            { id: 4, source: { type: "machine", id: 1 }, sink: { type: "machine", id: 2 }, prototype: "bulk-inserter", quality: "normal" },
            { id: 5, source: { type: "machine", id: 1 }, sink: { type: "machine", id: 2 }, prototype: "long-handed-inserter", quality: "normal" },
        ],
    });
    const inserter = (id: number) => traits[`inserter:${id}`] as InserterTraits;

    // a swing from machine to machine is 2 x ceil(0.5 / w) - 2 ticks, measured on all 25 kinds
    it.each([[1, 8], [2, 24], [3, 70]])("swings inserter %i from machine to machine in %i ticks, planned and at its floor", (id, ticks) => {
        expect(inserter(id).timing.planned.cycle).toBe(ticks);
        expect(inserter(id).timing.by_item[0].floor.cycle).toBe(ticks);
    });

    it("turns a legendary stack inserter in 3 ticks each way, with a tick to pick up and a tick to drop", () => {
        expect(inserter(1).timing.rotation_ticks).toBe(3);
        expect(inserter(1).timing.by_item[0].floor).toEqual({ pickup: 1, drop: 1, cycle: 8 });
    });

    it.each([[1, 16], [4, 12], [2, 4], [3, 4], [5, 4]])("gives inserter %i the research hand %i, and that many gears a swing", (id, hand) => {
        expect(inserter(id).hand.research).toBe(hand);
        expect(inserter(id).hand.nominal).toBe(hand);
        expect(inserter(id).hand.by_item).toEqual([{ item: "iron-gear-wheel", hand }]);
    });

    it("waits for a full hand at a machine that places its results as the bulk ones do, the stack inserter's data beside it", () => {
        expect(inserter(1).hand.full_hand).toEqual({ at_placing_source: true, elsewhere: true });
        expect(inserter(4).hand.full_hand.at_placing_source).toBe(true);
        expect(inserter(2).hand.full_hand.at_placing_source).toBe(false);
        expect([inserter(1).hand.wait_for_full_hand, inserter(1).hand.grab_less_to_match_belt_stack, inserter(1).hand.max_belt_stack_size]).toEqual([true, true, 4]);
        expect([inserter(4).hand.wait_for_full_hand, inserter(4).hand.max_belt_stack_size]).toEqual([false, 1]);
    });

    it("has belt pickup calibrated for the legendary stack inserter only", () => {
        expect([1, 2, 3, 4, 5].map(id => inserter(id).timing.belt_pickup_calibrated)).toEqual([true, false, false, false, false]);
    });
});

describe("the timing floors of an inserter at a belt (mechanics/belts.md B8, B10, B23)", () => {
    const gears = { id: 1, recipe: "iron-gear-wheel", crafting_speed: 1, productivity: 0 };
    const inserterOf = (parts: Parts) => traitsOf(parts)["inserter:1"] as InserterTraits;
    const fromBelt = (lanes: { ingredient: string; stack_size: number }[], prototype?: { prototype: string; quality: string }) => inserterOf({
        machines: [gears],
        belts: [{ id: 1, type: "turbo-transport-belt", lanes }],
        inserters: [{ id: 1, source: { type: "belt", id: 1 }, sink: { type: "machine", id: 1 }, ...prototype }],
    } as Parts);
    const ontoBelt = (stack_size: number, hand: number) => inserterOf({
        machines: [gears],
        belts: [{ id: 1, type: "turbo-transport-belt", lanes: [{ ingredient: "iron-gear-wheel", stack_size }] }],
        inserters: [{ id: 1, source: { type: "machine", id: 1 }, sink: { type: "belt", id: 1 }, stack_size: hand }],
    });

    // one belt stack a tick: a hand of 16 off stacks of 3 takes 6 ticks, its last stack part used
    it("picks a hand up off a belt one stack a tick, the last stack rounded up", () => {
        const inserter = fromBelt([{ ingredient: "iron-plate", stack_size: 3 }]);
        expect(inserter.timing.by_item).toEqual([{
            item: "iron-plate", source_lanes: ["belt:1/lane:1"], sink_lane: null, floor: { pickup: 6, drop: 1, cycle: 6 + 3 + 3 + 1 },
        }]);
        expect(inserter.throughput.by_item[0].items_per_second_ceiling).toEqual({ numerator: 16 * 60, denominator: 13 });
    });

    it("picks it up off the lane of the two that carries the item in larger stacks", () => {
        const inserter = fromBelt([{ ingredient: "iron-plate", stack_size: 3 }, { ingredient: "iron-plate", stack_size: 4 }]);
        expect(inserter.timing.by_item[0].source_lanes).toEqual(["belt:1/lane:1", "belt:1/lane:2"]);
        expect(inserter.timing.by_item[0].floor.pickup).toBe(4);
    });

    it("has no floor off a belt for a kind not calibrated on belts, nor a ceiling", () => {
        const inserter = fromBelt([{ ingredient: "iron-plate", stack_size: 4 }], { prototype: "fast-inserter", quality: "normal" });
        expect(inserter.timing.by_item[0].floor).toEqual({ pickup: null, drop: 1, cycle: null });
        expect(inserter.throughput.by_item[0].items_per_second_ceiling).toBeNull();
    });

    // its hand is rounded down to whole belt stacks first: 16 onto stacks of 3 is 15, in 5 drops; 10 onto stacks of 4 is 8, in 2
    it.each([[3, 16, 15, 5], [4, 10, 8, 2]])("drops onto a belt of stack %i, hand %i, %i gears in %i ticks", (stack, nominal, hand, drop) => {
        const inserter = ontoBelt(stack, nominal);
        expect(inserter.hand.by_item).toEqual([{ item: "iron-gear-wheel", hand }]);
        expect(inserter.timing.by_item[0]).toMatchObject({ sink_lane: "belt:1/lane:1", floor: { pickup: 1, drop, cycle: 1 + 3 + 3 + drop } });
    });
});

describe("the output block (rule 1)", () => {
    const plastic = (crafting_speed: number) => machineOf({ machines: [{ id: 1, recipe: "plastic-bar", crafting_speed, productivity: 300, prototype: "cryogenic-plant" }] });

    // the cryogenic plant of the advanced circuit scaffold: recorded with a full stack of 100 bars, taking coal
    it("is 146 for the plastic plant at multiplier 73, more than its stack of 100", () => {
        const plant = plastic(61.5);
        expect(plant.input_limits.overload_multiplier).toBe(73);
        expect(plant.output_block.per_result).toEqual([{ item: "plastic-bar", rule: "overload", ingredients_blocked_at: 146, held_limit: 100, stack: 100 }]);
        expect(plant.input_limits.limits).toEqual([{ item: "coal", limit: 73, kind: "ingredient" }]);
    });

    // output-block.test.ts: 100 at multiplier 50, a full stack, and 102 at 51, never reached
    it.each([[42, 50, 100], [42.5, 51, 102]])("is at crafting speed %f, multiplier %i, %i", (speed, multiplier, block) => {
        expect(plastic(speed).input_limits.overload_multiplier).toBe(multiplier);
        expect(plastic(speed).output_block.per_result[0].ingredients_blocked_at).toBe(block);
    });

    it("is the stack for a furnace, which picks its recipe by what it is brought", () => {
        const furnace = machineOf({ machines: [{ id: 1, recipe: "iron-plate", crafting_speed: 20, productivity: 0, prototype: "electric-furnace" }] });
        expect(furnace.recipe_selection.mode).toBe("by-input");
        expect(furnace.output_block.rule).toBe("stack");
        expect(furnace.output_block.per_result[0].ingredients_blocked_at).toBe(100);
    });
});

describe("the automated insertion limits (rule 2, mechanics/machines.md section 2)", () => {
    it("are 15 on the logistic science assembler", async () => {
        const assembler = (await sampleTraits(ConfigPaths.LOGISTIC_SCIENCE))["machine:1"] as MachineTraits;
        expect(assembler.input_limits.overload_multiplier).toBe(15);
        expect(assembler.input_limits.limits.map(limit => [limit.item, limit.limit])).toEqual([["inserter", 15], ["transport-belt", 15]]);
    });

    it("are 32 for the iron of the accumulator plant", async () => {
        const plant = (await sampleTraits(ConfigPaths.ACCUMULATOR_640))["machine:1"] as MachineTraits;
        expect(plant.input_limits.limits.find(limit => limit.item === "iron-plate")?.limit).toBe(32);
    });
});

describe("the energy of a burner (rule 4)", () => {
    const biochamber = (energy_consumption_bonus: number) => machineOf({ machines: [{
        id: 1, recipe: "pentapod-egg", crafting_speed: 50, productivity: 0, prototype: "biochamber", energy_consumption_bonus,
    }] });

    // fuel-slot.test.ts: the lowest count an always enabled inserter let the slot of a biochamber fall to, in Factorio 2.1
    it.each([
        [495, 5], [620, 6], [670, 7], [814.97, 8], [926.17, 9], [1020, 9],
        [1102.6, 10], [1177.22, 11], [1309.8, 12], [1369.9, 12], [1426.7, 13],
    ])("tops a biochamber at +%f%% energy consumption up to %i nutrients", (bonus, limit) => {
        expect(biochamber(bonus).energy.fuel?.slot_limit).toBe(limit);
    });

    it("tops the fuel slot up as an input of its own where the fuel is no ingredient", () => {
        const machine = machineOf({ machines: [{
            id: 1, recipe: "bioflux", crafting_speed: 50, productivity: 0, prototype: "biochamber", energy_consumption_bonus: 495,
        }] });
        expect(machine.input_limits.limits.find(it => it.kind === "fuel")).toEqual({ item: "nutrients", limit: 5, kind: "fuel" });
    });

    // Machine.getInsertableInputs: a fuel that is also an ingredient is one input, which fills the fuel slot along the way
    it("gives a fuel that is also an ingredient one limit, the ingredient's: 210 nutrients, not the slot's 9", async () => {
        const machine = (await sampleTraits(ConfigPaths.AGRICULTURAL_SCIENCE))["machine:3"] as MachineTraits;
        expect(machine.input_limits.limits.map(limit => [limit.item, limit.limit, limit.kind])).toEqual([
            ["pentapod-egg", 7, "ingredient"], ["nutrients", 210, "ingredient"],
        ]);
        expect(machine.energy.fuel).toMatchObject({ item: "nutrients", slot_limit: 9 });
    });

    it("reads the biochamber's burner from the data: 500 kW on nutrients of 2 MJ", () => {
        const machine = biochamber(0);
        expect(machine.energy).toMatchObject({ source: "burner", energy_usage_kw: 500, fuel_modelled: true });
        expect(machine.energy.burner).toEqual({ fuel_categories: ["nutrients"], effectivity: 1, fuel_inventory_size: 1, fuels: [{ item: "nutrients", fuel_value_mj: 2 }] });
        // machine.test.ts: 500 kW burns 0.25 nutrients a second; a craft of 15 s at speed 50 takes 0.3 s
        expect(machine.energy.fuel).toMatchObject({ item: "nutrients", per_second: 0.25, per_craft: 0.075 });
    });

    it("runs a stone furnace without fuel, as the simulator does today", () => {
        const furnace = machineOf({ machines: [{ id: 1, recipe: "stone-brick", crafting_speed: 1, productivity: 0, prototype: "stone-furnace" }] });
        expect(furnace.energy).toMatchObject({ source: "burner", energy_usage_kw: 90, fuel_modelled: false, fuel: null });
        expect(furnace.energy.burner?.fuel_categories).toEqual(["chemical"]);
        expect(furnace.input_limits.limits.map(limit => limit.kind)).toEqual(["ingredient"]);
    });

    it("reads energy as the game data writes it", () => {
        expect(energyValue("500kW", "W")).toBe(500_000);
        expect(energyValue("2MJ", "J")).toBe(2_000_000);
        expect(energyValue("1.21GJ", "J")).toBe(1_210_000_000);
        expect(() => energyValue("2MJ", "W")).toThrow();
    });
});

describe("the yield of a craft (rule 18)", () => {
    // recorded on the ore voider's lab: 4 crafts a tick at crafting speed 7.5, iron ore back at 0.2511 a craft
    it("gives a recycler on iron ore 0.25 ore a craft at 4 crafts a tick at speed 7.5", () => {
        const recycler = machineOf({ machines: [{ id: 1, recipe: "iron-ore-recycling", crafting_speed: 7.5, productivity: 0, prototype: "recycler" }] });
        expect(recycler.production.crafts_per_tick).toBe(4);
        expect(recycler.yield.results).toMatchObject([{ item: "iron-ore", probability: 0.25, expected_per_craft: 0.25, stochastic: true, main: true }]);
        expect(recycler.recipe_selection.mode).toBe("by-input");
        expect(recycler.placement).toMatchObject({ mechanism: "result-placement", target: null, stops_while_stack_waits: true });
    });

    // machine.test.ts: 1 of the 2 eggs a craft is ignored by productivity
    it("multiplies 1 of the 2 pentapod eggs by productivity", () => {
        const egg = machineOf({ machines: [{ id: 1, recipe: "pentapod-egg", crafting_speed: 64.5, productivity: 150, prototype: "biochamber", energy_consumption_bonus: 1020 }] });
        expect(egg.yield.results[0]).toMatchObject({ item: "pentapod-egg", amount: 2, ignored_by_productivity: 1, expected_per_craft: 1 + 1 * 2.5 });
        // simulation/archetypes/crafting-machine.test.ts: recorded at 9 nutrients in its fuel slot
        expect(egg.energy.fuel?.slot_limit).toBe(9);
    });
});

describe("the placement of a drill into a machine (rule 3)", () => {
    // the drills mechanics family (#308): a big mining drill on stone into an assembling machine 1
    it.each([["rail", 3, 114], ["landfill", 150, 214]])("fills an assembler on %s (limit %i) to %i", (recipe, limit, stop) => {
        const traits = traitsOf({
            machines: [{ id: 1, recipe: recipe as string, crafting_speed: 0.5, productivity: 0 }],
            drills: { configs: [{ id: 1, type: "big-mining-drill", mined_item_name: "stone", speed_bonus: 5, productivity: 440, target: { type: "machine", id: 1 } }] },
        } as Parts);
        expect((traits["machine:1"] as MachineTraits).input_limits.limits.find(it => it.item === "stone")?.limit).toBe(limit);
        expect((traits["drill:1"] as DrillTraits).placement).toMatchObject({
            mechanism: "mining-drop", target: "machine:1", phase: "before-mining",
            per_result: [{ item: "stone", lands_in: "ingredients", into_machine_stop: stop }],
        });
    });
});

describe("the lanes of a belt", () => {
    it("carry 120 items a second on a turbo lane of stack 4, at the belt's speed in the data", () => {
        const traits = traitsOf({ belts: [{ id: 1, type: "turbo-transport-belt", lanes: [{ ingredient: "iron-plate", stack_size: 4 }] }] });
        const lane = (traits["belt:1/lane:1"] as LaneTraits).lane;
        expect([lane.tiles_per_tick, lane.belt_speed, lane.items_per_second_ceiling]).toEqual([0.125, 60, { numerator: 120, denominator: 1 }]);
        // a belt that lists one lane: its second side carries no item, at the first lane's stack
        expect((traits["belt:1/lane:2"] as LaneTraits).lane).toMatchObject({ listed: false, item: null, stack: 4, items_per_second_ceiling: { numerator: 120, denominator: 1 } });
    });
});
