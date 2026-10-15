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


export interface FactorioData {
  "recipe": Record<RecipeName, Recipe>
  "item": Record<ItemName, Item>
  "mining-drill": Record<MiningDrillType, MiningDrillSpec>
  "resource": Record<ResourceName, Resource>
}