/**
 * The steps that put a generated clock into the game, as the page shows them. Every word is a named constant here, so
 * that a change of wording is one edit; each claim is from the code that builds the blueprint (2.5 spec, "Owner
 * checkpoint: the install and wiring steps").
 */

interface InstallInput {
    /** The string is a book of two blueprints of the same clock */
    book: boolean;
    /** The config ids of the inserters wired to each combinator that switches inserters on */
    wiring: number[][];
    /** The build has mining drills on the clock */
    hasDrills: boolean;
}

export type InstallStepId = 'import' | 'book' | 'place' | 'wire' | 'enable' | 'others' | 'none' | 'lock';

export interface InstallStep {
    id: InstallStepId;
    title: string;
    detail: string;
}

/** The version the blueprints need: the else outputs of a decider combinator, which the clocks use, came with 2.1 */
export const REQUIRES_FACTORIO = 'Needs Factorio 2.1.';

/** Every player-facing string of the install steps */
export const INSTALL_COPY = {
    heading: 'Put it in your game',
    stale: 'Generate again for a new clock and its steps.',
    wiringCaption: 'Combinator → inserters',
    wiringCombinatorColumn: 'Combinator for',
    wiringInsertersColumn: 'Wire its output to',
    import: {
        title: 'Import it in Factorio 2.1.',
        detail: 'Press Copy blueprint. In Factorio 2.1, open the blueprint library and import the string: Import '
            + 'string, or Ctrl+V. Older versions cannot read these clocks: they use a feature that came with 2.1.',
    },
    book: {
        title: 'Pick one blueprint from the book.',
        detail: 'The book holds the same clock twice. The first one, whose name ends in "(modulo clock)", checks '
            + 'windows that repeat against a shorter repeating count, so its combinators have far fewer conditions. The '
            + 'other lists every wake window on the plain clock. They switch your inserters on at the same ticks. Take '
            + 'the first one unless you want the plain one.',
    },
    place: {
        title: 'Place the combinators next to your build.',
        detail: 'Place the blueprint on clear ground near your inserters. It has only combinators: no inserters and no '
            + 'machines. They are wired to each other already; do not rewire them. A wire reaches 9 tiles, so keep each '
            + 'combinator within reach of its inserters.',
    },
    wire: {
        title: 'Wire the output of each combinator to its inserters.',
        detail: 'A combinator described as "Inserter 3 for [item] from [recipe] into [recipe]" switches that inserter '
            + 'on. With a green wire, connect its output to each inserter in the list below. Find an inserter by its '
            + 'item and by the machines at its two ends; the numbers are the ones on Configure. The game keeps only 500 '
            + 'bytes of a description, so use this list. The other combinators (Clock, Fuel clock, Clock lock filter, '
            + 'and the ones about a modulo or a subtick clock) are the clock itself: leave them.',
    },
    enable: {
        title: 'Set each wired inserter to switch on with that wire.',
        detail: 'Open the inserter, find Circuit network connection, choose Enable/disable, and set the condition to '
            + 'Anything > 0. The combinator puts out one of the inserter\'s item only while the clock is in a wake '
            + 'window, so the inserter works only then.',
        drills: ' A mining drill is wired and set the same way. Its combinator is described as "Drill 1 for …".',
    },
    others: {
        title: 'Leave the other inserters alone.',
        detail: 'An inserter that is not in the list runs all the time: it is set to Always on, or it has nothing to '
            + 'wait for. Do not wire it. If this clock replaces an older one, set the inserters the old clock switched, '
            + 'and this list does not name, back to always enabled, or they stay off for good.',
    },
    none: {
        title: 'Nothing to wire.',
        detail: 'This clock has no combinator for your inserters, so there is nothing to wire.',
    },
    lock: {
        title: 'Know the lock.',
        detail: 'The small constant combinator under the clock is the lock. It is off: leave it off. Switch it on to '
            + 'stop the clock; no inserter is switched on while it is on. Switch it off and the clock starts again from '
            + 'its beginning, and the first period after may be a tick off.',
    },
} as const;

const step = (id: Exclude<InstallStepId, 'enable'>): InstallStep => ({ id, ...INSTALL_COPY[id] });

/**
 * The steps for a clock, in order (the page numbers them by their place): import; pick from the book (only for a
 * book); place; then wire, switch on and leave the others, or one "nothing to wire" step when no combinator switches
 * an inserter on; and the lock.
 */
export function installSteps(input: InstallInput): InstallStep[] {
    const enable: InstallStep = {
        id: 'enable',
        title: INSTALL_COPY.enable.title,
        detail: INSTALL_COPY.enable.detail + (input.hasDrills ? INSTALL_COPY.enable.drills : ''),
    };
    return [
        step('import'),
        ...(input.book ? [step('book')] : []),
        step('place'),
        ...(input.wiring.length > 0 ? [step('wire'), enable, step('others')] : [step('none')]),
        step('lock'),
    ];
}

/** The rows of the wiring list: ids ascending in a row, rows by their first id, empty rows dropped */
function orderedRows(wiring: number[][]): number[][] {
    return wiring
        .map(ids => [...ids].sort((a, b) => a - b))
        .filter(ids => ids.length > 0)
        .sort((a, b) => a[0] - b[0]);
}

/** Each combinator's row of the wiring list, ordered by its first inserter: "Inserters 1, 2", "Inserter 3" */
export function wiringRows(wiring: number[][]): string[] {
    return orderedRows(wiring).map(ids => `${ids.length > 1 ? 'Inserters' : 'Inserter'} ${ids.join(', ')}`);
}

/** The inserters each row's combinator is wired to, one by one: "Inserter 1, Inserter 2" */
export function wiringTargets(wiring: number[][]): string[] {
    return orderedRows(wiring).map(ids => ids.map(id => `Inserter ${id}`).join(', '));
}
