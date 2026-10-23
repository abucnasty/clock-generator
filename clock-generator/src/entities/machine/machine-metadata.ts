import { RecipeMetadata } from "./recipe";
import { MachineType } from "./machine-type";

export { MachineType } from "./machine-type";

export interface MachineMetadata {
    productivity: number;
    crafting_speed: number;
    recipe: RecipeMetadata;
    type: MachineType;
    /** Total energy consumption effect in percent, e.g. 50 for +50%. Defaults to 0. Only used by fuel-burning types. */
    energy_consumption_bonus?: number;
    /** Fuel item to burn. Only used by fuel-burning types; defaults to their first accepted fuel. */
    fuel?: string;
    /** The machine's prototype name in the game data, for labels only (the config's `prototype`) */
    prototype?: string;
}