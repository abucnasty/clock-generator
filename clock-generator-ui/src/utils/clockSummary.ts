import type { SharedLaneReasonCode } from 'clock-generator/browser';
import type { ClockAlternativeView } from '../worker/types';
import { formatNumberText } from './numberText';
import { lossesOf, notTriedOf } from './rateWarning';
import { fewestDecidersReason, recommendedIndexOf } from './recommendedClock';
import { rateVerbs, type TargetCounts } from './targetCounts';

/** The fields of a clock its summary is worked out from, so the tests need not build a whole view */
export type SummaryClock = Pick<ClockAlternativeView, 'id' | 'label' | 'verdict' | 'ranking' | 'beltLabel' | 'deadlockRisk' | 'assessment' | 'deciders'>
    & Partial<Pick<ClockAlternativeView, 'strategy' | 'roundedWindowCycleTicks' | 'roundedRunsFast' | 'checkedLanes' | 'asBuilt' | 'expectedOutputItems'>>
    & { counts?: TargetCounts };

/**
 * The smallest distance from the target rate that names a clock by its rate, as the Copy button's "below target"
 * (1.14): less than this prints as the target itself at two decimals.
 */
const MIN_OFF_TARGET = 0.005;

/** Every player-facing string of the clock summary, in one place for the glossary and for review */
export const SUMMARY_COPY = {
    // the chips beside a clock's name: its status, and what it has fewest of
    recoveryUnavailable: 'Recovery unavailable',
    // what a clock makes against the setpoint (outputTermOf), and the rate beside it
    stable: 'Stable',
    underproduces: 'Underproduces',
    overproduces: 'Overproduces',
    makesOf: (rate: string, target: string, counts?: TargetCounts) => `${rateVerbs(counts).third} ${rate}/s of ${target}/s`,
    startDependent: 'Depends on how it is started',
    fewestWakeUps: 'Fewest wakeups',
    fewestDeciders: 'Fewest deciders',
    // the card's tiles
    makes: (rate: string) => `${rate}/s`,
    allCopies: (copies: number) => `all ${copies} copies`,
    wakeUps: (perMinute: number) => `${perMinute} a minute`,
    wakeUpsNotCounted: 'Not counted',
    oneCopy: 'one copy',
    // on a build with a loop of machines, whose wake-ups depend on where its clock is when the build starts, a clock's figure is their average
    wakeUpsAverage: (starts: number) => `average of ${starts} start points`,
    wakeUpsColdStart: (perMinute: number) => `${perMinute} from a cold start`,
    recoversYes: 'Yes',
    recoversNo: 'No',
    recoversNotTested: 'Not tested',
    recoversUnavailable: 'Unavailable',
    recoversYesDetail: 'In the simulator, it goes back to its rate by itself after a supply stop or an output blockage.',
    recoversNoDetail: (losses: string, notTried = '') => losses
        ? `In the simulator, after ${losses} for a while, it does not go back to its rate by itself.${notTried}`
        : 'In the simulator, after a supply stop or an output blockage, it does not go back to its rate by itself.',
    recoversNotTestedDetail: 'No usable recovery result is available for this clock.',
    recoversNotTriedDetail: (reason: string) => `Recovery could not be tried in the simulator: ${reason.replace(/\.$/, '')}.`,
    recoversBaselineUnavailableDetail: 'Recovery is unavailable: the undisturbed baseline for the loss trials did not hold its expected output.',
    recoversLossLimit: (duration: string, item: string) =>
        `Checked for losses up to ${duration}. A longer loss spoils the ${item} in the build, and no clock brings it back.`,
    beltMoving: 'Moving',
    beltBackedUp: 'Backed up',
    beltNone: 'None',
    beltNoneSub: 'no inserter picks up from a belt',
    beltLineMoving: 'Made for moving belts.',
    beltLineBackedUp: 'Made for backed-up belts.',
    beltLineNone: 'No inserter on the clock picks up from a belt.',
    // how a selected clock differs from the recommended one
    differsRate: (rate: string, target: string, counts?: TargetCounts) => `This one ${rateVerbs(counts).third} ${rate}/s, not ${target}/s.`,
    differsMoreWakeUps: (n: number) => `It wakes inserters ${n} more ${n === 1 ? 'time' : 'times'} a minute than the recommended clock.`,
    differsFewerWakeUps: (n: number) => `It wakes inserters ${n} fewer ${n === 1 ? 'time' : 'times'} a minute than the recommended clock.`,
    differsNoRecovery: 'It does not go back to its rate after a supply stop or an output blockage.',
    differsUnderproduces: 'It underproduces.',
    differsOverproduces: 'It overproduces.',
    differsNothing: 'It is not the recommended clock.',
    // the compare table
    foldedMakes: (count: number, rate: string, counts?: TargetCounts) => `All ${count} clocks ${rateVerbs(counts).base} ${rate}/s.`,
    worksYes: 'Yes',
    worksNoRecovery: 'No recovery',
    worksStartDependent: 'Start-dependent',
};

/**
 * The words beside the term Underproduces for each reason code the engine gives (`checked_lanes.cause.reason.code`):
 * one entry for every code, so that the build fails on a code with no words
 */
export const REASON_WORDS: Record<SharedLaneReasonCode, string> = {
    belt_gaps: 'Missed pickups due to belt gaps',
    target_full: 'Output swings blocked: target full',
    // no words: the chip stands alone
    unknown: '',
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

/** A clock the chips compare: it meets the target rate (by the selection's rule) */
const isContender = (clock: SummaryClock) => clock.ranking.meets_target_rate;

/** What a clock makes against the setpoint, in one word, and what is said beside it */
interface OutputTerm {
    term: typeof SUMMARY_COPY.stable | typeof SUMMARY_COPY.underproduces | typeof SUMMARY_COPY.overproduces;
    /** "makes 180/s of 240/s" off the setpoint; the words for the engine's reason code on a shared-lane loss, where it gives one */
    detail?: string;
}

/**
 * What a clock makes against the setpoint: the term every place that says a clock's status reads (the chip, the compare
 * table's Works?, the full table's status, how a selected clock differs). A rounded clock the engine accepts as meeting
 * the target (`ranking.runs_fast`: at most 0.1% over it) is Stable. Off the setpoint, by its steady run's rate:
 * below, Underproduces; above, Overproduces; with the rate beside it. At the setpoint, a clock that is not unstable is
 * Stable; an unstable one with a loss on a lane its copies share Underproduces, with the words for the engine's reason;
 * any other unstable one by its judged output against the expected output: above, Overproduces; else Underproduces.
 */
export function outputTermOf(clock: Pick<SummaryClock, 'verdict' | 'ranking' | 'assessment' | 'checkedLanes' | 'asBuilt' | 'expectedOutputItems' | 'counts'>): OutputTerm {
    if (clock.ranking.meets_target_rate && clock.ranking.runs_fast !== undefined) return { term: SUMMARY_COPY.stable };
    if (isOffTarget(clock)) {
        return { term: clock.ranking.rate_off_target < 0 ? SUMMARY_COPY.underproduces : SUMMARY_COPY.overproduces,
            detail: SUMMARY_COPY.makesOf(rateText(clock.assessment.items_per_second), rateText(targetOf(clock)), clock.counts) };
    }
    if (clock.verdict !== 'unstable') return { term: SUMMARY_COPY.stable };
    if ((clock.assessment.shared_lane_losses?.length ?? 0) > 0) {
        const code = clock.checkedLanes?.cause?.reason?.code;
        return { term: SUMMARY_COPY.underproduces, ...(code !== undefined && { detail: REASON_WORDS[code] }) };
    }
    const judged = clock.asBuilt?.actual_output_items;
    const above = judged !== undefined && clock.expectedOutputItems !== undefined && judged > clock.expectedOutputItems;
    return { term: above ? SUMMARY_COPY.overproduces : SUMMARY_COPY.underproduces };
}

/**
 * The result of a swing count the back-off tried: "Holds the rate"; else by its actual output against the expected
 * output, above it Overproduces, otherwise Underproduces
 */
export function attemptResultOf(attempt: { holds: boolean; actual_output_items: number; expected_output_items: number }): string {
    if (attempt.holds) return 'Holds the rate';
    return attempt.actual_output_items > attempt.expected_output_items ? SUMMARY_COPY.overproduces : SUMMARY_COPY.underproduces;
}

/** A chip beside a clock's name: its status, or what it has fewest of */
export interface ClockBadge {
    kind: 'status' | 'fewest-wakeups' | 'fewest-deciders';
    text: string;
    /** Beside Underproduces or Overproduces: the rate, or the words for the engine's reason code (outputTermOf) */
    detail?: string;
}

/**
 * The status chip of a clock, the first that matches: it depends on how it is started; it underproduces or overproduces
 * (outputTermOf, with what is said beside it); it has no recovery; else it is Stable. Null for a clock that meets the
 * target on a build with a deadlock risk.
 */
function statusOf(clock: SummaryClock): Omit<ClockBadge, 'kind'> | null {
    if (isStartDependent(clock)) return { text: SUMMARY_COPY.startDependent };
    const output = outputTermOf(clock);
    if (output.term !== SUMMARY_COPY.stable) return { text: output.term, ...(output.detail !== undefined && { detail: output.detail }) };
    // on a build with a deadlock risk the recovery trials do not decide, so a clock that meets the target rate has no status chip
    if (clock.deadlockRisk !== null && clock.ranking.meets_target_rate) return null;
    if (clock.verdict === 'no recovery') {
        return { text: recoversOf(clock).kind === 'no' ? SUMMARY_COPY.worksNoRecovery : SUMMARY_COPY.recoveryUnavailable };
    }
    return { text: SUMMARY_COPY.stable };
}

/**
 * The chips beside the name of a clock, against the other clocks of its generation. Its status chip first, where it has one;
 * a clock that is not Stable has only that. Beside Stable, or no status chip: "Fewest wakeups" on a clock that ties the fewest
 * without being the recommended one (the recommended clock has its own chip and reason), and "Fewest deciders" on a clock with
 * fewer deciders than the recommended clock and the fewest-wakeups clocks have, when the clocks do not all have the same number.
 */
export function clockBadges(clocks: SummaryClock[], index: number): ClockBadge[] {
    const clock = clocks[index];
    if (!clock) {
        return [];
    }
    const status = statusOf(clock);
    if (status !== null && status.text !== SUMMARY_COPY.stable) return [{ kind: 'status', ...status }];
    const badges: ClockBadge[] = status === null ? [] : [{ kind: 'status', ...status }];
    if (!isContender(clock)) return badges;
    const recommended = recommendedIndexOf(clocks);
    const contenders = clocks.filter(isContender);
    const wakeUps = wakeUpsKey(clock.ranking.wake_ups_per_minute);
    const counted = contenders.map(it => wakeUpsKey(it.ranking.wake_ups_per_minute)).filter(it => it !== null);
    const fewestWakeUps = Math.min(...counted);
    if (wakeUps !== null && wakeUps === fewestWakeUps && index !== recommended) {
        badges.push({ kind: 'fewest-wakeups', text: SUMMARY_COPY.fewestWakeUps });
    }
    // the fewest decider combinators of clocks that do not all have the same number, and fewer than the clocks with the
    // fewest wakeups and the recommended one have: a clock that only ties them has no chip for it
    const deciders = contenders.map(it => it.deciders);
    const fewest = Math.min(...deciders);
    if (clock.deciders === fewest && fewest < Math.max(...deciders)) {
        const toBeat = clocks.filter((it, at) => at === recommended || (isContender(it) && wakeUpsKey(it.ranking.wake_ups_per_minute) === fewestWakeUps));
        if (toBeat.every(it => fewest < it.deciders)) {
            badges.push({ kind: 'fewest-deciders', text: SUMMARY_COPY.fewestDeciders });
        }
    }
    return badges;
}

/**
 * What the chip Fewest deciders means, for a clock that has it: it is the one with the least wiring to do by hand.
 * Empty for any other clock (the pick's own reason says what Fewest wakeups means).
 */
export function pickNameMeaning(clocks: SummaryClock[], index: number): string {
    return clockBadges(clocks, index).some(badge => badge.kind === 'fewest-deciders') ? fewestDecidersReason(clocks[index]) : '';
}

/** Whether the build goes back to its rate by itself after a supply stop or an output blockage: a word, an icon's kind and a sentence */
export function recoversOf(clock: Pick<SummaryClock, 'verdict' | 'assessment'>): {
    kind: 'yes' | 'no' | 'not-tested';
    value: string;
    detail: string;
} {
    const loss = clock.assessment.disturbance_trial;
    if (loss?.survives === true) return { kind: 'yes', value: SUMMARY_COPY.recoversYes, detail: SUMMARY_COPY.recoversYesDetail };
    if (loss?.survives === false && loss.broken_by.length > 0) return { kind: 'no', value: SUMMARY_COPY.recoversNo, detail: SUMMARY_COPY.recoversNoDetail(lossesOf(clock), notTriedOf(clock)) };
    if (loss?.survives === false) return { kind: 'not-tested', value: SUMMARY_COPY.recoversUnavailable, detail: SUMMARY_COPY.recoversBaselineUnavailableDetail };
    const notTried = clock.assessment.disturbance_trial_not_tried;
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
    const limit = clock.assessment.disturbance_trial?.loss_limit;
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

/**
 * The share the cold start's figure may be off the average of the start points before the table and the card name it
 * beside the average
 */
const COLD_START_NAMED_SHARE = 0.1;

/**
 * Where a clock's wake-ups are the average of its start points: how many, and the cold start's figure where it is
 * more than COLD_START_NAMED_SHARE off the average; null where the figure is the cold start's own
 */
export function wakeUpsAverageOf(clock: Pick<SummaryClock, 'assessment'>): { starts: number; coldStart: number | null } | null {
    const fromStarts = clock.assessment.wake_ups_from_starts;
    if (fromStarts === undefined) {
        return null;
    }
    const cold = fromStarts.wake_ups_per_minute[0];
    const named = Math.abs(cold - fromStarts.mean) > COLD_START_NAMED_SHARE * Math.max(Math.abs(fromStarts.mean), Math.abs(cold));
    return { starts: fromStarts.wake_ups_per_minute.length, coldStart: named ? cold : null };
}

/**
 * The wake-ups of one copy, rounded as the table rounds them: "18 a minute", "one copy"; "one copy, average of 12 start
 * points" where they are an average (with the cold start's figure where it is far off it); or "Not counted"
 */
export function wakeUpsText(clock: Pick<SummaryClock, 'assessment'>): { value: string; sub: string } {
    const perMinute = clock.assessment.wake_ups_per_minute;
    if (perMinute === null) {
        return { value: SUMMARY_COPY.wakeUpsNotCounted, sub: '' };
    }
    const average = wakeUpsAverageOf(clock);
    const sub = average === null ? SUMMARY_COPY.oneCopy
        : `${SUMMARY_COPY.oneCopy}, ${SUMMARY_COPY.wakeUpsAverage(average.starts)}`
            + (average.coldStart === null ? '' : `; ${SUMMARY_COPY.wakeUpsColdStart(Math.round(average.coldStart))}`);
    return { value: SUMMARY_COPY.wakeUps(Math.round(perMinute)), sub };
}

/** The signals of one copy a minute, rounded as the wakeups are: "40 a minute", "one copy"; or "Not counted" */
export function signalsText(clock: Pick<SummaryClock, 'assessment'>): { value: string; sub: string } {
    const perMinute = clock.assessment.signals_per_minute;
    if (perMinute === null || perMinute === undefined) {
        return { value: SUMMARY_COPY.wakeUpsNotCounted, sub: '' };
    }
    return { value: SUMMARY_COPY.wakeUps(Math.round(perMinute)), sub: SUMMARY_COPY.oneCopy };
}

type BeltKind = 'moving' | 'backed_up' | 'none';

/** The belt the engine made a clock for, from its label ("moving", "backed-up"; empty when no clocked inserter picks up from a belt) */
function beltKindOf(beltLabel: string): BeltKind {
    if (beltLabel === '') {
        return 'none';
    }
    return beltLabel.startsWith('moving') ? 'moving' : 'backed_up';
}

/** The Belt pickups tile's word: "Moving", "Backed up", or "None" when no clocked inserter picks up from a belt */
export function beltValue(beltLabel: string): string {
    return { moving: SUMMARY_COPY.beltMoving, backed_up: SUMMARY_COPY.beltBackedUp, none: SUMMARY_COPY.beltNone }[beltKindOf(beltLabel)];
}

/** The line under the Belt pickups tile's word: what "None" means; undefined otherwise */
export function beltValueSub(beltLabel: string): string | undefined {
    return beltKindOf(beltLabel) === 'none' ? SUMMARY_COPY.beltNoneSub : undefined;
}

/** The full clock table's Belt cell: "Moving", "Backed up", or nothing when no clocked inserter picks up from a belt */
export function beltCellText(beltLabel: string): string {
    return beltLabel === '' ? '' : beltValue(beltLabel);
}

/** The sentence under the tiles about the belt the clock is made for */
export function beltLine(beltLabel: string): string {
    return { moving: SUMMARY_COPY.beltLineMoving, backed_up: SUMMARY_COPY.beltLineBackedUp, none: SUMMARY_COPY.beltLineNone }[beltKindOf(beltLabel)];
}

/**
 * What sets a selected clock apart from the recommended one, in at most two sentences: its rate, its wake-ups (when
 * both were counted), its belt, then whether it recovers.
 */
export function differenceFromRecommended(selected: SummaryClock, recommended: SummaryClock): string {
    const sentences: string[] = [];
    if (isStartDependent(selected)) sentences.push('It depends on how it is started.');
    if (isOffTarget(selected)) {
        sentences.push(SUMMARY_COPY.differsRate(rateText(selected.assessment.items_per_second), rateText(targetOf(selected)), selected.counts));
    }
    // at the setpoint, a clock that underproduces or overproduces beside a stable recommended clock (off it, the rate says so)
    const selectedTerm = outputTermOf(selected).term;
    const termDiffers = !isOffTarget(selected) && selectedTerm !== SUMMARY_COPY.stable && outputTermOf(recommended).term === SUMMARY_COPY.stable;
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
    const selectedRecovery = recoversOf(selected);
    const recommendedRecovery = recoversOf(recommended);
    if (selectedRecovery.kind === 'no' && recommendedRecovery.kind !== 'no') {
        sentences.push(SUMMARY_COPY.differsNoRecovery);
    } else if (selectedRecovery.kind === 'not-tested' && selected.assessment.holds && recommendedRecovery.kind !== 'not-tested') {
        sentences.push('Recovery results are unavailable for this clock.');
    } else if (termDiffers) {
        sentences.push(selectedTerm === SUMMARY_COPY.overproduces ? SUMMARY_COPY.differsOverproduces : SUMMARY_COPY.differsUnderproduces);
    }
    return sentences.length === 0 ? SUMMARY_COPY.differsNothing : sentences.slice(0, 2).join(' ');
}

/** Fewer rows than this keep the Makes column: one or two rows read as easily as a sentence */
const FOLD_MIN_ROWS = 3;

/**
 * "All 5 clocks make 240/s." when 3 or more clocks shown make the same rate at two decimals, so the compare table can
 * leave out a column that says the same on every row; null when they differ, or there are too few to fold.
 */
export function foldedMakes(clocks: Pick<SummaryClock, 'assessment' | 'counts'>[]): string | null {
    if (clocks.length < FOLD_MIN_ROWS) {
        return null;
    }
    const rates = new Set(clocks.map(clock => clock.assessment.items_per_second.toFixed(2)));
    return rates.size === 1 ? SUMMARY_COPY.foldedMakes(clocks.length, rateText(clocks[0].assessment.items_per_second), clocks[0].counts) : null;
}

/**
 * The compare table's "Works?": "Yes" for a clock that holds the rate and recovers, made for the belt asked for;
 * otherwise what is wrong, the worst first: that it depends on how it is started, that it underproduces or overproduces
 * (outputTermOf; its rate is in Makes), that it needs a restart after a jam, or that it is only for backed-up belts.
 * `kind` picks the icon; the words say it without the colour.
 */
export function worksOf(clock: Pick<SummaryClock, 'verdict' | 'ranking' | 'assessment' | 'checkedLanes' | 'asBuilt' | 'expectedOutputItems' | 'counts'>):
    { kind: 'yes' | 'caution' | 'no'; text: string } {
    if (isStartDependent(clock)) return { kind: 'caution', text: SUMMARY_COPY.worksStartDependent };
    const output = outputTermOf(clock);
    if (output.term !== SUMMARY_COPY.stable) return { kind: 'no', text: output.term };
    if (clock.verdict === 'no recovery') {
        return { kind: 'caution', text: recoversOf(clock).kind === 'no' ? SUMMARY_COPY.worksNoRecovery : SUMMARY_COPY.recoveryUnavailable };
    }
    return recoversOf(clock).kind === 'not-tested'
        ? { kind: 'caution', text: SUMMARY_COPY.recoveryUnavailable }
        : { kind: 'yes', text: SUMMARY_COPY.worksYes };
}
