import { MiningDrillType } from "../entities/drill/mining-drill";
// the game's own shapes of the fields resources/filter-raw.js keeps from the manifest (resources/trait-fields.json)
import type * as Game from "./generated/prototype-types";

export type ItemName = string;

export interface Ingredient {
  type: "item" | "fluid",
  name: ItemName,
  amount: number
}

export type RecipeName = string;

export type Recipe = {
  type: "recipe"
  name: RecipeName
  enabled: boolean
  energy_required: number
  ingredients: Ingredient[]
  results: Ingredient[]
  allow_productivity: boolean
  /**
   * The crafting categories the recipe can be made in. Factorio 2.1 gives a recipe several (`categories` in the
   * data; before 2.1 one `category`, with combined ones such as "organic-or-assembling"); resources/filter-raw.js
   * writes the list for either, "crafting" when the data names none.
   */
  categories: string[]
} & Record<string, any>

export type Item = {
  type: "item"
  name: ItemName
  stack_size: number
  /** The ticks the item takes to spoil; absent for an item that does not spoil */
  spoil_ticks?: number
}

/**
 * The manifest's other fields of an item where the prototype has them (the `item_prototype` section, beside `item`, whose
 * entries travel whole in a generation's results and so keep their shape): `fuel_value` (energy as the game writes it,
 * "2MJ") and `fuel_categories` of a fuel, `spoil_result`. Not its weight: every item's is `item_weight`, the running game's.
 */
export type ItemPrototypeFields = Pick<Game.ItemPrototype, "hidden" | "fuel_value" | "fuel_categories" | "spoil_result" | "quality_affects_spoil_ticks">

/** A mining drill prototype, with the manifest's fields of its class (resources/filter-raw.js keeps these) */
export interface MiningDrillSpec extends Omit<Game.MiningDrillPrototype, "type" | "name"> {
  type: "mining-drill"
  name: MiningDrillType
  mining_speed: number
}

export type Minable = {
  minable: {
    mining_time: number
    result: ItemName
  }
}

export type ResourceName = string;
export type Resource = {
  type: "resource"
} & Minable


export type InserterPrototypeName = string;

/**
 * What the generator reads of an inserter prototype: its swing and its hand, then the manifest's other fields of its
 * class where the prototype sets them, each absent at the game's default (`wait_for_full_hand`, `max_belt_stack_size`,
 * `grab_less_to_match_belt_stack`, `filter_count`, ...; resources/filter-raw.js keeps these)
 */
export interface InserterPrototype extends Omit<Game.InserterPrototype, "name" | "rotation_speed" | "extension_speed" | "stack_size_bonus" | "bulk" | "pickup_position" | "insert_position"> {
  name: InserterPrototypeName
  /** Turns of the arm per tick, at normal quality; one full swing from pickup to drop is half a turn */
  rotation_speed: number
  extension_speed: number
  /** What the prototype adds to the hand of 1, 0 when the data names none */
  stack_size_bonus?: number
  /** Bulk inserters (the bulk and the stack inserter) take their research from the bulk capacity bonus */
  bulk?: boolean
  pickup_position: [number, number]
  insert_position: [number, number]
}

export type QualityName = string;

/**
 * A quality a build can name; the game's hidden quality-unknown is not kept. The manifest's multipliers of its class
 * follow where the prototype sets them (absent at the game's default, which the spec gives as another of them or `level`).
 */
export interface QualitySpec extends Omit<Game.QualityPrototype, "name" | "level"> {
  name: QualityName
  level: number
}

/** What the technologies add to the hand of an inserter when all of them are researched */
export interface InserterResearch {
  /** The sum of the "inserter-stack-size-bonus" effects, for the inserters that are not bulk ones */
  inserter_stack_size_bonus: number
  /** The sum of the "bulk-inserter-capacity-bonus" effects, for the bulk ones */
  bulk_inserter_capacity_bonus: number
}

/** A vehicle or wagon an inserter can fill or empty: the slots of its trunk or cargo inventory */
export interface ContainerPrototype extends Pick<Game.EntityPrototype, "hidden" | "minable"> {
  name: string
  /** The prototype's type in the game: "car" (the car and the tank) or "cargo-wagon" */
  type: string
  inventory_size: number
  /** Whether the entity's quality multiplies its slots (the cargo wagon's, by the quality's multiplier) */
  quality_affects_inventory_size: boolean
}

/** What a quality does to an inventory whose prototype lets quality change its size */
export interface QualityInventory {
  cargo_wagon_inventory_size_multiplier: number
}

/**
 * A rocket silo: the recipe it is fixed to, its speed, and the weight a rocket lifts; then the manifest's other fields of
 * its class where the prototype sets them (its energy source and usage, the rocket parts a rocket takes, ...)
 */
export interface RocketSiloPrototype extends Omit<Game.RocketSiloPrototype, "name" | "fixed_recipe" | "crafting_speed" | "module_slots" | "lift_weight"> {
  name: string
  fixed_recipe: RecipeName
  crafting_speed: number
  module_slots: number
  lift_weight: number
}

/**
 * A crafting machine of the game data (an assembling machine or a furnace prototype): what the simulation rule of a
 * machine and the recipes it can make follow from (resources/filter-raw.js keeps these)
 */
export interface CraftingMachinePrototype extends Pick<Game.AssemblingMachinePrototype, "hidden" | "minable"
  | "crafting_speed_quality_multiplier" | "effect_receiver" | "allowed_effects" | "module_slots" | "quality_affects_module_slots"
  | "module_slots_quality_bonus" | "energy_usage_quality_multiplier" | "quality_affects_energy_usage" | "fixed_recipe"> {
  name: string
  /** The prototype's type in the game: a furnace picks its recipe from what it is given; an assembling machine is set to one */
  type: "assembling-machine" | "furnace"
  /** The crafting categories of the recipes it can make */
  crafting_categories: string[]
  /** The fuel categories it burns when its energy source is a burner; none for any other energy source */
  burner_fuel_categories: string[]
  /** Its base crafting speed, before modules, beacons and quality */
  crafting_speed: number
  /**
   * Where it places its results itself, from its centre in tiles, for a machine that does (the recycler): into what
   * stands there, and into its own output where nothing does. Absent for a machine whose results stay in its output.
   */
  vector_to_place_result?: [number, number]
  /**
   * How it is powered, as the game data gives it: a burner with the fuel categories it burns (which
   * `burner_fuel_categories` lists for any game version), an electric source, ...
   */
  energy_source: Game.EnergySource
  /** What it uses while crafting at 100%, as the game writes energy ("500kW") */
  energy_usage: string
}

/** A transport belt prototype: its speed in tiles per tick (the turbo belt's 0.125 is 60 items a second on its lanes) */
export type TransportBeltPrototype = Game.TransportBeltPrototype

export interface FactorioData {
  "recipe": Record<RecipeName, Recipe>
  "item": Record<ItemName, Item>
  "item_prototype": Record<ItemName, ItemPrototypeFields>
  "mining-drill": Record<MiningDrillType, MiningDrillSpec>
  "resource": Record<ResourceName, Resource>
  "inserter": Record<InserterPrototypeName, InserterPrototype>
  "quality": Record<QualityName, QualitySpec>
  "inserter_research": InserterResearch
  "container": Record<string, ContainerPrototype>
  "quality_inventory": Record<QualityName, QualityInventory>
  "rocket_silo": Record<string, RocketSiloPrototype>
  "crafting_machine": Record<string, CraftingMachinePrototype>
  "transport_belt": Record<string, TransportBeltPrototype>
  /** Every item's weight as the running game holds it (in 1/65536 parts; resources/dump-item-weights.js) */
  "item_weight": Record<ItemName, number>
  /** The game's English names by id, items (entities and fluids too) and recipes apart (resources/locale-names.js) */
  "names"?: { item: Record<string, string>; recipe: Record<string, string> }
}