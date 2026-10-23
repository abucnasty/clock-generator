import { MachineType } from "./machine-type";

/** The fuel category the biochamber rule burns: a burner on it crafts under that rule */
export const NUTRIENTS_FUEL_CATEGORY = "nutrients";

/** What the rule of a machine and its recipes follow from, of a crafting machine prototype of the game data */
export interface CraftingMachineRuleFacts {
    /** "furnace" or "assembling-machine", the prototype's type in the game */
    readonly type: string;
    readonly crafting_categories: readonly string[];
    readonly burner_fuel_categories: readonly string[];
}

/**
 * The simulation rule of a crafting machine prototype, from its data alone: a furnace prototype (the recycler too) the
 * furnace rule; a burner on nutrients the biochamber rule; any other the crafting rule. No machine name decides it.
 */
export function machineRuleOfPrototype(prototype: CraftingMachineRuleFacts): MachineType {
    if (prototype.type === "furnace") {
        return MachineType.FURNACE;
    }
    if (prototype.burner_fuel_categories.includes(NUTRIENTS_FUEL_CATEGORY)) {
        return MachineType.BIOCHAMBER;
    }
    return MachineType.MACHINE;
}

/** Whether a machine of the prototype can make a recipe of these crafting categories, as the game decides it */
export function machineCanMake(prototype: Pick<CraftingMachineRuleFacts, "crafting_categories">, recipe_categories: readonly string[]): boolean {
    return recipe_categories.some(category => prototype.crafting_categories.includes(category));
}
