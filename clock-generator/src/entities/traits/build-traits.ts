import { machinePlacesResults } from "../../config/machine-prototype";
import { BeltConfig, ChestConfig, Config, InserterConfig, MachineConfiguration, MiningDrillConfig } from "../../config/schema";
import { FactorioDataService } from "../../data";
import { BeltSpeed, Lane, lanesOf } from "../belt/belt";
import { BeltStackSize } from "../belt/belt-stack-size";
import { Chest } from "../chest/chest";
import { itemsPutInto, PutIntoView } from "../chest/items-put-into";
import { drillCraftingRate } from "../drill/mining-drill";
import { EntityId } from "../entity-id";
import { EntityType } from "../entity-type";
import { carriedItems, InserterEndView, inserterEndItems, inserterHands, inserterKindOf } from "../inserter/inserter";
import { configuredHandSize } from "../inserter/metadata/inserter-spec";
import { machineCraftingRate, machineInputOf, mainProductOf } from "../machine/machine";
import { RecipeMetadata } from "../machine/recipe";
import { OverloadMultiplier } from "../machine/traits/overload-multiplier";
import { drillEnergy, EnergyTrait, machineEnergy } from "./energy";
import { HandTrait, inserterHand } from "./hand";
import { InputLimitsTrait, machineInputLimits } from "./input-limits";
import { beltLanes, LaneTrait } from "./lane";
import { LoopTrait, machineLoop } from "./loop";
import { machineOutputBlock, OutputBlockTrait } from "./output-block";
import { drillPlacement, machinePlacement, PlacementTarget, PlacementTrait } from "./placement";
import { drillProduction, machineProduction, ProductionTrait } from "./production";
import { recipeSelectionOf, RecipeSelectionTrait } from "./recipe-selection";
import { SpoilageTrait, spoilageOf } from "./spoilage";
import { chestStorage, StorageTrait } from "./storage";
import { inserterThroughput, ThroughputTrait } from "./throughput";
import { inserterTiming, TimingTrait } from "./timing";
import { drillYield, machineYield, YieldTrait } from "./yield";

/** A crafting machine's traits */
export interface MachineTraits {
    readonly kind: "machine";
    readonly entity: string;
    readonly production: ProductionTrait;
    readonly yield: YieldTrait;
    readonly input_limits: InputLimitsTrait;
    readonly output_block: OutputBlockTrait;
    readonly recipe_selection: RecipeSelectionTrait;
    /** Only for a machine that places its results itself */
    readonly placement: PlacementTrait | null;
    readonly energy: EnergyTrait;
    readonly spoilage: SpoilageTrait;
    readonly loop: LoopTrait;
}

export interface DrillTraits {
    readonly kind: "drill";
    readonly entity: string;
    readonly production: ProductionTrait;
    readonly yield: YieldTrait;
    readonly placement: PlacementTrait;
    readonly energy: EnergyTrait;
}

export interface InserterTraits {
    readonly kind: "inserter";
    readonly entity: string;
    readonly hand: HandTrait;
    readonly timing: TimingTrait;
    readonly throughput: ThroughputTrait;
    readonly spoilage: SpoilageTrait;
}

/** One lane of a belt: a node of its own, keyed by its lane key, `entity` its belt */
export interface LaneTraits {
    readonly kind: "lane";
    readonly entity: string;
    readonly lane: LaneTrait;
    readonly spoilage: SpoilageTrait;
}

export interface ChestTraits {
    readonly kind: "chest";
    readonly entity: string;
    readonly storage: StorageTrait;
    readonly spoilage: SpoilageTrait;
}

export type NodeTraits = MachineTraits | DrillTraits | InserterTraits | LaneTraits | ChestTraits;

/**
 * Every entity's traits, built once from the config and the game data, by entity id ("machine:3", "inserter:5"); a
 * belt's by its lanes' keys ("belt:2/lane:1"). Plain data: numbers, strings, booleans, arrays and ratios.
 */
export type ConfigTraits = Readonly<Record<string, NodeTraits>>;

/** A machine's traits, with what its placement, its chests and its inserters read of it */
function machineTraitsOf(config: MachineConfiguration): MachineTraits {
    const prototype = config.prototype === undefined ? null : FactorioDataService.findCraftingMachine(config.prototype);
    const recipe = RecipeMetadata.fromRecipeName(config.recipe);
    const overload_multiplier = OverloadMultiplier.fromCraftingSpeed(config.crafting_speed, recipe.energy_required);
    const inputs = recipe.raw.ingredients.map(ingredient => machineInputOf(ingredient, config.crafting_speed, recipe.energy_required, overload_multiplier));
    const crafting_rate = machineCraftingRate(recipe, config.crafting_speed);
    const main = mainProductOf(recipe, crafting_rate, config.productivity);
    const recipe_selection = recipeSelectionOf(prototype?.type ?? null);
    // only a burner on nutrients burns fuel today (machine-rule.ts fuelModelled): a kept quirk, see energy.fuel_modelled
    const energy = machineEnergy(prototype, config, recipe.energy_required);
    const outputs = recipe.outputs.map(output => output.name);
    const yield_trait = machineYield(recipe, crafting_rate, config.productivity);
    return {
        kind: "machine",
        entity: EntityId.forMachine(config.id).id,
        production: machineProduction(config, prototype?.type ?? null, recipe, crafting_rate, inputs, main.production_rate, overload_multiplier),
        yield: yield_trait,
        input_limits: machineInputLimits(overload_multiplier, inputs, energy.fuel),
        output_block: machineOutputBlock(recipe_selection, recipe, overload_multiplier),
        recipe_selection,
        placement: null,
        energy,
        spoilage: spoilageOf([...inputs.map(input => input.item_name), ...outputs, ...(energy.fuel === null ? [] : [energy.fuel.item])]),
        loop: machineLoop(yield_trait.results, inputs),
    };
}

/** What a placer or a drill places into, by the target's traits */
function placementTargetOf(target: { type: "machine" | "chest"; id: number }, machines: ReadonlyMap<number, MachineTraits>, chests: ReadonlyMap<number, Chest>): PlacementTarget | null {
    if (target.type === "machine") {
        const machine = machines.get(target.id);
        return machine === undefined ? null : { kind: "machine", input_limits: machine.input_limits };
    }
    const chest = chests.get(target.id);
    return chest === undefined ? null : { kind: "chest", chest };
}

function targetId(target: { type: "machine" | "chest"; id: number }): string {
    return target.type === "machine" ? EntityId.forMachine(target.id).id : EntityId.forChest(target.id).id;
}

function drillTraitsOf(config: MiningDrillConfig, machines: ReadonlyMap<number, MachineTraits>, chests: ReadonlyMap<number, Chest>): DrillTraits {
    const resource = FactorioDataService.getResourceOrThrow(config.mined_item_name);
    const spec = FactorioDataService.getMiningDrillSpec(config.type);
    const crafting_rate = drillCraftingRate(spec, resource, config.speed_bonus);
    const item = resource.minable.result;
    return {
        kind: "drill",
        entity: EntityId.forDrill(config.id).id,
        production: drillProduction(config, spec, resource, crafting_rate),
        yield: drillYield(item, crafting_rate, config.productivity),
        placement: drillPlacement(spec.vector_to_place_result, targetId(config.target), placementTargetOf(config.target, machines, chests), item),
        energy: drillEnergy(spec),
    };
}

/** An inserter's traits, its ends read through the traits of the entities it takes from and puts into */
function inserterTraitsOf(
    id: number,
    config: InserterConfig,
    view: InserterEndView,
    lanes: ReadonlyMap<number, readonly LaneTrait[]>,
): InserterTraits {
    const { prototype, quality } = inserterKindOf(config);
    const nominal = configuredHandSize(config);
    const { source, sink } = config;
    const { source_items, sink_items } = inserterEndItems(source, sink, view);
    const items = carriedItems(source_items, sink_items, config.filters,
        source.type === EntityType.BELT && source.near_lane !== undefined
            ? { lanes: view.beltLanes(source.id), near_lane: source.near_lane } : undefined);
    const sink_lanes = sink.type === EntityType.BELT ? view.beltLanes(sink.id) : undefined;
    const hands = inserterHands(nominal, items, sink_lanes);
    const hand = inserterHand(prototype, quality, nominal, hands.hand_sizes);
    const sink_lane_traits = sink.type === EntityType.BELT ? lanes.get(sink.id) ?? [] : [];
    const sink_lane_of = new Map<string, LaneTrait>();
    hands.belt_drop?.lane_of.forEach((lane, item) => sink_lane_of.set(item, sink_lane_traits[sink_lanes!.indexOf(lane)]));
    const timing = inserterTiming(hand, config.filters ?? [], config.overrides?.animation ?? {}, {
        source: source.type,
        sink: sink.type,
        source_lanes: source.type === EntityType.BELT ? lanes.get(source.id) ?? [] : [],
        sink_lane_of,
        ...(hands.belt_drop === undefined || sink.type !== EntityType.BELT ? {} : {
            belt_drop: {
                // the belt's speed from its prototype in the game data
                belt_speed: sink_lane_traits[0].belt_speed as BeltSpeed,
                belt_stack_size: hands.belt_drop.belt_stack_size as BeltStackSize,
                inserter_stack_size: hands.belt_drop.inserter_stack_size,
            },
        }),
    });
    const entity = EntityId.forInserter(id).id;
    return {
        kind: "inserter",
        entity,
        hand,
        timing,
        throughput: inserterThroughput(entity, hand, timing),
        spoilage: spoilageOf(items),
    };
}

/**
 * Every entity's traits from the config and the game data, each built once, in the order the registry builds the
 * entities (simulation-context.ts): belts, machines, chests, inserters, drills. Each figure comes from the function the
 * entity computes it with. Where a figure follows the prototype's kind (the output block rule, the fuel, the belt speed,
 * the full-hand rule, the belt pickup calibration), the entity reads it from the trait's own function, by the
 * prototype's class and data fields (machine.ts, belt.ts, inserter.ts, and the inserter's pickup transition and belt
 * pickup logic), and the equivalence test holds both to the figures the name and kind branches gave before they were
 * removed.
 *
 * The registry (simulation-context.ts) does not call this: it is built on every trial, from a config made for that
 * trial, and each entity builds the few traits it reads itself, by the same functions (a crafting machine's burner is
 * worked out once per prototype, energy.ts). This builds them all for the planner's facts and the tests. This departs
 * from P4 2.1 rule 2 (a trait built once per generation, shared by every trial): later steps must not assume one shared
 * trait set per generation. The cost of the rebuild, measured in R4, is about 3 µs a registry (892 registries a
 * generation on the pink science sample); with no config-keyed cache there is nothing to go stale.
 *
 * Two traits of the catalogue (P4 v1 section 2) are left to the planner facts (R20): Order, whose `decider_build_order`
 * is the clock's, not the config's, and Wakes, the rule of which lists a node wakes (R12), a constant by node kind that
 * only the wake-up count reads. Both read nothing the traits here do not carry.
 */
export function buildTraits(config: Config): ConfigTraits {
    const traits: Record<string, NodeTraits> = {};
    const supply = config.overrides?.backed_up_belts === true ? "backed_up" : "moving";

    const belt_lanes = new Map<number, readonly Lane[]>();
    const lane_traits = new Map<number, readonly LaneTrait[]>();
    config.belts.forEach((belt: BeltConfig) => {
        belt_lanes.set(belt.id, lanesOf(belt));
        const lanes = beltLanes(belt, supply);
        lane_traits.set(belt.id, lanes);
        lanes.forEach(lane => {
            traits[lane.key] = { kind: "lane", entity: lane.belt, lane, spoilage: spoilageOf(lane.item === null ? [] : [lane.item]) };
        });
    });

    const machines = new Map<number, MachineTraits>();
    config.machines.forEach(machine => machines.set(machine.id, machineTraitsOf(machine)));

    const outputsOf = (id: number) => machines.get(id)?.yield.results.map(result => result.item) ?? [];
    const put_into: PutIntoView = {
        machineOutputs: outputsOf,
        beltItems: id => (belt_lanes.get(id) ?? []).map(lane => lane.ingredient_name),
    };
    const chests = new Map<number, Chest>();
    (config.chests ?? []).forEach((chest_config: ChestConfig) => {
        const items_put_in = itemsPutInto(config, chest_config.id, put_into);
        const chest = Chest.fromConfig(chest_config, items_put_in);
        chests.set(chest_config.id, chest);
        const storage = chestStorage(chest, items_put_in);
        traits[chest.entity_id.id] = {
            kind: "chest", entity: chest.entity_id.id, storage,
            spoilage: spoilageOf(storage.capacity_by_item.map(capacity => capacity.item)),
        };
    });

    config.machines.forEach(machine_config => {
        const machine = machines.get(machine_config.id)!;
        const prototype = machine_config.prototype === undefined ? null : FactorioDataService.findCraftingMachine(machine_config.prototype);
        const placement = machinePlacesResults(machine_config) && prototype?.vector_to_place_result !== undefined
            ? machinePlacement(prototype.vector_to_place_result,
                machine_config.result_target === undefined ? null : targetId(machine_config.result_target),
                machine_config.result_target === undefined ? null : placementTargetOf(machine_config.result_target, machines, chests),
                outputsOf(machine_config.id))
            : null;
        traits[machine.entity] = { ...machine, placement };
    });

    const view: InserterEndView = {
        beltLanes: id => belt_lanes.get(id) ?? [],
        machineOutputs: outputsOf,
        machineInputs: id => machines.get(id)?.input_limits.limits.map(limit => limit.item) ?? [],
        chestGives: id => chests.get(id)?.getItemFilters() ?? [],
        chestAccepts: (id, item) => chests.get(id)?.acceptsItem(item) ?? false,
    };
    config.inserters.forEach((inserter, index) => {
        const id = inserter.id ?? index + 1;
        const built = inserterTraitsOf(id, inserter, view, lane_traits);
        traits[built.entity] = built;
    });

    (config.drills?.configs ?? []).forEach(drill => {
        const built = drillTraitsOf(drill, machines, chests);
        traits[built.entity] = built;
    });
    return traits;
}
