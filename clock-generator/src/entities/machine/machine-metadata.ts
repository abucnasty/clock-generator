import { RecipeMetadata } from "./recipe";
import { MachineType } from "./machine-type";

export { MachineType } from "./machine-type";

export interface MachineMetadata {
    productivity: number;
    crafting_speed: number;
    recipe: RecipeMetadata;
    /**
     * The simulation rule, derived from the machine's prototype (machine-rule.ts); internal, set by no config field. A
     * label only (facts, debug output): what the machine does by its kind it reads from its traits (machine.ts).
     */
    type: MachineType;
    /** Total energy consumption effect in percent, e.g. 50 for +50%. Defaults to 0. Only used by a machine whose fuel is modelled. */
    energy_consumption_bonus?: number;
    /** Fuel item to burn. Only used by a machine whose fuel is modelled; defaults to its burner's first fuel. */
    fuel?: string;
    /**
     * The machine's prototype name in the game data (the config's `prototype`): its traits are read from the prototype's
     * data (its class, its energy source); without one, or with one the data does not hold, it is an assembling machine
     * on electricity. Also a label.
     */
    prototype?: string;
    /**
     * Whether the machine places its results itself, by its prototype's game data (the recycler, machine-rule.ts): it
     * puts them in its output any number of stacks at a time and starts no craft while a stack of one of them waits
     * there, and, with a result target, puts what waits into that container each tick
     */
    places_results?: boolean;
}