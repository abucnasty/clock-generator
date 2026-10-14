import type { BlueprintGenerationResult } from 'clock-generator/browser';

/** What the install steps of a clock need to know about its blueprint, as plain data that crosses `postMessage` */
export interface ClockInstallFacts {
    /** The exported string is a book: the modulo clock first, the full-window clock second */
    book: boolean;
    /**
     * Per combinator that switches inserters on: the config ids of the inserters wired to it, ascending. Rows ordered by
     * their first id. Empty when every inserter is left always enabled
     */
    wiring: number[][];
}

/**
 * The install facts of a generated clock, from the same data the in-game harness wires from: whether the string is a
 * book (`blueprintFileFor` makes one when there is a modulo blueprint) and which inserters each combinator switches on.
 * A combinator that switches no inserter on (a part of the clock, or a drill's) has no row.
 */
export function installFactsOf(result: Pick<BlueprintGenerationResult, 'modulo_blueprint' | 'schedule'>): ClockInstallFacts {
    const wiring = result.schedule.inserter_combinators
        .map(combinator => [...combinator.inserter_ids].sort((a, b) => a - b))
        .filter(ids => ids.length > 0)
        .sort((a, b) => a[0] - b[0]);
    return { book: result.modulo_blueprint !== undefined, wiring };
}
