import { Box } from '@mui/material';
import { useGameNames } from '../hooks/useGameNames';
import { richTextParts, type RichTextPart } from '../utils/richText';
import { VISUALLY_HIDDEN } from '../utils/visuallyHidden';
import { FactorioIcon } from './FactorioIcon';
import { GameName } from './GameName';
import { QualityPip, WithQuality } from './QualityBadge';

/** The size of an icon in a line of text: the game draws one the height of its words */
const ICON_PX = 20;

const titleCase = (word: string) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`;

function RichIcon({ part }: { part: Extract<RichTextPart, { kind: 'icon' }> }) {
    const { itemLabel, recipeLabel } = useGameNames();
    const slot = { display: 'inline-flex', verticalAlign: 'middle', mx: 0.25 } as const;
    if (part.icon === 'quality') {
        // the quality's icon alone; a screen reader hears its name
        return (
            <Box component="span" sx={slot} title={titleCase(part.name)}>
                <QualityPip quality={part.name} size={ICON_PX} />
                <Box component="span" sx={VISUALLY_HIDDEN}>{titleCase(part.name)}</Box>
            </Box>
        );
    }
    const recipe = part.icon === 'recipe';
    const label = recipe ? recipeLabel(part.name) : itemLabel(part.name);
    const named = part.quality === undefined ? label : `${label} (${titleCase(part.quality)})`;
    return (
        <Box component="span" sx={slot}>
            <WithQuality quality={part.quality} size={ICON_PX}>
                <FactorioIcon name={part.name} size={ICON_PX} alt={named} titled
                    fallback={<GameName id={part.name} kind={recipe ? 'recipe' : 'item'} />} />
            </WithQuality>
        </Box>
    );
}

/**
 * A line of the game's rich text as the game shows it: the words as they are and each tag, "[entity=car]",
 * "[recipe=iron-plate]", "[item=iron-ore,quality=rare]", as its icon (the in-game name when the icon is missing)
 */
export function RichText({ text }: { text: string }) {
    return (
        <>
            {richTextParts(text).map((part, index) => part.kind === 'text'
                ? <span key={index}>{part.text}</span>
                : <RichIcon key={index} part={part} />)}
        </>
    );
}
