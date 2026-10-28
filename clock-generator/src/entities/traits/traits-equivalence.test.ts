import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { laneCapacity } from "../../config/lane-capacity-validator";
import { parseConfig } from "../../config/loader";
import { Config } from "../../config/schema";
import { InserterPickupMode } from "../../control-logic/inserter/modes";
import { BeltHandPickup } from "../../simulation/components/belt-hand-pickup";
import { PickupModeTransitionEvaluator } from "../../control-logic/inserter/transitions/pickup-mode-transition-evaluator";
import { lossLimitOf } from "../../crafting/backpressure-loss";
import { SimulationContext } from "../../crafting/sequence/simulation-context";
import { Chest } from "../chest/chest";
import { directMachineInsertionLimit, miningDrillMaxInsertion } from "../drill/mining-drill-ext";
import { Entity } from "../entity";
import { ReadableEntityRegistry } from "../entity-registry";
import { fullResearchHandSize } from "../inserter/metadata/inserter-spec";
import { BurnerEnergySource } from "../machine/fuel/energy-source";
import { machineRecipeSelection } from "../machine/machine";
import { OutputBlock } from "../machine/output/output-block";
import { buildTraits, ChestTraits, ConfigTraits, DrillTraits, InserterTraits, LaneTraits, MachineTraits } from "./build-traits";
import { burnerFuelOf } from "./energy";
import { laneKey } from "./lane";
import { PlacementResult } from "./placement";
import { ratioOf } from "./ratio";

const ENGINE = path.resolve(__dirname, "../../..");

/**
 * Every config the repository keeps with a target: the config samples, the game tests' configs, tests/configs and the
 * fixtures of the source (a Sidecar export has no target: it is not a config the generator runs)
 */
function sampleConfigs(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === ".scratch" || entry.name === "node_modules" ? [] : sampleConfigs(file);
        if (!entry.name.endsWith(".json")) return [];
        const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
        const config = typeof value === "object" && value !== null && Array.isArray((value as { machines?: unknown }).machines);
        return config && typeof (value as { target_output?: unknown }).target_output === "object" ? [file] : [];
    });
}

/** A legacy fixture the simulator refuses to build, as pickup-capture.test.ts expects: its pickups were not captured */
const REFUSED = path.join(ENGINE, "src", "config", "fixtures", "legacy", "pickup-without-capture.json");

const SAMPLES = [
    ...sampleConfigs(path.join(ENGINE, "resources", "config-samples")),
    ...sampleConfigs(path.join(ENGINE, "tests", "game")),
    ...sampleConfigs(path.join(ENGINE, "tests", "configs")),
    ...sampleConfigs(path.join(ENGINE, "src", "config", "fixtures")),
    ...sampleConfigs(path.join(ENGINE, "src", "crafting", "fixtures")),
].filter(file => file !== REFUSED);

/**
 * What the name and kind branches gave before the entities read these figures from their traits (R4), recorded as
 * literals: the traits and the entities' runtime figures are held to them, so the test proves the move kept every figure
 * rather than comparing a function with itself.
 */
const BEFORE = {
    /** The furnace rule (output-block.ts's switch, the furnace refusal in inserter.ts): the four furnace prototypes */
    furnace_rule: new Set(["stone-furnace", "steel-furnace", "electric-furnace", "recycler"]),
    /** The burner table (energy-source.ts): the biochamber rule, which only the biochamber prototype had */
    burner_table: new Map<string, BurnerEnergySource>([
        ["biochamber", { energy_usage_kw: 500, fuels: [{ item_name: "nutrients", fuel_value_mj: 2 }] }],
    ]),
    /** The belt speed switch (belt.ts) */
    belt_speed: new Map([["transport-belt", 15], ["fast-transport-belt", 30], ["express-transport-belt", 45], ["turbo-transport-belt", 60]]),
    /** isBulkInserter (inserter-spec.ts): the prototypes that waited for a full hand at a machine that places its results */
    bulk: new Set(["bulk-inserter", "stack-inserter"]),
    /** The arm gate (belt-hand-pickup.ts) and the scope check (inserter-scope.ts isLegendaryStackInserter) */
    belt_arm: (prototype: string, quality: string) => prototype === "stack-inserter" && quality === "legendary",
};

/** What the equivalence was checked on, summed over the samples */
const checked = {
    samples: 0, machines: 0, drills: 0, inserters: 0, lanes: 0, chests: 0, figures: 0,
    /** Machines whose fuel is also an ingredient, inserters at a placer, belt pickups, placements into a container */
    merged_fuels: 0, hands_at_placers: 0, belt_pickups: 0, placements_into_chests: 0,
};

/** Holds a trait's figure to the entity's, and counts it */
function same(actual: unknown, expected: unknown, what: string): void {
    expect(actual, what).toEqual(expected);
    checked.figures += 1;
}

function checkMachines(registry: ReadableEntityRegistry, traits: ConfigTraits): void {
    for (const machine of registry.getAll().filter(Entity.isMachine)) {
        const id = machine.entity_id.id;
        const t = traits[id] as MachineTraits;
        checked.machines += 1;
        same(t.kind, "machine", id);
        same(t.production.speed, machine.metadata.crafting_speed, `${id} speed`);
        same(t.production.productivity, machine.metadata.productivity, `${id} productivity`);
        same(t.production.ticks_per_craft, machine.crafting_rate.ticks_per_craft, `${id} ticks per craft`);
        same(t.production.crafts_per_tick, machine.crafting_rate.crafts_per_tick, `${id} crafts per tick`);
        same(t.production.bonus_per_craft, machine.bonus_productivity_rate.bonus_per_craft, `${id} bonus per craft`);
        same(t.production.ticks_per_bonus, machine.bonus_productivity_rate.ticks_per_bonus, `${id} ticks per bonus`);
        same(t.production.insertion_duration_ticks, machine.insertion_duration.tick_duration.toDecimal(), `${id} insertion duration`);
        same(t.production.inputs, Array.from(machine.inputs.values(), input => ({
            item: input.item_name, per_craft: input.ingredient.amount,
            per_second: input.consumption_rate.rate_per_second, per_tick: input.consumption_rate.rate_per_tick,
        })), `${id} inputs`);
        same(t.yield.results.map(result => [result.item, result.expected_per_craft, result.per_second]),
            machine.outputs.map(output => [output.item_name, output.amount_per_craft.toDecimal(), ratioOf(output.production_rate.amount_per_second)]),
            `${id} results`);
        same(t.input_limits.overload_multiplier, machine.overload_multiplier.overload_multiplier, `${id} overload`);
        same(t.input_limits.limits.filter(limit => limit.kind === "ingredient").map(limit => [limit.item, limit.limit]),
            Array.from(machine.inputs.values(), input => [input.item_name, input.automated_insertion_limit.quantity]), `${id} insertion limits`);
        // every input an inserter fills, a fuel that is also an ingredient once, at the ingredient's limit
        same(t.input_limits.limits.map(limit => [limit.item, limit.limit]),
            machine.getInsertableInputs().map(input => [input.item_name, input.automated_insertion_limit.quantity]), `${id} insertable inputs`);
        for (const limit of t.input_limits.limits) {
            same(limit.limit, machine.getInsertableInput(limit.item)?.automated_insertion_limit.quantity, `${id} insertable ${limit.item}`);
        }
        same([t.loop.self_ingredients, t.loop.looping_ingredients, t.loop.seeded],
            [[...machine.self_ingredients], [...machine.looping_ingredients], machine.looping_ingredients.size > 0], `${id} loop`);
        same(t.output_block.per_result.map(block => [block.item, block.ingredients_blocked_at, block.held_limit, block.stack]),
            machine.outputs.map(output => [output.outputBlock.item_name, output.outputBlock.ingredients_blocked_at, output.outputBlock.held_limit, output.outputBlock.max_stack_size]),
            `${id} output blocks`);
        // the class gives what the furnace rule gave: the recipe selection, and the main product's block by the old switch
        const prototype = machine.metadata.prototype ?? "";
        const furnace_rule = BEFORE.furnace_rule.has(prototype);
        same(t.recipe_selection.mode === "by-input", furnace_rule, `${id} recipe selection`);
        same(machineRecipeSelection(machine), t.recipe_selection, `${id} entity's recipe selection`);
        same(machine.output.outputBlock, furnace_rule ? OutputBlock.forFurnace(machine.metadata.recipe)
            : OutputBlock.forMachine(machine.metadata.recipe, machine.overload_multiplier), `${id} main output block by the old rule`);
        // the burner from the data gives what the burner table gave: which machines burn fuel, and what they burn
        const table_source = BEFORE.burner_table.get(prototype);
        same(t.energy.fuel_modelled, table_source !== undefined, `${id} fuel modelled`);
        same(machine.fuel_slot !== undefined, table_source !== undefined, `${id} entity's fuel slot`);
        if (table_source !== undefined && machine.fuel_slot !== undefined && machine.fuel_consumption !== undefined) {
            same(t.energy.energy_usage_kw, table_source.energy_usage_kw, `${id} energy usage`);
            const { crafting_speed, recipe, fuel, energy_consumption_bonus } = machine.metadata;
            const [consumption, slot] = burnerFuelOf(table_source, fuel, crafting_speed, recipe.energy_required, energy_consumption_bonus);
            same([machine.fuel_consumption, machine.fuel_slot], [consumption, slot], `${id} entity's fuel by the old table`);
            same(t.energy.fuel, {
                item: machine.fuel_consumption.item, fuel_value_mj: machine.fuel_slot.fuel.fuel_value_mj,
                per_craft: machine.fuel_consumption.amount_per_craft, per_second: machine.fuel_consumption.rate_per_second,
                per_tick: machine.fuel_consumption.rate_per_tick, slot_limit: machine.fuel_slot.automated_insertion_limit,
                energy_per_craft_mj: machine.fuel_slot.energy_per_craft_mj,
            }, `${id} fuel`);
            if (!machine.inputs.has(machine.fuel_slot.fuel.item_name)) {
                same(t.input_limits.limits.find(limit => limit.kind === "fuel")?.limit, machine.fuel_slot.automated_insertion_limit, `${id} fuel limit`);
            } else {
                checked.merged_fuels += 1;
            }
        }
        same(t.placement !== null, machine.metadata.places_results === true, `${id} places results`);
        if (t.placement !== null) {
            same(t.placement.target, machine.result_target?.id ?? null, `${id} result target`);
            const target = machine.result_target === undefined ? null : registry.getEntityById(machine.result_target);
            if (target !== null && Entity.isMachine(target)) {
                for (const output of machine.outputs) {
                    const placed = t.placement.per_result.find(result => result.item === output.item_name)!;
                    const takes = target.inputs.has(output.item_name);
                    same(placed.lands_in, takes ? "ingredients" : null, `${id} ${output.item_name} lands in`);
                    if (takes) same(placed.into_machine_stop, directMachineInsertionLimit(output.ingredient.item, target), `${id} ${output.item_name} stop`);
                }
            }
            if (target !== null && Entity.isChest(target)) {
                for (const output of machine.outputs) {
                    checkLandsInChest(t.placement.per_result.find(result => result.item === output.item_name)!, target, `${id} ${output.item_name}`);
                }
            }
        }
    }
}

/** Where a result placed into a container lands: a silo's input slots for its recipe's ingredients, else where it is accepted */
function checkLandsInChest(placed: PlacementResult, chest: Chest, what: string): void {
    checked.placements_into_chests += 1;
    const lands_in = Chest.isRocketSilo(chest) && chest.toInput(placed.item) ? "input-slots" : chest.acceptsItem(placed.item) ? "storage" : null;
    same(placed.lands_in, lands_in, `${what} lands in`);
    same(placed.into_machine_stop, null, `${what} stop`);
}

function checkDrills(registry: ReadableEntityRegistry, traits: ConfigTraits): void {
    for (const drill of registry.getAll().filter(Entity.isDrill)) {
        const id = drill.entity_id.id;
        const t = traits[id] as DrillTraits;
        checked.drills += 1;
        same(t.production.ticks_per_craft, drill.crafting_rate.ticks_per_craft, `${id} ticks per craft`);
        same(t.production.crafts_per_tick, drill.crafting_rate.crafts_per_tick, `${id} crafts per tick`);
        same(t.yield.results.map(result => [result.item, result.per_second]),
            [[drill.item.name, ratioOf(drill.production_rate.amount_per_second)]], `${id} rate`);
        same(t.placement.target, drill.sink_id.id, `${id} target`);
        const target = registry.getEntityById(drill.sink_id);
        if (target !== null && Entity.isMachine(target) && target.inputs.has(drill.item.name)) {
            same(t.placement.per_result[0].into_machine_stop, miningDrillMaxInsertion(drill, target), `${id} stop`);
        }
        if (target !== null && Entity.isChest(target)) checkLandsInChest(t.placement.per_result[0], target, id);
    }
}

/**
 * What the simulator's control logic of each inserter decided at construction: whether it swings a part hand at its
 * source (pickup-mode-transition-evaluator.ts) and whether its belt pickup runs the calibrated arm (belt-hand-pickup.ts)
 */
function controlLogicOf(context: SimulationContext): Map<string, { swings_part_hands: boolean; belt_arm: boolean | null }> {
    const decided = new Map<string, { swings_part_hands: boolean; belt_arm: boolean | null }>();
    for (const state_machine of context.inserters) {
        const found = { swings_part_hands: false, belt_arm: null as boolean | null };
        for (const [mode, evaluator] of (state_machine as unknown as { graph: Map<object, object> }).graph) {
            if (evaluator instanceof PickupModeTransitionEvaluator) {
                found.swings_part_hands = (evaluator as unknown as { swings_part_hands: boolean }).swings_part_hands;
            }
            if (mode instanceof InserterPickupMode && mode.port instanceof BeltHandPickup) {
                found.belt_arm = (mode.port as unknown as { arm?: object }).arm !== undefined;
            }
        }
        decided.set(state_machine.entity_id.id, found);
    }
    return decided;
}

function checkInserters(context: SimulationContext, traits: ConfigTraits): void {
    const registry = context.entity_registry;
    const decided = controlLogicOf(context);
    for (const inserter of registry.getAll().filter(Entity.isInserter)) {
        const id = inserter.entity_id.id;
        const t = traits[id] as InserterTraits;
        const { type, quality } = inserter.metadata;
        checked.inserters += 1;
        same(t.hand.prototype, type, `${id} prototype`);
        same(t.hand.quality, quality, `${id} quality`);
        same(t.hand.nominal, inserter.metadata.stack_size, `${id} nominal hand`);
        same(t.hand.research, fullResearchHandSize(type), `${id} research hand`);
        same(t.hand.items, Array.from(inserter.filtered_items), `${id} items in order`);
        same(t.hand.by_item.map(hand => [hand.item, hand.hand]), Array.from(inserter.hand_sizes ?? []), `${id} hands`);
        // the full-hand rule as pickup-mode-transition-evaluator.ts decided it, at a machine that places its results
        // itself, and as isBulkInserter gave it
        const source = registry.getEntityById(inserter.source.entity_id);
        same(t.hand.full_hand.at_placing_source, BEFORE.bulk.has(type), `${id} full hand by the old rule`);
        if (source !== null && Entity.isMachine(source) && source.metadata.places_results === true) {
            checked.hands_at_placers += 1;
            same(decided.get(id)!.swings_part_hands, !BEFORE.bulk.has(type), `${id} full hand at a placer`);
            same(!t.hand.full_hand.at_placing_source, decided.get(id)!.swings_part_hands, `${id} full hand trait at a placer`);
        }
        same(t.timing.rotation_ticks, inserter.animation.rotation.ticks, `${id} rotation`);
        same(t.timing.planned, {
            pickup: inserter.animation.pickup.ticks, drop: inserter.animation.drop.ticks,
            cycle: inserter.animation.total.ticks, pickup_to_drop: inserter.animation.pickup_to_drop.ticks,
        }, `${id} planned timing`);
        // the calibration row gives what the arm gate (belt-hand-pickup.ts) and the scope check gave by name
        const belt_arm = decided.get(id)!.belt_arm;
        if (belt_arm !== null) {
            checked.belt_pickups += 1;
            same(belt_arm, BEFORE.belt_arm(type, quality), `${id} belt pickup arm by the old gate`);
            same(t.timing.belt_pickup_calibrated, belt_arm, `${id} belt pickup calibrated`);
        }
        same(t.timing.belt_pickup_calibrated, BEFORE.belt_arm(type, quality), `${id} belt pickup scope`);
        same(t.throughput.capacity_group, id, `${id} capacity group`);
        same(t.throughput.by_item.map(item => item.item), t.hand.by_item.map(item => item.item), `${id} throughput items`);
    }
}

function checkLanes(config: Config, registry: ReadableEntityRegistry, traits: ConfigTraits): void {
    for (const belt of registry.getAll().filter(Entity.isBelt)) {
        const belt_config = config.belts.find(it => it.id === belt.entity_id.number)!;
        for (const lane of [1, 2] as const) {
            const t = traits[laneKey(belt.entity_id.number, lane)] as LaneTraits;
            checked.lanes += 1;
            // the speed from the data gives what the belt speed switch gave
            same(belt.belt_speed, BEFORE.belt_speed.get(belt_config.type), `${t.lane.key} entity's speed by the old switch`);
            same(t.lane.belt_speed, belt.belt_speed, `${t.lane.key} speed`);
            same(t.lane.items_per_second_ceiling, ratioOf(laneCapacity(belt_config, lane)), `${t.lane.key} capacity`);
            const listed = belt.lanes[lane - 1];
            same([t.lane.item, t.lane.listed], [listed?.ingredient_name ?? null, listed !== undefined], `${t.lane.key} item`);
            if (listed !== undefined) same(t.lane.stack, listed.stack_size, `${t.lane.key} stack`);
        }
    }
}

function checkChests(registry: ReadableEntityRegistry, traits: ConfigTraits): void {
    for (const chest of registry.getAll().filter(Entity.isChest)) {
        const id = chest.entity_id.id;
        const t = traits[id] as ChestTraits;
        checked.chests += 1;
        same(t.storage.gives, chest.getItemFilters(), `${id} gives`);
        for (const { item, capacity } of t.storage.capacity_by_item) {
            const expected = chest.getCapacity(item);
            same(capacity, Number.isFinite(expected) ? expected : null, `${id} capacity of ${item}`);
            same(t.storage.accepts === "any" || t.storage.accepts.includes(item), chest.acceptsItem(item), `${id} accepts ${item}`);
        }
    }
}

describe("the traits of every sample", () => {
    it("give every figure the entities give today", async () => {
        for (const file of SAMPLES) {
            const config = await parseConfig(fs.readFileSync(file, "utf8")) as Config;
            const context = SimulationContext.fromConfig(config);
            const registry = context.entity_registry;
            const traits = buildTraits(config);
            // plain data: what goes through JSON comes back the same, no class instance and no undefined field
            expect(JSON.parse(JSON.stringify(traits)), file).toStrictEqual(traits);
            checked.samples += 1;
            checkMachines(registry, traits);
            checkDrills(registry, traits);
            checkInserters(context, traits);
            checkLanes(config, registry, traits);
            checkChests(registry, traits);
            // the spoilage of the machines and inserters gives the loss limit backpressure-loss.ts works out
            const spoilage = Object.values(traits).flatMap(node => node.kind === "machine" || node.kind === "inserter" ? [node.spoilage] : []);
            const spoil_ticks = spoilage.flatMap(trait => trait.items.map(item => item.spoil_ticks * trait.loss_limit_share));
            same(spoil_ticks.length === 0 ? null : Math.min(...spoil_ticks), lossLimitOf(registry)?.ticks ?? null, `${file} loss limit`);
        }
        expect(checked.samples).toBeGreaterThan(50);
        expect(checked.machines).toBeGreaterThan(100);
        expect(checked.inserters).toBeGreaterThan(400);
        expect(checked.drills).toBeGreaterThan(0);
        expect(checked.chests).toBeGreaterThan(0);
        expect([checked.merged_fuels, checked.hands_at_placers, checked.belt_pickups, checked.placements_into_chests].every(count => count > 0)).toBe(true);
        console.info(`traits held to the entities: ${JSON.stringify(checked)}`);
    });
});
