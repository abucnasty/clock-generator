import { RecipeMetadata } from "./recipe";
import { MachineType } from "./machine-type";

export { MachineType } from "./machine-type";

export interface MachineMetadata {
    productivity: number;
    crafting_speed: number;
    recipe: RecipeMetadata;
    /** The simulation rule, derived from the machine's prototype (machine-rule.ts); internal, set by no config field */
    type: MachineType;
    /** Total energy consumption effect in percent, e.g. 50 for +50%. Defaults to 0. Only used by fuel-burning types. */
    energy_consumption_bonus?: number;
    /** Fuel item to burn. Only used by fuel-burning types; defaults to their first accepted fuel. */
    fuel?: string;
    /** The machine's prototype name in the game data, for labels only (the config's `prototype`) */
    prototype?: string;
    /**
     * Whether the machine places its results itself, by its prototype's game data (the recycler, machine-rule.ts): it
     * puts them in its output any number of stacks at a time and starts no craft while a stack of one of them waits
     * there, and, with a result target, puts what waits into that container each tick
     */
    places_results?: boolean;
}