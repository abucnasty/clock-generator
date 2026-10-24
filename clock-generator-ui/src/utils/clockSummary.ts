import type { ClockAlternativeView } from '../worker/types';
import { formatNumberText } from './numberText';
import { lossesOf, notTriedOf } from './rateWarning';
import type { PickRule } from './recommendedClock';

/** The fields of a clock its summary is worked out from, so the tests need not build a whole view */
export type SummaryClock = Pick<ClockAlternativeView, 'id' | 'label' | 'verdict' | 'ranking' | 'beltLabel' | 'deadlockRisk' | 'assessment' | 'deciders'>;

/**
 * The smallest distance from the target rate that names a clock by its rate, as the Copy button's "below target"
 * (1.14): less than this prints as the target itself at two decimals.
 */
const MIN_OFF_TARGET = 0.005;

/** Every player-facing string of the clock summary, in one place for the glossary and for review */
export const SUMMARY_COPY = {
    // plain names: what a clock is for, against the others of the same generation
    offTarget: (rate: string, target: string) => `Runs at ${rate}/s, not ${target}/s`,
    noRecovery: 'Does not recover when jammed or starved',
    recoveryUnavailable: 'Recovery unavailable',
    unstable: 'Does not hold its rate',
    startDependent: 'Depends on how it is started',
    backedUpBelts: 'For backed-up belts',
    fewestWakeUps: 'Fewest wake-ups',
    fewestDeciders: 'Fewest deciders',
    fewestWakeWindows: 'Fewest wake windows',
    another: (rate: string) => `Another way to make ${rate}/s`,
    // the card's tiles
    makes: (rate: string) => `${rate}/s`,
    allCopies: (copies: number) => `all ${copies} copies`,
    wakeUps: (perMinute: number) => `${perMinute} a minute`,
    wakeUpsNotCounted: 'Not counted',
    oneCopy: 'one copy',
    recoversYes: 'Yes',
    recoversNo: 'No',
    recoversNotTested: 'Not tested',
    recoversUnavailable: 'Unavailable',
    recoversYesDetail: 'In the simulator, it gets back to its rate by itself after it is starved or jammed.',
    recoversNoDetail: (losses: string, notTried = '') => losses
        ? `In the simulator, after ${losses} for a while, it does not get back to its rate by itself.${notTried}`
        : 'In the simulator, after it is starved or jammed, it does not get back to its rate by itself.',
    recoversNotTestedDetail: 'No usable recovery result is available for this clock.',
    recoversNotTriedDetail: (reason: string) => `Recovery could not be tried in the simulator: ${reason.replace(/\.$/, '')}.`,
    recoversBaselineUnavailableDetail: 'Recovery is unavailable: the undisturbed baseline for the loss trials did not hold its expected output.',
    recoversLossLimit: (duration: string, item: string) =>
        `Checked for losses up to ${duration}. A longer loss spoils the ${item} in the build, and no clock brings it back.`,
    beltMoving: 'Moving',
    beltBackedUp: 'Backed up',
    beltNone: 'None',
    beltNoneSub: 'no inserter picks up from a belt',
    beltCellMoving: (slack: string) => `Moving (${slack} belt slack)`,
    beltLineMoving: 'Made for moving belts.',
    beltLineBackedUp: 'Made for backed-up belts.',
    beltLineNone: 'No inserter on the clock picks up from a belt.',
    // how a selected clock differs from the recommended one
    differsRate: (rate: string, target: string) => `This one makes ${rate}/s, not ${target}/s.`,
    differsMoreWakeUps: (n: number) => `It wakes inserters ${n} more ${n === 1 ? 'time' : 'times'} a minute than the recommended clock.`,
    differsFewerWakeUps: (n: number) => `It wakes inserters ${n} fewer ${n === 1 ? 'time' : 'times'} a minute than the recommended clock.`,
    differsBelt: 'It is made for backed-up belts.',
    differsNoRecovery: 'It does not recover after it is starved or jammed.',
    differsUnstable: 'It does not hold its rate.',
    differsNothing: 'It is not the recommended clock.',
    // the compare table
    foldedMakes: (count: number, rate: string) => `All ${count} clocks make ${rate}/s.`,
    worksYes: 'Yes',
    worksBackedUpBelts: 'Designed for backed-up supply',
    worksOffTarget: (rate: string) => `Misses the rate (${rate}/s)`,
    worksNoRecovery: 'Does not recover',
    worksUnstable: 'Unstable',
    worksStartDependent: 'Start-dependent',
};

export const isStartDependent = (clock: Pick<SummaryClock, 'assessment'>): boolean =>
    clock.assessment.start_dependence?.verdict === 'start-dependent';

/** A rate as the summary prints it: at most two decimals ("240", "12.5") */
const rateText = (rate: number) => formatNumberText(rate);

/** The rate a clock was made for: its own rate less how far it is off the target */
const targetOf = (clock: Pick<SummaryClock, 'ranking' | 'assessment'>) =>
    clock.assessment.items_per_second - clock.ranking.rate_off_target;

const isOffTarget = (clock: Pick<SummaryClock, 'ranking'>) => Math.abs(clock.ranking.rate_off_target) >= MIN_OFF_TARGET;

/** Wake-ups as the selection compares them: to a thousandth */
const wakeUpsKey = (wakeUps: number | null) => wakeUps === null ? null : Math.round(wakeUps * 1000);

/** A clock the plain names compare: it meets the target rate (by the selection's rule) and is made for the belt asked for */
const isContender = (clock: SummaryClock) => clock.ranking.meets_target_rate && clock.ranking.matches_belt_choice;

/**
 * The name of a clock by what it is for, against the other clocks of its generation ("Fewest wake-ups"). The first
 * rule that matches wins: a clock off the target rate is named by its rate; one that does not recover, or does not hold
 * its rate, by that; one for backed-up belts (when the build asked for moving ones) by its belt; among the
 * others, the one with the fewest wake-ups, else the fewest deciders, else the fewest wake windows; any other by the rate it makes. Tied clocks
 * share a name; the engine's name under it tells them apart. The target is each clock's own, so an edit to the build
 * since never renames a clock.
 */
export function plainClockName(clocks: SummaryClock[], index: number): string {
    const clock = clocks[index];
    if (!clock) {
        return '';
    }
    if (isStartDependent(clock)) return SUMMARY_COPY.startDependent;
    if (isOffTarget(clock)) {
        return SUMMARY_COPY.offTarget(rateText(clock.assessment.items_per_second), rateText(targetOf(clock)));
    }
    // on a build with a deadlock risk the recovery trials do not decide, so a clock that holds the rate is named by its trade-off
    const verdictDecides = clock.deadlockRisk === null || !clock.ranking.meets_target_rate;
    if (verdictDecides && clock.verdict === 'no recovery') {
        return recoversOf(clock).kind === 'no' ? SUMMARY_COPY.noRecovery : SUMMARY_COPY.recoveryUnavailable;
    }
    if (clock.verdict === 'unstable') {
        return SUMMARY_COPY.unstable;
    }
    if (!clock.ranking.matches_belt_choice) {
        return SUMMARY_COPY.backedUpBelts;
    }
    if (isContender(clock)) {
        const contenders = clocks.filter(isContender);
        const wakeUps = wakeUpsKey(clock.ranking.wake_ups_per_minute);
        const counted = contenders.map(it => wakeUpsKey(it.ranking.wake_ups_per_minute)).filter(it => it !== null);
        if (wakeUps !== null && wakeUps === Math.min(...counted)) {
            return SUMMARY_COPY.fewestWakeUps;
        }
        // the fewest decider combinators of clocks that do not all have the same number
        const deciders = contenders.map(it => it.deciders);
        if (clock.deciders === Math.min(...deciders) && Math.min(...deciders) < Math.max(...deciders)) {
            return SUMMARY_COPY.fewestDeciders;
        }
        if (clock.ranking.window_count === Math.min(...contenders.map(it => it.ranking.window_count))) {
            return SUMMARY_COPY.fewestWakeWindows;
        }
    }
    return SUMMARY_COPY.another(rateText(clock.assessment.items_per_second));
}

/** The engine's own name for a clock, which says how it is made; the card and the table say it the same way */
export function clockTechnicalName(clock: Pick<SummaryClock, 'label'>): string {
    return clock.label;
}

/** Whether the build gets back to its rate by itself after it is starved or jammed: a word, an icon's kind and a sentence */
export function recoversOf(clock: Pick<SummaryClock, 'verdict' | 'assessment'>): {
    kind: 'yes' | 'no' | 'not-tested';
    value: string;
    detail: string;
} {
    const loss = clock.assessment.backpressure_loss;
    if (loss?.survives === true) return { kind: 'yes', value: SUMMARY_COPY.recoversYes, detail: SUMMARY_COPY.recoversYesDetail };
    if (loss?.survives === false && loss.broken_by.length > 0) return { kind: 'no', value: SUMMARY_COPY.recoversNo, detail: SUMMARY_COPY.recoversNoDetail(lossesOf(clock), notTriedOf(clock)) };
    if (loss?.survives === false) return { kind: 'not-tested', value: SUMMARY_COPY.recoversUnavailable, detail: SUMMARY_COPY.recoversBaselineUnavailableDetail };
    const notTried = clock.assessment.backpressure_loss_not_tried;
    return { kind: 'not-tested', value: clock.assessment.holds ? SUMMARY_COPY.recoversUnavailable : SUMMARY_COPY.recoversNotTested,
        detail: notTried !== undefined ? SUMMARY_COPY.recoversNotTriedDetail(notTried) : SUMMARY_COPY.recoversNotTestedDetail };
}

/** A stretch of time as the loss limit says it: "3 min 45 s", "3 min", "45 s" */
export function minutesAndSecondsText(ticks: number): string {
    const seconds = Math.round(ticks / 6) / 10;
    const minutes = Math.floor(seconds / 60);
    const rest = seconds - minutes * 60;
    if (minutes === 0) return `${formatNumberText(rest)} s`;
    return rest === 0 ? `${minutes} min` : `${minutes} min ${formatNumberText(rest)} s`;
}

/**
 * For a build whose items spoil, the losses its clocks were checked for, in a sentence ("Checked for losses up to 45 s. A
 * longer loss spoils the iron bacteria in the build, …"); null for any other build, or a clock whose losses were not tried
 */
export function lossLimitText(clock: Pick<SummaryClock, 'assessment'>, itemLabel: (id: string) => string): string | null {
    const limit = clock.assessment.backpressure_loss?.loss_limit;
    if (!limit) return null;
    const name = itemLabel(limit.item);
    return SUMMARY_COPY.recoversLossLimit(minutesAndSecondsText(limit.ticks), name.charAt(0).toLowerCase() + name.slice(1));
}

/** What the clock makes, for all the copies, and the line under it: "240/s", "all 11 copies" (nothing for one copy) */
export function makesText(clock: Pick<SummaryClock, 'assessment'>, copies: number): { value: string; sub: string } {
    return {
        value: SUMMARY_COPY.makes(rateText(clock.assessment.items_per_second)),
        sub: copies !== 1 ? SUMMARY_COPY.allCopies(copies) : '',
    };
}

/** The wake-ups of one copy, rounded as the table rounds them: "18 a minute", "one copy"; or "Not counted" */
export function wakeUpsText(clock: Pick<SummaryClock, 'assessment'>): { value: string; sub: string } {
    const perMinute = clock.assessment.wake_ups_per_minute;
    return perMinute === null
        ? { value: SUMMARY_COPY.wakeUpsNotCounted, sub: '' }
        : { value: SUMMARY_COPY.wakeUps(Math.round(perMinute)), sub: SUMMARY_COPY.oneCopy };
}

type BeltKind = 'moving' | 'backed_up' | 'none';

function beltKindOf(rule: PickRule | null, beltLabel: string): BeltKind {
    if (beltLabel === '') {
        return 'none';
    }
    return !rule?.backedUpBelts && beltLabel.startsWith('moving') ? 'moving' : 'backed_up';
}

/** The Belt pickups tile's word: "Moving", "Backed up", or "None" when no clocked inserter picks up from a belt */
export function beltValue(rule: PickRule | null, beltLabel: string): string {
    return { moving: SUMMARY_COPY.beltMoving, backed_up: SUMMARY_COPY.beltBackedUp, none: SUMMARY_COPY.beltNone }[beltKindOf(rule, beltLabel)];
}

/** The line under the Belt pickups tile's word when there is none: what "None" means; undefined otherwise */
export function beltValueSub(rule: PickRule | null, beltLabel: string): string | undefined {
    return beltKindOf(rule, beltLabel) === 'none' ? SUMMARY_COPY.beltNoneSub : undefined;
}

/**
 * The full clock table's Belt cell in the belt question's words: "Moving (+4 ticks belt slack)", "Backed up", or
 * nothing when no clocked inserter picks up from a belt. The engine's label is "moving (+4 ticks)" or "backed-up".
 */
export function beltCellText(beltLabel: string): string {
    if (beltLabel === '') {
        return '';
    }
    const slack = /^moving \((.+)\)$/.exec(beltLabel);
    return slack ? SUMMARY_COPY.beltCellMoving(slack[1]) : beltLabel.startsWith('moving') ? SUMMARY_COPY.beltMoving : SUMMARY_COPY.beltBackedUp;
}

/** The sentence under the tiles about the belt the clock is made for (2.4 may change its words, not its place) */
export function beltLine(rule: PickRule | null, beltLabel: string): string {
    return { moving: SUMMARY_COPY.beltLineMoving, backed_up: SUMMARY_COPY.beltLineBackedUp, none: SUMMARY_COPY.beltLineNone }[beltKindOf(rule, beltLabel)];
}

/**
 * What sets a selected clock apart from the recommended one, in at most two sentences: its rate, its wake-ups (when
 * both were counted), its belt, then whether it recovers.
 */
export function differenceFromRecommended(selected: SummaryClock, recommended: SummaryClock): string {
    const sentences: string[] = [];
    if (isStartDependent(selected)) sentences.push('It depends on how it is started.');
    if (isOffTarget(selected)) {
        sentences.push(SUMMARY_COPY.differsRate(rateText(selected.assessment.items_per_second), rateText(targetOf(selected))));
    }
    const mine = selected.assessment.wake_ups_per_minute;
    const theirs = recommended.assessment.wake_ups_per_minute;
    if (mine !== null && theirs !== null) {
        const more = Math.round(mine) - Math.round(theirs);
        if (more > 0) {
            sentences.push(SUMMARY_COPY.differsMoreWakeUps(more));
        } else if (more < 0) {
            sentences.push(SUMMARY_COPY.differsFewerWakeUps(-more));
        }
    }
    if (!selected.ranking.matches_belt_choice && recommended.ranking.matches_belt_choice) {
        sentences.push(SUMMARY_COPY.differsBelt);
    }
    const selectedRecovery = recoversOf(selected);
    const recommendedRecovery = recoversOf(recommended);
    if (selectedRecovery.kind === 'no' && recommendedRecovery.kind !== 'no') {
        sentences.push(SUMMARY_COPY.differsNoRecovery);
    } else if (selectedRecovery.kind === 'not-tested' && selected.assessment.holds && recommendedRecovery.kind !== 'not-tested') {
        sentences.push('Recovery results are unavailable for this clock.');
    } else if (!selected.assessment.holds && recommended.assessment.holds) {
        sentences.push(SUMMARY_COPY.differsUnstable);
    }
    return sentences.length === 0 ? SUMMARY_COPY.differsNothing : sentences.slice(0, 2).join(' ');
}

/** Fewer rows than this keep the Makes column: one or two rows read as easily as a sentence */
const FOLD_MIN_ROWS = 3;

/**
 * "All 5 clocks make 240/s." when 3 or more clocks shown make the same rate at two decimals, so the compare table can
 * leave out a column that says the same on every row; null when they differ, or there are too few to fold.
 */
export function foldedMakes(clocks: Pick<SummaryClock, 'assessment'>[]): string | null {
    if (clocks.length < FOLD_MIN_ROWS) {
        return null;
    }
    const rates = new Set(clocks.map(clock => clock.assessment.items_per_second.toFixed(2)));
    return rates.size === 1 ? SUMMARY_COPY.foldedMakes(clocks.length, rateText(clocks[0].assessment.items_per_second)) : null;
}

/**
 * The compare table's "Works?": "Yes" for a clock that holds the rate and recovers, made for the belt asked for;
 * otherwise what is wrong, the worst first: that it does not hold its rate (the word of the group it is listed under;
 * its rate is in its name and in Makes), the rate it misses, that it needs a restart after a jam, or that it is only for
 * backed-up belts. `kind` picks the icon; the words say it without the colour.
 */
export function worksOf(clock: Pick<SummaryClock, 'verdict' | 'ranking' | 'assessment'>): { kind: 'yes' | 'caution' | 'no'; text: string } {
    if (isStartDependent(clock)) return { kind: 'caution', text: SUMMARY_COPY.worksStartDependent };
    if (clock.verdict === 'unstable') {
        return { kind: 'no', text: SUMMARY_COPY.worksUnstable };
    }
    if (isOffTarget(clock)) {
        return { kind: 'no', text: SUMMARY_COPY.worksOffTarget(rateText(clock.assessment.items_per_second)) };
    }
    if (clock.verdict === 'no recovery') {
        return { kind: 'caution', text: recoversOf(clock).kind === 'no' ? SUMMARY_COPY.worksNoRecovery : SUMMARY_COPY.recoveryUnavailable };
    }
    if (!clock.ranking.matches_belt_choice) {
        return { kind: 'caution', text: SUMMARY_COPY.worksBackedUpBelts };
    }
    return recoversOf(clock).kind === 'not-tested'
        ? { kind: 'caution', text: SUMMARY_COPY.recoveryUnavailable }
        : { kind: 'yes', text: SUMMARY_COPY.worksYes };
}
