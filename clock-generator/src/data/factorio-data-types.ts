import { MiningDrillType } from "../entities/drill/mining-drill";

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
} & Record<string, any>

export interface MiningDrillSpec {
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

/** What the generator reads of an inserter prototype: its swing and its hand (resources/filter-raw.js keeps these) */
export interface InserterPrototype {
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

/** A quality a build can name; the game's hidden quality-unknown is not kept */
export interface QualitySpec {
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
export interface ContainerPrototype {
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

/** A rocket silo: the recipe it is fixed to, its speed, and the weight a rocket lifts */
export interface RocketSiloPrototype {
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
export interface CraftingMachinePrototype {
  name: string
  /** The prototype's type in the game: a furnace picks its recipe from what it is given; an assembling machine is set to one */
  type: "assembling-machine" | "furnace"
  /** The crafting categories of the recipes it can make */
  crafting_categories: string[]
  /** The fuel categories it burns when its energy source is a burner; none for any other energy source */
  burner_fuel_categories: string[]
  /** Its base crafting speed, before modules, beacons and quality */
  crafting_speed: number
}

export interface FactorioData {
  "recipe": Record<RecipeName, Recipe>
  "item": Record<ItemName, Item>
  "mining-drill": Record<MiningDrillType, MiningDrillSpec>
  "resource": Record<ResourceName, Resource>
  "inserter": Record<InserterPrototypeName, InserterPrototype>
  "quality": Record<QualityName, QualitySpec>
  "inserter_research": InserterResearch
  "container": Record<string, ContainerPrototype>
  "quality_inventory": Record<QualityName, QualityInventory>
  "rocket_silo": Record<string, RocketSiloPrototype>
  "crafting_machine": Record<string, CraftingMachinePrototype>
  /** Every item's weight as the running game holds it (in 1/65536 parts; resources/dump-item-weights.js) */
  "item_weight": Record<ItemName, number>
  /** The game's English names by id, items (entities and fluids too) and recipes apart (resources/locale-names.js) */
  "names"?: { item: Record<string, string>; recipe: Record<string, string> }
}