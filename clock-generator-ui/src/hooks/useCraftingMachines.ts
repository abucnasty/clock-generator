import { createContext, useContext, useMemo } from 'react';
import { craftingMachineOf, NO_CRAFTING_MACHINES, recipesOfMachine } from '../utils/machinePrototype';
import { SearchOnlyRecipesContext } from './useGameNames';
import type { CraftingMachineData } from '../worker/types';

/** The crafting machines of the game data and the categories of the recipes they make; App provides them */
export const CraftingMachinesContext = createContext<CraftingMachineData>(NO_CRAFTING_MACHINES);

/** The crafting machines a machine row can be, from the game data */
export function useCraftingMachines(): CraftingMachineData {
    return useContext(CraftingMachinesContext);
}

/**
 * The recipes a machine's picker offers: with a machine of the game data only those it can make (the recycler's
 * recycling recipes in the open list), as the game does; else every recipe, with the search-only ones found by a search
 */
export function useMachineRecipeOptions(prototype: string | undefined, recipeNames: string[]): { options: string[]; searchOnly?: readonly string[] } {
    const data = useCraftingMachines();
    const searchOnly = useContext(SearchOnlyRecipesContext);
    return useMemo(() => {
        const machine = craftingMachineOf(data, prototype);
        return machine ? { options: recipesOfMachine(machine, [...recipeNames, ...searchOnly], data), searchOnly: [] } : { options: recipeNames };
    }, [data, prototype, recipeNames, searchOnly]);
}
