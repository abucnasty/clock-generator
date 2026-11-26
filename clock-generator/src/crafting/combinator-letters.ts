/**
 * The letter of each combinator that switches inserters or mining drills on. The description of such a combinator ends its
 * first line in its letter, "2 inserters [item=iron-plate] (5, 14) (E)", and the page shows the same letter and a colour
 * for it on the Layout view and in the wiring reference, so a user can match an inserter, a row of the list and a combinator
 * in the game by it. One rule gives all three, so that they cannot disagree.
 *
 * The letter is a function of the config ids alone: the inserter groups in the order of their first id, then the drill groups
 * in the order of their first id (the order of the wiring list). It is never kept on the schedule, which is part of what a
 * clock is (clock-identity.ts).
 */

/** The page has this many colours; the 12th combinator uses the first again, with a round tag in place of a square one */
export const COMBINATOR_COLOURS = 11;

export type CombinatorKind = "inserter" | "drill";

export interface CombinatorLetter {
    /** "A" to "Z", then "AA", "AB", ... */
    letter: string;
    /** The colour's place in the page's table of colours, 0 to COMBINATOR_COLOURS - 1 */
    colour: number;
    /** Past the first COMBINATOR_COLOURS combinators the tag is round, so a colour used twice stays told apart */
    round: boolean;
}

/** The config ids of the inserters and of the drills each combinator switches on */
export interface CombinatorGroups {
    inserters: readonly (readonly number[])[];
    drills: readonly (readonly number[])[];
}

/** Where a combinator's letter is looked up: "inserter:1,5", "drill:2" (ids ascending) */
export const combinatorKey = (kind: CombinatorKind, ids: readonly number[]): string => `${kind}:${[...ids].sort((a, b) => a - b).join(",")}`;

/** "A" for 0 to "Z" for 25, then "AA" for 26, "AB", ... */
export function letterOfIndex(index: number): string {
    let rest = index;
    let letter = "";
    do {
        letter = String.fromCharCode(65 + (rest % 26)) + letter;
        rest = Math.floor(rest / 26) - 1;
    } while (rest >= 0);
    return letter;
}

/** The letter of each combinator, by `combinatorKey`. A group with no ids has no combinator and gets none. */
export function combinatorLetters(groups: CombinatorGroups): ReadonlyMap<string, CombinatorLetter> {
    const ordered = (kind: CombinatorKind, rows: readonly (readonly number[])[]) => rows
        .filter(ids => ids.length > 0)
        .map(ids => [...ids].sort((a, b) => a - b))
        .sort((a, b) => a[0] - b[0])
        .map(ids => combinatorKey(kind, ids));
    const keys = [...ordered("inserter", groups.inserters), ...ordered("drill", groups.drills)];
    return new Map(keys.map((key, index) => [key, {
        letter: letterOfIndex(index),
        colour: index % COMBINATOR_COLOURS,
        round: index >= COMBINATOR_COLOURS,
    }] as const));
}
