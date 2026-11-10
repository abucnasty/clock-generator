import type { ClockAlternativeView } from '../worker/types';
import { formatNumberText } from './numberText';
import { lossesOf, notTriedOf } from './rateWarning';
import { fewestDecidersReason, recommendedIndexOf, type PickRule } from './recommendedClock';
import { rateVerbs, type TargetCounts } from './targetCounts';

/** The fields of a clock its summary is worked out from, so the tests need not build a whole view */
export type SummaryClock = Pick<ClockAlternativeView, 'id' | 'label' | 'verdict' | 'ranking' | 'beltLabel' | 'deadlockRisk' | 'assessment' | 'deciders'>
    & Partial<Pick<ClockAlternativeView, 'strategy' | 'roundedWindowCycleTicks' | 'roundedRunsFast'>> & { counts?: TargetCounts };

/**
 * The smallest distance from the target rate that names a clock by its rate, as the Copy button's "below target"
 * (1.14): less than this prints as the target itself at two decimals.
 */
const MIN_OFF_TARGET = 0.005;

/** Every player-facing string of the clock summary, in one place for the glossary and for review */
export const SUMMARY_COPY = {
    // the chips beside a clock's name: its status, and what it has fewest of
    recoveryUnavailable: 'Recovery unavailable',
    unstable: 'Does not hold its rate',
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
    beltCellMoving: (slack: string) => `Moving (${slack} belt slack)`,
    beltCellNoSlack: 'Moving (no belt slack)',
    beltNoSlackSub: 'no belt slack',
    beltLineMoving: 'Made for moving belts.',
    beltLineBackedUp: 'Made for backed-up belts.',
    beltLineNoSlack: 'Checked on moving belts, without belt slack.',
    beltLineNone: 'No inserter on the clock picks up from a belt.',
    // how a selected clock differs from the recommended one
    differsRate: (rate: string, target: string, counts?: TargetCounts) => `This one ${rateVerbs(counts).third} ${rate}/s, not ${target}/s.`,
    differsMoreWakeUps: (n: number) => `It wakes inserters ${n} more ${n === 1 ? 'time' : 'times'} a minute than the recommended clock.`,
    differsFewerWakeUps: (n: number) => `It wakes inserters ${n} fewer ${n === 1 ? 'time' : 'times'} a minute than the recommended clock.`,
    differsNoRecovery: 'It does not go back to its rate after a supply stop or an output blockage.',
    differsUnstable: 'It does not hold its rate.',
    differsNothing: 'It is not the recommended clock.',
    // the compare table
    foldedMakes: (count: number, rate: string, counts?: TargetCounts) => `All ${count} clocks ${rateVerbs(counts).base} ${rate}/s.`,
    worksYes: 'Yes',
    worksOffTarget: (rate: string) => `Misses the rate (${rate}/s)`,
    worksNoRecovery: 'No recovery',
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

/** A clock the chips compare: it meets the target rate (by the selection's rule) */
const isContender = (clock: SummaryClock) => clock.ranking.meets_target_rate;

/** A chip beside a clock's name: its status, or what it has fewest of */
export interface ClockBadge {
    kind: 'status' | 'fewest-wakeups' | 'fewest-deciders';
    text: string;
}

/**
 * The status chip of a clock, the first that matches: it depends on how it is started; it is off the setpoint (its rate);
 * it has no recovery, or does not hold its rate. Null for a clock with none of these.
 */
function statusOf(clock: SummaryClock): string | null {
    if (isStartDependent(clock)) return SUMMARY_COPY.startDependent;
    if (isOffTarget(clock)) return SUMMARY_COPY.worksOffTarget(rateText(clock.assessment.items_per_second));
    // on a build with a deadlock risk the recovery trials do not decide, so a clock that holds the rate has no status chip for it
    const verdictDecides = clock.deadlockRisk === null || !clock.ranking.meets_target_rate;
    if (verdictDecides && clock.verdict === 'no recovery') {
        return recoversOf(clock).kind === 'no' ? SUMMARY_COPY.worksNoRecovery : SUMMARY_COPY.recoveryUnavailable;
    }
    if (clock.verdict === 'unstable') return SUMMARY_COPY.unstable;
    return null;
}

/**
 * The chips beside the name of a clock, against the other clocks of its generation. One status chip when the clock has one.
 * Otherwise "Fewest wakeups" on a clock that ties the fewest without being the recommended one (the recommended clock has its
 * own chip and reason), and "Fewest deciders" on a clock with fewer deciders than the recommended clock and the fewest-wakeups
 * clocks have, when the clocks do not all have the same number.
 */
export function clockBadges(clocks: SummaryClock[], index: number): ClockBadge[] {
    const clock = clocks[index];
    if (!clock) {
        return [];
    }
    const status = statusOf(clock);
    if (status !== null) return [{ kind: 'status', text: status }];
    if (!isContender(clock)) return [];
    const badges: ClockBadge[] = [];
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
export function pickNameMeaning(clocks: SummaryClock[], index: number, rule: PickRule | null): string {
    return clockBadges(clocks, index).some(badge => badge.kind === 'fewest-deciders') ? fewestDecidersReason(clocks[index], rule) : '';
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

type BeltKind = 'moving' | 'moving_no_slack' | 'backed_up' | 'none';

/**
 * The supply a clock was checked on. A run for backed-up belts checks every clock on backed-up belts. In a run for moving
 * belts every clock is checked on moving belts, and one made without belt slack says so.
 */
function beltKindOf(rule: PickRule | null, beltLabel: string): BeltKind {
    if (beltLabel === '') {
        return 'none';
    }
    if (rule?.backedUpBelts === true) return 'backed_up';
    if (beltLabel.startsWith('moving')) return 'moving';
    return rule === null ? 'backed_up' : 'moving_no_slack';
}

/** The Belt pickups tile's word: "Moving", "Backed up", or "None" when no clocked inserter picks up from a belt */
export function beltValue(rule: PickRule | null, beltLabel: string): string {
    return { moving: SUMMARY_COPY.beltMoving, moving_no_slack: SUMMARY_COPY.beltMoving, backed_up: SUMMARY_COPY.beltBackedUp, none: SUMMARY_COPY.beltNone }[beltKindOf(rule, beltLabel)];
}

/** The line under the Belt pickups tile's word: what "None" means, or "no belt slack"; undefined otherwise */
export function beltValueSub(rule: PickRule | null, beltLabel: string): string | undefined {
    const kind = beltKindOf(rule, beltLabel);
    return kind === 'none' ? SUMMARY_COPY.beltNoneSub : kind === 'moving_no_slack' ? SUMMARY_COPY.beltNoSlackSub : undefined;
}

/**
 * The full clock table's Belt cell in the belt question's words: "Moving (+4 ticks belt slack)", "Moving (no belt slack)",
 * "Backed up", or nothing when no clocked inserter picks up from a belt. The engine's label is "moving (+4 ticks)" or "backed-up".
 */
export function beltCellText(beltLabel: string, rule: PickRule | null = null): string {
    if (beltLabel === '') {
        return '';
    }
    const slack = /^moving \((.+)\)$/.exec(beltLabel);
    if (slack) return SUMMARY_COPY.beltCellMoving(slack[1]);
    if (beltLabel.startsWith('moving')) return SUMMARY_COPY.beltMoving;
    return beltKindOf(rule, beltLabel) === 'moving_no_slack' ? SUMMARY_COPY.beltCellNoSlack : SUMMARY_COPY.beltBackedUp;
}

/** The sentence under the tiles about the belt the clock is made for (2.4 may change its words, not its place) */
export function beltLine(rule: PickRule | null, beltLabel: string): string {
    return { moving: SUMMARY_COPY.beltLineMoving, moving_no_slack: SUMMARY_COPY.beltLineNoSlack, backed_up: SUMMARY_COPY.beltLineBackedUp, none: SUMMARY_COPY.beltLineNone }[beltKindOf(rule, beltLabel)];
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
export function foldedMakes(clocks: Pick<SummaryClock, 'assessment' | 'counts'>[]): string | null {
    if (clocks.length < FOLD_MIN_ROWS) {
        return null;
    }
    const rates = new Set(clocks.map(clock => clock.assessment.items_per_second.toFixed(2)));
    return rates.size === 1 ? SUMMARY_COPY.foldedMakes(clocks.length, rateText(clocks[0].assessment.items_per_second), clocks[0].counts) : null;
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
    return recoversOf(clock).kind === 'not-tested'
        ? { kind: 'caution', text: SUMMARY_COPY.recoveryUnavailable }
        : { kind: 'yes', text: SUMMARY_COPY.worksYes };
}
