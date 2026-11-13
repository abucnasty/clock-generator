import type { CheckedLanes, ClockInsight, SharedLaneCause } from 'clock-generator/browser';
import type { ClockAlternativeView } from '../worker/types';
import { insightsShown } from './checkedLanes';
import { shownInOverview } from './clockNotes';

/**
 * What the selected clock's workspace shows on its Diagnostics tab, and the card's way to it: every string of it and every
 * rule of what stands where, in one place
 */
export const DIAGNOSTICS_COPY = {
    tab: 'Diagnostics',
    /** The card's link, and the link of the note on why no clock is stable, to the tab */
    see: 'See diagnostics',
    /** The tab of a clock whose copies share no lane: the engine checks no lane of a build of one copy */
    oneCopy: 'A build of one copy shares no lane.',
    /** The tab of a clock of a result kept from before the engine checked the shared lanes */
    keptBefore: 'This clock was made before the lanes its copies share were checked. Generate again to check them.',
    /** Overview's notes of a clock whose only note is on Diagnostics: not "Nothing stands out", which says the clock holds */
    overviewNothing: 'Nothing else stands out. Diagnostics says why this clock is not stable.',
};

/** The note that says why a clock is not stable (the engine's insight `unstable`): on Diagnostics, not in Overview's notes */
const UNSTABLE_NOTE = 'unstable';

/**
 * The notes of a clock, by where they stand: the note on why it is not stable on Diagnostics, every other note in Overview
 * but the one on swings at other ticks than the plan (clockNotes.ts)
 */
export function notesOf(clock: Pick<ClockAlternativeView, 'insights' | 'checkedLanes'>): { diagnostics: ClockInsight | undefined; overview: ClockInsight[] } {
    const shown = insightsShown(clock);
    return { diagnostics: shown.find(insight => insight.id === UNSTABLE_NOTE), overview: shown.filter(insight => insight.id !== UNSTABLE_NOTE && shownInOverview(insight)) };
}

/** What Diagnostics shows of a clock's shared lanes */
type LanesShown =
    | { kind: 'cause'; checked: CheckedLanes & { cause: SharedLaneCause } }
    | { kind: 'line'; checked: CheckedLanes }
    | { kind: 'sentence'; text: string };

export function lanesShownOf(clock: Pick<ClockAlternativeView, 'checkedLanes' | 'copies'>): LanesShown {
    const checked = clock.checkedLanes;
    if (checked?.cause) return { kind: 'cause', checked: { ...checked, cause: checked.cause } };
    if (checked) return { kind: 'line', checked };
    // the engine gives no checked lanes for a build of one copy; for more copies, the clock is of an engine before the check
    return { kind: 'sentence', text: clock.copies <= 1 ? DIAGNOSTICS_COPY.oneCopy : DIAGNOSTICS_COPY.keptBefore };
}

/** Whether the card links to the clock's Diagnostics: a clock with a cause on a shared lane, or with the note on why it is not stable */
export const hasDiagnostics = (clock: Pick<ClockAlternativeView, 'insights' | 'checkedLanes'>): boolean =>
    Boolean(clock.checkedLanes?.cause) || notesOf(clock).diagnostics !== undefined;
