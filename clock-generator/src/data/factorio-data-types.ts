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

export interface FactorioData {
  "recipe": Record<RecipeName, Recipe>
  "item": Record<ItemName, Item>
  "mining-drill": Record<MiningDrillType, MiningDrillSpec>
  "resource": Record<ResourceName, Resource>
  "inserter": Record<InserterPrototypeName, InserterPrototype>
  "quality": Record<QualityName, QualitySpec>
  "inserter_research": InserterResearch
}