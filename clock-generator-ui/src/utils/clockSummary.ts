import type { ClockAlternativeView } from '../worker/types';
import { formatNumberText } from './numberText';
import { lossesOf } from './rateWarning';
import type { PickRule } from './recommendedClock';

/** The fields of a clock its summary is worked out from, so the tests need not build a whole view */
export type SummaryClock = Pick<ClockAlternativeView, 'id' | 'label' | 'verdict' | 'ranking' | 'beltLabel' | 'deadlockRisk' | 'assessment'>;

/**
 * The smallest distance from the target rate that names a clock by its rate, as the Copy button's "below target"
 * (1.14): less than this prints as the target itself at two decimals.
 */
const MIN_OFF_TARGET = 0.005;

/** Every player-facing string of the clock summary, in one place for the glossary and the owner's review */
export const SUMMARY_COPY = {
    // plain names: what a clock is for, against the others of the same generation
    offTarget: (rate: string, target: string) => `Runs at ${rate}/s, not ${target}/s`,
    noRecovery: 'Does not recover when jammed or starved',
    unstable: 'Does not hold its rate',
    stillBelts: 'For belts that stand still',
    fewestWakeUps: 'Fewest wake-ups',
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
    recoversYesDetail: 'In the simulator, it gets back to its rate by itself after it is starved or jammed.',
    recoversNoDetail: (losses: string) => losses
        ? `In the simulator, after ${losses} for a while, it does not get back to its rate by itself.`
        : 'In the simulator, after it is starved or jammed, it does not get back to its rate by itself.',
    recoversNotTestedDetail: 'This clock does not hold its rate, so it was not starved or jammed.',
    beltMoving: 'Moving',
    beltStill: 'Standing still',
    beltNone: 'No belt',
    beltLineMoving: 'Made for moving belts.',
    beltLineStill: 'Made for belts that stand still.',
    beltLineNone: 'No inserter on the clock picks up from a belt.',
    // how a selected clock differs from the recommended one
    differsRate: (rate: string, target: string) => `This one makes ${rate}/s, not ${target}/s.`,
    differsMoreWakeUps: (n: number) => `It wakes inserters ${n} more ${n === 1 ? 'time' : 'times'} a minute than the recommended clock.`,
    differsFewerWakeUps: (n: number) => `It wakes inserters ${n} fewer ${n === 1 ? 'time' : 'times'} a minute than the recommended clock.`,
    differsBelt: 'It is made for belts that stand still.',
    differsNoRecovery: 'It does not recover after it is starved or jammed.',
    differsUnstable: 'It does not hold its rate.',
    differsNothing: 'It is not the recommended clock.',
};

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
 * its rate, by that; one for belts that stand still (when the build asked for moving ones) by its belt; among the
 * others, the one with the fewest wake-ups, else the fewest wake windows; any other by the rate it makes. Tied clocks
 * share a name; the engine's name under it tells them apart. The target is each clock's own, so an edit to the build
 * since never renames a clock.
 */
export function plainClockName(clocks: SummaryClock[], index: number): string {
    const clock = clocks[index];
    if (!clock) {
        return '';
    }
    if (isOffTarget(clock)) {
        return SUMMARY_COPY.offTarget(rateText(clock.assessment.items_per_second), rateText(targetOf(clock)));
    }
    // on a build with a deadlock risk the recovery trials do not decide, so a clock that holds the rate is named by its trade-off
    const verdictDecides = clock.deadlockRisk === null || !clock.ranking.meets_target_rate;
    if (verdictDecides && clock.verdict === 'no recovery') {
        return SUMMARY_COPY.noRecovery;
    }
    if (clock.verdict === 'unstable') {
        return SUMMARY_COPY.unstable;
    }
    if (!clock.ranking.matches_belt_choice) {
        return SUMMARY_COPY.stillBelts;
    }
    if (isContender(clock)) {
        const contenders = clocks.filter(isContender);
        const wakeUps = wakeUpsKey(clock.ranking.wake_ups_per_minute);
        const counted = contenders.map(it => wakeUpsKey(it.ranking.wake_ups_per_minute)).filter(it => it !== null);
        if (wakeUps !== null && wakeUps === Math.min(...counted)) {
            return SUMMARY_COPY.fewestWakeUps;
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
    switch (clock.verdict) {
        case 'stable':
            return { kind: 'yes', value: SUMMARY_COPY.recoversYes, detail: SUMMARY_COPY.recoversYesDetail };
        case 'no recovery':
            return { kind: 'no', value: SUMMARY_COPY.recoversNo, detail: SUMMARY_COPY.recoversNoDetail(lossesOf(clock)) };
        case 'unstable':
            return { kind: 'not-tested', value: SUMMARY_COPY.recoversNotTested, detail: SUMMARY_COPY.recoversNotTestedDetail };
    }
}

/** What the clock makes, for all the copies, and the line under it: "240/s", "all 11 copies" (nothing for one copy) */
export function makesText(clock: Pick<SummaryClock, 'assessment'>, copies: number): { value: string; sub: string } {
    return {
        value: SUMMARY_COPY.makes(rateText(clock.assessment.items_per_second)),
        sub: copies > 1 ? SUMMARY_COPY.allCopies(copies) : '',
    };
}

/** The wake-ups of one copy, rounded as the table rounds them: "18 a minute", "one copy"; or "Not counted" */
export function wakeUpsText(clock: Pick<SummaryClock, 'assessment'>): { value: string; sub: string } {
    const perMinute = clock.assessment.wake_ups_per_minute;
    return perMinute === null
        ? { value: SUMMARY_COPY.wakeUpsNotCounted, sub: '' }
        : { value: SUMMARY_COPY.wakeUps(Math.round(perMinute)), sub: SUMMARY_COPY.oneCopy };
}

type BeltKind = 'moving' | 'still' | 'none';

function beltKindOf(rule: PickRule | null, beltLabel: string): BeltKind {
    if (beltLabel === '') {
        return 'none';
    }
    return !rule?.nonMovingBelts && beltLabel.startsWith('moving') ? 'moving' : 'still';
}

/** The Belt tile's word: "Moving", "Standing still", or "No belt" when no clocked inserter picks up from one */
export function beltValue(rule: PickRule | null, beltLabel: string): string {
    return { moving: SUMMARY_COPY.beltMoving, still: SUMMARY_COPY.beltStill, none: SUMMARY_COPY.beltNone }[beltKindOf(rule, beltLabel)];
}

/** The sentence under the tiles about the belt the clock is made for (2.4 may change its words, not its place) */
export function beltLine(rule: PickRule | null, beltLabel: string): string {
    return { moving: SUMMARY_COPY.beltLineMoving, still: SUMMARY_COPY.beltLineStill, none: SUMMARY_COPY.beltLineNone }[beltKindOf(rule, beltLabel)];
}

/**
 * What sets a selected clock apart from the recommended one, in at most two sentences: its rate, its wake-ups (when
 * both were counted), its belt, then whether it recovers.
 */
export function differenceFromRecommended(selected: SummaryClock, recommended: SummaryClock): string {
    const sentences: string[] = [];
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
    if (selected.verdict === 'no recovery' && recommended.verdict !== 'no recovery') {
        sentences.push(SUMMARY_COPY.differsNoRecovery);
    } else if (selected.verdict === 'unstable' && recommended.verdict !== 'unstable') {
        sentences.push(SUMMARY_COPY.differsUnstable);
    }
    return sentences.length === 0 ? SUMMARY_COPY.differsNothing : sentences.slice(0, 2).join(' ');
}
