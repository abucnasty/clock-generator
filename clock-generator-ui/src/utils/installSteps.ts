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
    /** The config ids of the mining drills wired to each combinator that switches drills on */
    drills: number[][];
}

export type InstallStepId = 'import' | 'book' | 'place' | 'wire' | 'enable' | 'drills' | 'others' | 'none' | 'lock';

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
    wiringCaption: 'Combinator → what to wire to its output',
    oneCombinator: 'one combinator for all of these',
    import: {
        title: 'Import it in Factorio 2.1.',
        detail: 'Press Copy blueprint. In Factorio 2.1, open the blueprint library and import the string: Import '
            + 'string, or Ctrl+V. Older versions cannot read these clocks: they use a feature that came with 2.1.',
    },
    book: {
        title: 'Pick one blueprint from the book.',
        detail: 'The book holds the same clock twice. Use the first blueprint, whose name ends in "(modulo clock)"; the '
            + 'book opens on it. The second does the same with more conditions.',
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
            + 'on. With a green wire, connect its output to each inserter in the wiring reference. Find an inserter by its '
            + 'item and by the machines at its two ends; the numbers are the ones on Configure. The combinator\'s '
            + 'description names the same inserters; this list has all of it. The other combinators (Clock, Clock lock, Fuel '
            + 'clock, Clock lock filter, and the ones about a modulo or a subtick clock) are the clock itself: leave them.',
        drills: ' A combinator described as "Drill 1 for …" switches that mining drill on: wire it the same way.',
    },
    enable: {
        title: 'Set each wired inserter to switch on with that wire.',
        detail: 'Open the inserter, find Circuit network connection, choose Enable/disable, and set the condition to '
            + 'Anything > 0. The combinator puts out one of the inserter\'s item only while the clock is in a wake '
            + 'window, so the inserter works only then.',
        drills: ' A mining drill is wired and set the same way.',
    },
    drills: {
        title: 'Wire each combinator\'s output to its mining drills, and set them to switch on with it.',
        detail: 'A combinator described as "Drill 1 for [item] into [recipe]" switches that mining drill on. With a '
            + 'green wire, connect its output to each drill in the wiring reference; the numbers are the ones on Configure. '
            + 'Then open the drill, find Circuit network connection, choose Enable/disable, and set the condition to '
            + 'Anything > 0. The other combinators (Clock, Clock lock, Clock lock filter, and the ones about a modulo or '
            + 'a subtick clock) are the clock itself: leave them.',
    },
    others: {
        title: 'Leave the other inserters alone.',
        // the engine gives no wake windows, so no combinator, to an inserter set to Always on.
        // Never on is the simulator's setting, which the engine does not always keep out of the clock: some builds still
        // put such an inserter in the list (an engine follow-up). An unwired inserter in the game runs all the time, so
        // the player keeps it off
        detail: 'An inserter that is not in the list gets no combinator. One set to Always on, or with nothing to wait '
            + 'for, runs all the time: do not wire it. One set to Never on is never switched on by the clock: keep it '
            + 'off in the game yourself. If this clock replaces an older one, an inserter the old clock switched and '
            + 'this list does not name stays off for good: remove its wire, or untick Enable/disable.',
    },
    none: {
        title: 'Nothing to place or wire.',
        // generic: the clock's facts do not say whether the build has an inserter set to Never on
        detail: 'No inserter or drill is on the clock, so this build needs no clock. If you set an inserter to Never '
            + 'on, keep it switched off in the game yourself.',
    },
    lock: {
        title: 'Know the lock.',
        detail: 'The small constant combinator under the clock is the lock. It is off: leave it off. Switch it on to '
            + 'stop the clock; no inserter is switched on while it is on. Switch it off and the clock starts again from '
            + 'its beginning, and the first period after may be a tick off.',
    },
} as const;

/**
 * The clock names no inserter and no drill to wire (each runs all the time, as far as the engine is concerned), so
 * there is no clock to place
 */
export function needsNoClock(input: Pick<InstallInput, 'wiring' | 'drills'>): boolean {
    return input.wiring.length === 0 && input.drills.length === 0;
}

const step = (id: 'import' | 'book' | 'place' | 'drills' | 'others' | 'none' | 'lock'): InstallStep => ({ id, ...INSTALL_COPY[id] });

/**
 * The steps for a clock, in order (the page numbers them by their place): import; pick from the book (only for a
 * book); place; then wire, switch on and leave the others alone (a drill is wired with the inserters, or in a step of
 * its own when no inserter is on the clock); and the lock. A build whose inserters and drills all run all the time
 * needs no clock: one step says so.
 */
export function installSteps(input: InstallInput): InstallStep[] {
    if (needsNoClock(input)) {
        return [step('none')];
    }
    const inserters = input.wiring.length > 0;
    const drills = input.drills.length > 0;
    const wiring = inserters
        ? [
            { id: 'wire', title: INSTALL_COPY.wire.title, detail: INSTALL_COPY.wire.detail + (drills ? INSTALL_COPY.wire.drills : '') },
            { id: 'enable', title: INSTALL_COPY.enable.title, detail: INSTALL_COPY.enable.detail + (drills ? INSTALL_COPY.enable.drills : '') },
        ] satisfies InstallStep[]
        : [step('drills')];
    return [
        step('import'),
        ...(input.book ? [step('book')] : []),
        step('place'),
        ...wiring,
        step('others'),
        step('lock'),
    ];
}

/** What an inserter or drill moves and between which ends: the item ids (the page shows them as icons) and "Belt 1 to Machine 1" */
export interface WiringMoves {
    items: string[];
    route: string;
}

/** One inserter or drill to wire to a combinator's output */
interface WiringEntry extends WiringMoves {
    /** "Inserter 1", "Drill 2" */
    label: string;
}

/** One combinator's row of the wiring list */
export interface WiringRow {
    /** As its description starts: "Inserters 1, 5", "Drill 2" */
    combinator: string;
    /** What to wire to it, one line each */
    entries: WiringEntry[];
}

/** "Inserters 1, 5" or "Drill 2", as the engine's description header names a combinator's entities */
const namesText = (kind: 'Inserter' | 'Drill', ids: number[]) => `${kind}${ids.length > 1 ? 's' : ''} ${ids.join(', ')}`;

/**
 * The wiring list: one row per combinator, inserters first and then drills, each ordered by its first number, with
 * what each inserter or drill moves and between which ends (`movesOf`, keyed "inserter:3"; empty when unknown).
 */
export function wiringList(
    facts: Pick<InstallInput, 'wiring' | 'drills'>,
    movesOf: (id: string) => WiringMoves,
): WiringRow[] {
    const rows = (kind: 'Inserter' | 'Drill', groups: number[][]) => groups
        .map(ids => [...ids].sort((a, b) => a - b))
        .filter(ids => ids.length > 0)
        .sort((a, b) => a[0] - b[0])
        .map(ids => ({
            combinator: namesText(kind, ids),
            entries: ids.map(id => ({ label: `${kind} ${id}`, ...movesOf(`${kind.toLowerCase()}:${id}`) })),
        }));
    return [...rows('Inserter', facts.wiring), ...rows('Drill', facts.drills)];
}

