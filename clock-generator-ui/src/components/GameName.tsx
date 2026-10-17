import { useGameNames } from '../hooks/useGameNames';
import { nameWithId } from '../utils/gameNames';

interface GameNameProps {
    id: string;
    /** Whether the id is an item (fluids and entities too) or a recipe */
    kind?: 'item' | 'recipe';
}

/** The in-game name of an id, with the name and id in the hover title */
export function GameName({ id, kind = 'item' }: GameNameProps) {
    const { itemLabel, recipeLabel } = useGameNames();
    const label = kind === 'recipe' ? recipeLabel(id) : itemLabel(id);
    return <span title={nameWithId(label, id)}>{label}</span>;
}
