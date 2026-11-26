import { Box } from '@mui/material';
import type { CombinatorLetter } from 'clock-generator/browser';
import { combinatorColour, COMBINATOR_INK } from '../utils/combinatorColours';

/**
 * A combinator's swatch with its letter, as the wiring list and the legend show it: the letter in dark ink on the combinator's
 * colour, in a square, or in a round swatch past the eleventh combinator (the colours then repeat). The edge is the text colour of
 * the theme, so it shows on the panel in both themes.
 */
export function CombinatorTag({ letter }: { letter: CombinatorLetter }) {
    return (
        <Box component="span" role="img" aria-label={`Combinator ${letter.letter}`} data-combinator-swatch={letter.letter} data-tag-shape={letter.round ? 'round' : 'square'}
            sx={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box', minWidth: 20, height: 20, px: 0.5,
                bgcolor: combinatorColour(letter), color: COMBINATOR_INK, border: '1px solid', borderColor: 'text.primary',
                borderRadius: letter.round ? '10px' : '3px', font: '700 12px/1 sans-serif', verticalAlign: 'text-bottom', flexShrink: 0,
            }}>
            <span aria-hidden="true">{letter.letter}</span>
        </Box>
    );
}
