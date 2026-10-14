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
    /**
     * Per combinator that switches mining drills on: the config ids of its drills, ascending, rows by their first id.
     * Empty when no drill is on the clock (none in the build, or each one always on)
     */
    drills: number[][];
}

/** The first line of a drill's combinator description, "Drills 1, 2 for [item=iron-ore] …" (`entityDescriptionHeaderLines`) */
const DRILL_HEADER = /^Drills? (\d+(?:, \d+)*) for /;

const ordered = (rows: number[][]) => rows
    .map(ids => [...ids].sort((a, b) => a - b))
    .filter(ids => ids.length > 0)
    .sort((a, b) => a[0] - b[0]);

/**
 * The install facts of a generated clock, from the same data the in-game harness wires from: whether the string is a
 * book (`blueprintFileFor` makes one when there is a modulo blueprint) and which inserters each combinator switches on.
 * The schedule leaves drills out, so a drill's combinator is found by the description the engine gives it, which is
 * what the player reads in the game; a drill that is always on has none. A combinator that switches nothing on (a part
 * of the clock) has no row.
 */
export function installFactsOf(result: Pick<BlueprintGenerationResult, 'modulo_blueprint' | 'schedule' | 'blueprint'>): ClockInstallFacts {
    const drills = result.blueprint.entities.flatMap(entity => {
        if (entity.name !== 'decider-combinator') {
            return [];
        }
        const header = DRILL_HEADER.exec(entity.player_description ?? '');
        return header ? [header[1].split(', ').map(Number)] : [];
    });
    return {
        book: result.modulo_blueprint !== undefined,
        wiring: ordered(result.schedule.inserter_combinators.map(combinator => combinator.inserter_ids)),
        drills: ordered(drills),
    };
}
