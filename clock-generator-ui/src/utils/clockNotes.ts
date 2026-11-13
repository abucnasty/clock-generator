import type { ClockInsight } from 'clock-generator/browser';
import type { ShiftOptionsView } from '../worker/types';

/**
 * The notes on the selected clock as Overview's lines: every string of them, and the mark and the chips of each kind of
 * note the engine makes for a clock. The engine words each note; the site says which to act on and which entities it is about.
 */
export const CLOCK_NOTE_COPY = {
    /** Overview's notes of a clock with none of its own */
    nothing: 'Nothing stands out on this clock.',
    details: 'Details',
    /** What the mark before a line says to a screen reader */
    marks: { caution: 'Caution', info: 'Information' },
    chips: { inserters: 'Inserters' },
    labels: { what: 'What', why: 'Why', explanation: 'Explanation' },
};

/**
 * The note the engine makes for a clock that holds its rate while some swings in the game land at other ticks than in the
 * plan. It is not one of Overview's notes: there is nothing to do about it, and the Timeline's switch between the blueprint
 * clock and the plan shows the difference.
 */
const SWINGS_OFF_THE_PLAN = 'plan-versus-clock';

/** Whether a note of the clock is one of Overview's notes */
export const shownInOverview = (insight: Pick<ClockInsight, 'id'>): boolean => insight.id !== SWINGS_OFF_THE_PLAN;

/** Whether any place was tried for the swings a clock moved: without one the range has nothing to draw, and no line */
export const hasShiftPlaces = (options: Pick<ShiftOptionsView, 'rows'>): boolean => options.rows.some(row => row.shifts.length > 0);

type Mark = 'caution' | 'info';

/** The columns of the drop spacing note's table (drop-spacing.ts, dropSpacingTable) that the line reads */
const DROPS = { inserters: 'Inserters', pairs: 'Pairs landing on each other' };

/** Each row of the drop spacing note's table: its inserters ("10 and 14") and how many pairs of their hands land on each other */
function dropRows(insight: ClockInsight): { inserters: number[]; pairs: number }[] {
    const table = insight.table;
    if (table === undefined) return [];
    const inserters = table.columns.indexOf(DROPS.inserters);
    const pairs = table.columns.indexOf(DROPS.pairs);
    if (inserters < 0 || pairs < 0) return [];
    return table.rows.map(row => ({ inserters: (row[inserters].match(/\d+/g) ?? []).map(Number), pairs: Number(row[pairs]) || 0 }));
}

const landOnEachOther = (insight: ClockInsight) => dropRows(insight).some(row => row.pairs > 0);

/**
 * The mark of each kind of note: a caution mark where the note names something the user can do, an information mark where
 * it names nothing. A kind not in the table is information.
 */
const MARKS: Record<string, (insight: ClockInsight) => Mark> = {
    // choose a clock marked Stable, or restart the build by hand after a stop
    'backpressure-loss': () => 'caution',
    // choose another clock, or start the build the way that reached the target (the engine makes it only for a clock that depends on its start)
    'start-dependence': () => 'caution',
    // hands that land on each other: move an inserter or its start tick; hands that fit: nothing
    'drop-spacing': insight => landOnEachOther(insight) ? 'caution' : 'info',
    // nothing on this clock: a clock with fewer wakeups is another clock
    'wake-ups': () => 'info',
    // nothing: the drills' enable windows are made for them
    'chest-drill-windows': () => 'info',
};

export function clockNoteMark(insight: ClockInsight): Mark {
    return MARKS[insight.id]?.(insight) ?? 'info';
}

/**
 * The inserters a note is about, each once, in order: its chips. Only the drop spacing note gives them apart from its
 * sentences, in its table: those whose hands land on each other, or all of them where every hand fits.
 */
export function clockNoteInserters(insight: ClockInsight): number[] {
    if (insight.id !== 'drop-spacing') return [];
    const rows = dropRows(insight);
    const landing = rows.filter(row => row.pairs > 0);
    return [...new Set((landing.length > 0 ? landing : rows).flatMap(row => row.inserters))].sort((a, b) => a - b);
}
