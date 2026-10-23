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

/** A crafting machine prototype of the game data with its name, as the data lists them */
export interface NamedCraftingMachine extends CraftingMachineRuleFacts {
    readonly name: string;
}

/**
 * The machine to set for a recipe of these categories, among `machines` (in the data's order): one that can make the
 * recipe, first one whose crafting categories hold the recipe's own category (its first, the others being additional),
 * then one that burns no fuel, then the first in the data. Undefined when none can make it. No name decides it.
 */
export function machineForRecipe<T extends NamedCraftingMachine>(recipe_categories: readonly string[], machines: readonly T[]): T | undefined {
    const able = machines.filter(machine => machineCanMake(machine, recipe_categories));
    const own = recipe_categories[0];
    const rank = (machine: T) => (own !== undefined && machine.crafting_categories.includes(own) ? 0 : 2)
        + (machine.burner_fuel_categories.length === 0 ? 0 : 1);
    return able.reduce<T | undefined>((best, machine) => best === undefined || rank(machine) < rank(best) ? machine : best, undefined);
}

/**
 * The machine a config's former `type` (a rule) stands for, for a recipe of these categories: the machine
 * `machineForRecipe` picks among those of that rule. When no machine of the rule can make the recipe, a furnace or
 * biochamber rule still needs a machine to keep its rule (the first of the rule that burns no fuel, else the first),
 * and the crafting rule needs none (a machine without a prototype is simulated under it), so it is undefined.
 */
export function machineForRule<T extends NamedCraftingMachine>(rule: MachineType, recipe_categories: readonly string[], machines: readonly T[]): T | undefined {
    const of_rule = machines.filter(machine => machineRuleOfPrototype(machine) === rule);
    const able = machineForRecipe(recipe_categories, of_rule);
    if (able !== undefined || rule === MachineType.MACHINE) {
        return able;
    }
    return of_rule.find(machine => machine.burner_fuel_categories.length === 0) ?? of_rule[0];
}
