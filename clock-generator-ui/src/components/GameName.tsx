import { useGameNames } from '../hooks/useGameNames';

interface GameNameProps {
    id: string;
    /** Whether the id is an item (fluids and entities too) or a recipe */
    kind?: 'item' | 'recipe';
}

/** The in-game name of an id, with the id in the hover title */
export function GameName({ id, kind = 'item' }: GameNameProps) {
    const { itemLabel, recipeLabel } = useGameNames();
    return <span title={id}>{kind === 'recipe' ? recipeLabel(id) : itemLabel(id)}</span>;
}
