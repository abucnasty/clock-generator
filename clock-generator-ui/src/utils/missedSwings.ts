import type { MissedSwingCause, MissedSwings, SharedLaneCause } from 'clock-generator/browser';
import { formatNumberText } from './numberText';

/**
 * The pictures of the missed swings of a clock that is not stable on a lane its copies share: their words and the marks
 * they draw, from the engine's numbers and codes (`checked_lanes.cause`). The engine gives no sentence for a picture: every
 * word of the pictures is here, with one entry for each code, so that a code with no words fails the build.
 */

const figure = (value: number) => formatNumberText(value);

/** "copy 2", "copies 4 and 8", "copies 1, 2 and 3" */
function copiesText(copies: readonly number[]): string {
    if (copies.length === 1) return `copy ${figure(copies[0])}`;
    return `copies ${listText(copies.map(figure))}`;
}

/** "a", "a and b", "a, b and c" */
function listText(parts: readonly string[]): string {
    if (parts.length < 2) return parts.join('');
    return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
/** A game name inside a sentence: "Iron gear wheel" as "iron gear wheel" */
export const nameInText = (name: string) => name.charAt(0).toLowerCase() + name.slice(1);

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];
const ordinal = (n: number) => ORDINALS[n - 1] ?? `${figure(n)}th`;

/** What stopped the missed swings of a window cycle, in the legend, in a mark's label and in its tooltip */
export const CAUSE_WORDS: Record<MissedSwingCause, { label: string; legend: string; tip: (copyBefore: number) => string }> = {
    gap: { label: 'gap', legend: 'gap only: the lane was empty, the gap the copy before left',
        tip: copyBefore => `The lane was empty in its reach: the gap that copy ${figure(copyBefore)} left.` },
    full: { label: 'full', legend: "full only: its machine's output was full", tip: () => "Its machine's output was full and took no more items." },
    both: { label: 'both', legend: 'both', tip: () => "The lane was empty in its reach, and its machine's output was full." },
    neither: { label: 'unknown', legend: 'unknown', tip: () => 'Unknown.' },
};

/** The order of the legend */
const CAUSE_ORDER: readonly MissedSwingCause[] = ['gap', 'full', 'both', 'neither'];

export const MISSED_SWINGS_COPY = {
    pictureOne: 'Missed swings, copy by copy',
    copy: 'Copy',
    /** The head of the chip of a part copy (5.5 copies): the last, as it stands last from the entry */
    partCopy: (copy: number, narrow: boolean) => narrow ? 'part' : `${figure(copy)} (part)`,
    allCopies: (copies: number) => `All ${figure(copies)} copies`,
    fewerCopies: (copies: number) => `${figure(copies)} ${copies === 1 ? 'copy' : 'copies'}`,
    oneCopyAlone: '1 copy alone',
    entryOfLanes: (items: readonly string[]) => items.length === 0 ? 'Entry' : `Entry of the ${listText(items)} ${items.length === 1 ? 'lane' : 'lanes'}`,
    entry: 'Entry',
    beltFlows: 'belt flows this way',
    entryOfInputLanes: 'In order from the entry of the input lanes',
    spacing: (travel: number, tiles: number, windowCycle: number) => Math.abs(travel - windowCycle) < 1e-9
        ? `Travel between copies: ${figure(travel)} ticks (${figure(tiles)} tiles), one window cycle`
        : `Travel between copies: ${figure(travel)} ticks (${figure(tiles)} tiles); window cycle ${figure(windowCycle)} ticks`,
    unit: (swings: number | null) => swings === null ? 'swings missed' : `swings missed, of ${figure(swings)} each`,
    /** The caption of picture one on a lane loss */
    laneCaption: (missing: readonly number[], fewer: number | null, aloneMisses: number) => {
        const one = missing.length === 1;
        const who = one ? `Only copy ${figure(missing[0])}, the ${ordinal(missing[0])} copy from the entry, misses swings.`
            : `${capitalized(copiesText(missing))}, the ${listText(missing.map(ordinal))} copies from the entry, miss swings.`;
        const alone = aloneMisses === 0;
        const then = fewer !== null && alone ? `With ${figure(fewer)} ${fewer === 1 ? 'copy' : 'copies'}, or with one copy alone, no copy misses one.`
            : fewer !== null ? `With ${figure(fewer)} ${fewer === 1 ? 'copy' : 'copies'}, no copy misses one.`
                : alone ? 'With one copy alone, no copy misses one.' : '';
        return [who, then].filter(Boolean).join(' ');
    },
    /** The caption of picture one at a full join: which copies' output swings are blocked, then the hint for the layout */
    joinCaption: (missing: readonly number[], sideBelt: boolean) => {
        const one = missing.length === 1;
        const which = sideBelt
            ? `The side-loaded ${one ? 'belt' : 'belts'} of ${copiesText(missing)} ${one ? 'is' : 'are'} full where ${one ? 'it joins' : 'they join'} the output belt.`
            : `The output swings of ${copiesText(missing)} are blocked where ${one ? 'it drops' : 'they drop'} onto the output belt.`;
        const hint = sideBelt ? 'Usually the side-loaded belt is too short, or items from an upstream copy are passing on the output belt.'
            : 'Usually items from an upstream copy are passing on the output belt.';
        return `${which} ${hint}`;
    },
    pictureTwo: (windowCycles: number, copies: readonly number[]) => `The ${figure(windowCycles)} window cycles of ${copiesText(copies)}`,
    windowCycle: 'Window cycle',
    inserterRow: (copy: number, inserter: number) => `Copy ${figure(copy)} · inserter ${figure(inserter)}`,
    copyRow: (copy: number) => `Copy ${figure(copy)}`,
    rowMissed: (missed: number, swings: number) => `${figure(missed)} of ${figure(swings)} missed`,
    laneCaptionTwo: 'Each cell is one window cycle. A grey cell is a window cycle with every swing made.',
    joinCaptionTwo: (gives: number) => `Each cell is one window cycle of ${figure(gives)} output swings. A marked cell is a window cycle with fewer.`,
    laneTip: (windowCycle: number, missed: number, swings: number, cause: MissedSwingCause, copyBefore: number) =>
        `Window cycle ${figure(windowCycle)}: ${figure(missed)} of its ${figure(swings)} ${swings === 1 ? 'swing' : 'swings'} missed. ${CAUSE_WORDS[cause].tip(copyBefore)}`,
    joinTip: (windowCycle: number, made: number, gives: number) => `Window cycle ${figure(windowCycle)}: ${figure(made)} of its ${figure(gives)} swings made.`,
    joinLegend: 'fewer output swings made',
    joinLabel: 'fewer',
    legendCount: (words: string, count: number) => `${words} (${figure(count)})`,
    /** The line that names another clock of the build that holds with all the copies, in two parts around its name */
    otherClock: (kind: SharedLaneCause['kind'], copies: number) => kind === 'join'
        ? 'Another clock of this build has no full join: ' : `Another clock of this build holds with all ${figure(copies)}: `,
    otherClockAfter: (windowCycleTicks: number) => `, window cycle ${figure(windowCycleTicks)} ticks.`,
    readAsText: 'Read this as text',
};

/** One chip of picture one: the swings a copy misses; null where the copy is not on the lanes in that run */
interface ChipRow {
    label: string;
    values: (number | null)[];
}

/**
 * The rows of picture one: the swings each copy misses with all the copies (the headline); with the most copies whose run
 * holds (`changes.data.fewer_copies`), every chip zero and the copies taken off absent; and with one copy alone.
 * A part copy (5.5 copies) has a chip of its own, the last.
 */
export function chipRowsOf(cause: SharedLaneCause, copies: number): ChipRow[] {
    const all = Array.from({ length: Math.ceil(copies) }, (_, index) => cause.headline.data.copies.find(it => it.copy === index + 1)?.missed ?? 0);
    const rows: ChipRow[] = [{ label: MISSED_SWINGS_COPY.allCopies(copies), values: all }];
    const fewer = cause.changes?.data.fewer_copies ?? null;
    if (fewer !== null && fewer > 1 && fewer < copies) {
        rows.push({ label: MISSED_SWINGS_COPY.fewerCopies(fewer), values: all.map((_, index) => index < fewer ? 0 : null) });
    }
    rows.push({ label: MISSED_SWINGS_COPY.oneCopyAlone, values: all.map((_, index) => index === 0 ? cause.alone.data.missed : null) });
    return rows;
}

/** The swings each copy of the headline makes in the span, where every copy makes the same; else null */
export function swingsEachOf(cause: SharedLaneCause): number | null {
    const swings = cause.headline.data.copies.map(it => it.swings);
    return swings.every(it => it === swings[0]) ? swings[0] : null;
}

/** One mark of picture two: a window cycle, from 1, with what is drawn and its tooltip */
export interface StripMark {
    windowCycle: number;
    kind: MissedSwingCause | 'fewer';
    /** The swings missed in the window cycle */
    missed: number;
    tip: string;
}

/** One row of picture two */
export interface StripRow {
    key: string;
    label: string;
    sub: string[];
    windowCycles: number;
    marks: StripMark[];
}

/** The swings of an inserter row in window cycle `windowCycle` (from 1) of the run of one copy alone */
const aloneIn = (perWindowCycle: number | number[], windowCycle: number) => typeof perWindowCycle === 'number' ? perWindowCycle : perWindowCycle[windowCycle - 1] ?? 0;

/**
 * The rows of picture two: one cell for each window cycle of the span (the cell layout in one place). On a lane loss a row
 * for each inserter of each copy that misses, marked where it made fewer swings than alone, by what stopped them; at a full
 * join a row for each copy that misses, marked where it made fewer output swings than the clock gives it.
 */
export function stripRowsOf(swings: MissedSwings, itemLabel: (id: string) => string): StripRow[] {
    if (swings.kind === 'lane') {
        return swings.rows.map(row => {
            const total = Array.from({ length: row.window_cycles }, (_, i) => aloneIn(row.swings_per_window_cycle, i + 1)).reduce((sum, it) => sum + it, 0);
            const missed = row.missed.reduce((sum, it) => sum + it.missed, 0);
            return {
                key: `${row.copy}-${row.inserter_id}`, label: MISSED_SWINGS_COPY.inserterRow(row.copy, row.inserter_id),
                sub: [listText(row.items.map(item => nameInText(itemLabel(item)))), MISSED_SWINGS_COPY.rowMissed(missed, total)], windowCycles: row.window_cycles,
                marks: row.missed.map(it => ({ windowCycle: it.window_cycle, kind: it.cause, missed: it.missed,
                    tip: MISSED_SWINGS_COPY.laneTip(it.window_cycle, it.missed, aloneIn(row.swings_per_window_cycle, it.window_cycle), it.cause, row.copy - 1) })),
            };
        });
    }
    return swings.copies.map(copy => {
        const given = Math.round(copy.gives * copy.window_cycles);
        const made = copy.made.reduce((sum, it) => sum + it, 0);
        return {
            key: `${copy.copy}`, label: MISSED_SWINGS_COPY.copyRow(copy.copy), sub: [MISSED_SWINGS_COPY.rowMissed(Math.max(0, given - made), given)],
            windowCycles: copy.window_cycles,
            marks: copy.made.flatMap((it, index) => it < copy.gives ? [{ windowCycle: index + 1, kind: 'fewer' as const, missed: copy.gives - it, tip: MISSED_SWINGS_COPY.joinTip(index + 1, it, copy.gives) }] : []),
        };
    });
}

/** The legend of picture two: each kind of mark it draws, with the swings it counts */
export function legendOf(swings: MissedSwings): { kind: MissedSwingCause | 'fewer'; text: string }[] {
    if (swings.kind === 'join') {
        const missed = swings.copies.reduce((sum, copy) => sum + copy.made.reduce((s, it) => s + Math.max(0, copy.gives - it), 0), 0);
        return [{ kind: 'fewer', text: MISSED_SWINGS_COPY.legendCount(MISSED_SWINGS_COPY.joinLegend, missed) }];
    }
    const counts = new Map<MissedSwingCause, number>();
    for (const row of swings.rows) for (const it of row.missed) counts.set(it.cause, (counts.get(it.cause) ?? 0) + it.missed);
    return CAUSE_ORDER.filter(kind => (counts.get(kind) ?? 0) > 0).map(kind => ({ kind, text: MISSED_SWINGS_COPY.legendCount(CAUSE_WORDS[kind].legend, counts.get(kind)!) }));
}

/** The engine's sentences of a text, one by one */
const sentencesOf = (text: string) => text.split(/(?<=[.!?])\s+(?=[A-Z])/).filter(Boolean);

/** "What changes it" without the sentence that names another clock, which the page shows as its own line */
const fewerCopiesText = (cause: SharedLaneCause) => cause.changes === null ? ''
    : sentencesOf(cause.changes.text).filter(it => !it.startsWith('Another clock of this build')).join(' ');

/**
 * What each picture stands for, for a screen reader: the sentences of the cause the page no longer shows as text beside
 * the pictures (the engine's words)
 */
export function pictureLabelsOf(cause: SharedLaneCause): { one: string; two: string } {
    const headline = `${cause.headline.text}.`;
    const one = cause.kind === 'join'
        ? [headline, cause.cause?.text, cause.alone.text, fewerCopiesText(cause)]
        : [headline, cause.spacing?.text, cause.alone.text, fewerCopiesText(cause)];
    const two = cause.kind === 'join' ? [cause.where.text] : [cause.cause?.text, cause.where.text];
    return { one: one.filter(Boolean).join(' '), two: two.filter(Boolean).join(' ') };
}

/**
 * The engine's sentences behind "Read this as text", in the page's order, without the two that stand just above it: at a full
 * join, the side belts that are full (picture one's caption); and the other clock of the build (its own line)
 */
export function textPartsOf(cause: SharedLaneCause): string[] {
    return [cause.kind === 'join' ? undefined : cause.cause?.text, cause.spacing?.text, cause.where.text, cause.alone.text, fewerCopiesText(cause)]
        .filter((it): it is string => Boolean(it));
}
