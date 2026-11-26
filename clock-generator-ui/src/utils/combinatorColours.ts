import type { CombinatorLetter } from 'clock-generator/browser';

/**
 * The colour of each combinator's tag, in the order of the rule's colour slots (a letter's `colour`): eleven, spread over the
 * hues, each light enough to hold the dark ink of its letter at 4.5 to 1 and to show at 3 to 1 on both squares of the Layout
 * view's ground (combinatorColours.test.ts). The twelfth combinator uses the first again, in a round tag.
 */
export const COMBINATOR_COLOURS = [
    '#ff8fb8', '#ffb347', '#fff275', '#9be15d', '#3fd6a5', '#5fd0ff', '#a9b4ff', '#d59cff', '#ff7bf0', '#a08080', '#60f0f0',
] as const;

/** The ink of a letter on its colour, and of the rim round a tag */
export const COMBINATOR_INK = '#1a1a1a';

export const combinatorColour = (letter: CombinatorLetter): string => COMBINATOR_COLOURS[letter.colour % COMBINATOR_COLOURS.length];
