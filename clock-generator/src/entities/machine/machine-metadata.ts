import { EntityType } from "../entity-type";
import { RecipeMetadata } from "./recipe";

export const MachineType = {
    MACHINE: EntityType.MACHINE,
    FURNACE: EntityType.FURNACE,
    /** Burns nutrients as fuel while crafting. Otherwise behaves like a machine. */
    BIOCHAMBER: "biochamber",
} as const

export type MachineType = typeof MachineType[keyof typeof MachineType];

export interface MachineMetadata {
    productivity: number;
    crafting_speed: number;
    recipe: RecipeMetadata;
    type: MachineType;
    /** Total energy consumption effect in percent, e.g. 50 for +50%. Defaults to 0. Only used by fuel-burning types. */
    energy_consumption_bonus?: number;
}