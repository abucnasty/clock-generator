// @vitest-environment happy-dom
import { ThemeProvider } from '@mui/material';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CombinatorTag } from '../components/CombinatorTag';
import { createAppTheme } from '../theme/theme';
import { AA, contrastRatio, parseColor } from '../theme/contrast';
import { TILE_GRID_SHADE } from '../theme/tileGrid';
import { SURFACE, tokensFor } from '../theme/tokens';
import { COMBINATOR_COLOURS, COMBINATOR_INK, combinatorColour } from './combinatorColours';

/** The lighter square of the Layout view's ground: the shared checker's shade over the dark square, as an opaque colour */
function lighterSquare(): string {
    const shade = parseColor(TILE_GRID_SHADE);
    const under = parseColor(SURFACE.inset);
    const mix = (over: number, below: number) => Math.round(over * shade.a + below * (1 - shade.a));
    return `rgb(${mix(shade.r, under.r)}, ${mix(shade.g, under.g)}, ${mix(shade.b, under.b)})`;
}

describe('the colours of the combinators', () => {
    const squares = [['the dark square', SURFACE.inset], ['the lighter square', lighterSquare()]] as const;

    it('are eleven, all different', () => {
        expect(COMBINATOR_COLOURS).toHaveLength(11);
        expect(new Set(COMBINATOR_COLOURS).size).toBe(11);
    });

    it.each(COMBINATOR_COLOURS.map(colour => [colour]))('%s holds the letter\'s dark ink at 4.5 to 1', colour => {
        expect(contrastRatio(COMBINATOR_INK, colour)).toBeGreaterThanOrEqual(AA.text);
    });

    it.each(squares)('hold 3 to 1 on %s of the ground: the ring and the join line are drawn in them', (_name, square) => {
        for (const colour of COMBINATOR_COLOURS) expect(contrastRatio(colour, square), colour).toBeGreaterThanOrEqual(AA.nonText);
    });

    it('stand off their dark casing by 3 to 1, which is what keeps a ring and a join line apart from a belt under them', () => {
        for (const colour of COMBINATOR_COLOURS) expect(contrastRatio(colour, COMBINATOR_INK), colour).toBeGreaterThanOrEqual(AA.nonText);
    });

    it('go by a letter\'s colour slot, the twelfth combinator taking the first again', () => {
        expect(combinatorColour({ letter: 'A', colour: 0, round: false })).toBe(COMBINATOR_COLOURS[0]);
        expect(combinatorColour({ letter: 'L', colour: 0, round: true })).toBe(COMBINATOR_COLOURS[0]);
        expect(combinatorColour({ letter: 'K', colour: 10, round: false })).toBe(COMBINATOR_COLOURS[10]);
    });
});

describe('the edge of a swatch', () => {
    it.each(['dark', 'light'] as const)('holds 3 to 1 on the panel in the %s theme: it is the theme\'s text colour', mode => {
        const { text, surface } = tokensFor(mode);
        expect(contrastRatio(text.primary, surface.panel)).toBeGreaterThanOrEqual(AA.nonText);
        const { container } = render(<ThemeProvider theme={createAppTheme(mode)}><CombinatorTag letter={{ letter: 'E', colour: 4, round: false }} /></ThemeProvider>);
        const swatch = container.querySelector('[data-combinator-swatch]')!;
        expect(parseColor(getComputedStyle(swatch).borderTopColor)).toEqual(parseColor(text.primary));
    });
});
