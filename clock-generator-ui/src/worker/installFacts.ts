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

/** The first line of a drill's combinator description in a clock from before the tags, "Drills 1, 2 for [item=iron-ore] …" */
const DRILL_HEADER = /^Drills? (\d+(?:, \d+)*) for /;
/** A drill's key in the clock's wake windows, "drill:2" */
const DRILL_ID = /^drill:(\d+)$/;

const ordered = (rows: number[][]) => rows
    .map(ids => [...ids].sort((a, b) => a - b))
    .filter(ids => ids.length > 0)
    .sort((a, b) => a[0] - b[0]);

/**
 * The install facts of a generated clock, from the same data the in-game harness wires from: whether the string is a
 * book (`blueprintFileFor` makes one when there is a modulo blueprint) and which inserters each combinator switches on.
 * The schedule leaves drills out, so a drill's combinator is found by its tags (the drills it switches on), or, in a
 * clock from before the tags, by its description; a drill that is always on has none. A combinator that switches
 * nothing on (a part of the clock) has no row.
 */
export function installFactsOf(
    result: Pick<BlueprintGenerationResult, 'modulo_blueprint' | 'schedule' | 'blueprint' | 'clock_windows'>,
): ClockInstallFacts {
    const described = result.blueprint.entities.flatMap(entity => {
        if (entity.name !== 'decider-combinator') {
            return [];
        }
        const tagged = entity.tags?.clock_generator;
        if (tagged !== undefined) {
            return tagged.drills !== undefined && tagged.drills.length > 0 ? [tagged.drills] : [];
        }
        const header = DRILL_HEADER.exec(entity.player_description ?? '');
        return header ? [header[1].split(', ').map(Number)] : [];
    });
    // every drill with wake windows has a combinator. The descriptions say which drills share one; a clocked drill no
    // description names (were their wording to change) still gets a row of its own, so a build that clocks only drills
    // never reads as one that needs no clock
    const named = new Set(described.flat());
    const unnamed = Object.entries(result.clock_windows).flatMap(([id, windows]) => {
        const drill = DRILL_ID.exec(id);
        return drill && windows.length > 0 && !named.has(Number(drill[1])) ? [[Number(drill[1])]] : [];
    });
    const drills = [...described, ...unnamed];
    return {
        book: result.modulo_blueprint !== undefined,
        wiring: ordered(result.schedule.inserter_combinators.map(combinator => combinator.inserter_ids)),
        drills: ordered(drills),
    };
}
