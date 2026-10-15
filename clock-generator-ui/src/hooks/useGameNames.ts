import { createContext, useContext, useMemo } from 'react';
import { NO_NAMES, iconName, itemName, recipeName, type GameNames } from '../utils/gameNames';

/** The in-game names of the game data; App provides them. Without a provider every id shows as itself. */
export const GameNamesContext = createContext<GameNames>(NO_NAMES);

interface GameNameLabels {
    names: GameNames;
    /** The name of an item, fluid or entity id */
    itemLabel: (id: string) => string;
    /** The name of a recipe id */
    recipeLabel: (id: string) => string;
    /** The name of an icon's id (an item or a recipe) */
    iconLabel: (id: string) => string;
}

/** The in-game names, and a label function for each kind of id; the functions change only when the names do */
export function useGameNames(): GameNameLabels {
    const names = useContext(GameNamesContext);
    return useMemo(
        () => ({
            names,
            itemLabel: (id: string) => itemName(names, id),
            recipeLabel: (id: string) => recipeName(names, id),
            iconLabel: (id: string) => iconName(names, id),
        }),
        [names],
    );
}
