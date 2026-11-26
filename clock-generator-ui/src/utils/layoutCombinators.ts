import type { CombinatorLetter } from 'clock-generator/browser';
import type { ClockInstallFacts } from '../worker/installFacts';
import { wiringRowKey } from './installSteps';

/** One combinator of the clock that switches inserters or drills on, as the Layout view and the wiring list draw it */
export interface LayoutCombinator {
    /** `wiringRowKey`: "inserter:5,14", "drill:2" */
    key: string;
    kind: 'inserter' | 'drill';
    /** The config ids of what it switches on, ascending */
    ids: number[];
    letter: CombinatorLetter;
    /** The items of the first line of its description, which the game shows on the combinator; none where the line has no items */
    items: string[];
}

/** The items a combinator's first line names, "[item=iron-plate]": the pictures its legend line draws */
const itemsOfLine = (line: string | undefined): string[] =>
    [...new Set([...(line ?? '').matchAll(/\[item=([a-z0-9-]+)/g)].map(match => match[1]))];

/**
 * The combinators of a clock that has letters, in the order of the letters. A clock with none (a result kept from before
 * the letters), and a combinator whose row has none, give none.
 */
export function layoutCombinatorsOf(install: Pick<ClockInstallFacts, 'wiring' | 'drills' | 'lines' | 'letters'> | null | undefined): LayoutCombinator[] {
    const letters = install?.letters;
    if (install === null || install === undefined || letters === undefined) return [];
    const rows = (kind: 'inserter' | 'drill', groups: number[][]) => groups.flatMap(ids => {
        const key = wiringRowKey(kind, ids);
        const letter = letters[key];
        return letter === undefined ? [] : [{ key, kind, ids: [...ids].sort((a, b) => a - b), letter, items: itemsOfLine(install.lines[key]) } satisfies LayoutCombinator];
    });
    return [...rows('inserter', install.wiring), ...rows('drill', install.drills)];
}

/** The combinator that switches an inserter or a drill on, by "inserter:5" or "drill:2" */
export function combinatorOfEntity(combinators: readonly LayoutCombinator[]): Map<string, LayoutCombinator> {
    return new Map(combinators.flatMap(combinator => combinator.ids.map(id => [`${combinator.kind}:${id}`, combinator] as const)));
}

/** "inserters 5, 14", "inserter 7", "drill 2": what a combinator switches on, in a sentence */
export const switchesText = (combinator: Pick<LayoutCombinator, 'kind' | 'ids'>): string =>
    `${combinator.kind}${combinator.ids.length > 1 ? 's' : ''} ${combinator.ids.join(', ')}`;
