import { CraftingMachineRuleFacts, fuelModelled, placesResultsItself } from "../machine/machine-rule";

/** The data of a crafting machine prototype that its traits are read from, as far as they follow from the data alone */
export interface CraftingMachineTraitFacts extends CraftingMachineRuleFacts {
    /** Where it places its results itself, from its centre in tiles; absent for a machine that keeps them in its output */
    readonly vector_to_place_result?: readonly number[];
}

/**
 * What a crafting machine prototype's data alone says of its machine's traits: the two a page that has the prototype but
 * not the game data service (the UI's machine editor) decides what to show by.
 */
export interface PrototypeTraits {
    /**
     * The Energy trait's `fuel_modelled`: the machine burns a fuel the simulator models (the biochamber's nutrients), so its
     * energy consumption counts
     */
    readonly fuel_modelled: boolean;
    /** Whether the machine has a Placement trait: it places its results itself, at its `vector_to_place_result` (the recycler) */
    readonly places_results: boolean;
}

/**
 * The traits of a crafting machine prototype that its data settles, by the tests the engine builds the traits with: the
 * Energy trait's `fuel_modelled` (energy.ts asks `fuelModelled`) and the Placement trait's presence (`buildTraits` asks
 * `placesResultsItself`, through `machinePlacesResults`). No name decides either.
 */
export function prototypeTraitsOf(prototype: CraftingMachineTraitFacts): PrototypeTraits {
    return { fuel_modelled: fuelModelled(prototype), places_results: placesResultsItself(prototype) };
}
