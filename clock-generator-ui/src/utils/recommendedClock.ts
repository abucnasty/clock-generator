import type { Config } from 'clock-generator/browser';
import { combineClockAlternativeRuns } from 'clock-generator/light';
import type { ClockAlternativeView } from '../worker/types';
import { rateVerbs, type TargetCounts } from './targetCounts';

/** What the selection rule is given by the config a generation ran with */
export interface PickRule {
    /** The input belts are backed up: every clock is made without belt slack and counts as made for the belt */
    backedUpBelts: boolean;
    /** "Search for fewer wake-ups": the slower searches ran whether they were needed or not */
    searchedForFewerWakeUps: boolean;
}

/** The fields of a clock the recommendation is worked out from, so the tests need not build a whole view */
type PickableClock = Pick<ClockAlternativeView, 'id' | 'verdict' | 'ranking' | 'beltLabel' | 'deadlockRisk' | 'inserterWindowCount'> & {
    assessment: Pick<ClockAlternativeView['assessment'], 'items_per_second'> & Partial<Pick<ClockAlternativeView['assessment'], 'start_dependence' | 'backpressure_loss'>>;
    /** What the rate counts, which the sentences say in their words: none is the item made */
    counts?: TargetCounts;
};

/** A row of the clock table: the clock and its index in the list, which selecting it goes by */
export interface ClockRow<T> {
    alternative: T;
    index: number;
}

/** Every player-facing string of the clock pick, in one place for the glossary */
export const RECOMMENDED_COPY = {
    chip: 'Recommended',
    chipWhileGenerating: 'Best so far',
    intro: 'Each clock was tested in the simulator. Select a row to show it in Your clock above. Fewer wake-ups are '
        + 'better: each one costs a little UPS.',
    backToRecommended: 'Back to recommended',
    backWhileGenerating: 'Back to the pick',
    unstableDivider: 'Unstable clocks',
    disclosureTitle: 'How clocks are chosen',
    disclosure: [
        'The simulator checks exported wake windows from a modeled cold start, including clock-phase checks where available. '
            + 'Extended sampled-start checks are separate and optional; Model and tested starts reports what actually ran. '
            + 'Clocks that hold are also assessed for recovery after inputs stop or outputs back up; an unavailable result is not a pass.',
        'The clock picked for you is the one that holds the rate and recovers with the fewest wake-ups; on a build '
            + 'with a deadlock risk, the one '
            + 'with the fewest wake-ups of the clocks that hold the rate. If clocks tie, the one that recovers sooner, then the '
            + 'one with fewer wake windows. If none qualifies, the stable clock that runs nearest over the target rate; if there is none, the one '
            + 'that runs nearest to the target rate. On a build with a loop of machines, '
            + 'whose wake-ups depend on where its clock is when the build starts, their average over 12 start points is compared.',
        'A clock made for a moving belt keeps each belt inserter\'s wake window open a few ticks longer (belt slack). '
            + 'A clock made without it is only picked when no clock for a moving belt holds the rate. If you say your '
            + 'input belts are backed up (Configure, Belts), every clock is made without the slack.',
    ],
    runMovingBelts: 'This run assumed moving belts.',
    runBackedUpBelts: 'This run assumed backed-up belts.',
    runSearched: 'The slower searches for fewer wake-ups were run.',
    runSearchedWhenNeeded: 'The slower searches were only run if no other clock held the rate and recovered.',
    provisional: 'More clocks are still being made, so this may change. ',
    stopped: 'You stopped this run early, so a better clock may not have been made yet. ',
    beltBackedUp: ' with backed-up belts',
    beltMoving: ' on a moving belt',
    /**
     * The clocks the pick was compared with: those that hold the rate and recover, or on a build with a deadlock risk
     * those that hold the rate (the glossary's words, not the table's old "Stable")
     */
    contenders: (rate: string, deadlock: boolean, counts?: TargetCounts) =>
        deadlock ? `the clocks that hold ${rate}/s` : `the clocks that keep ${rateVerbs(counts).ing} ${rate}/s and recover`,
    fewestWakeUps: (contenders: string, belt: string) => `Fewest wake-ups of ${contenders}${belt}.`,
    fewestDeciders: (contenders: string, belt: string) => `Fewest deciders of ${contenders}${belt}: the least wiring to do by hand.`,
    onlyContender: (rate: string, belt: string, deadlock: boolean) =>
        deadlock ? `The only clock that holds ${rate}/s${belt}.` : `The only clock that holds ${rate}/s and recovers${belt}.`,
    wakeUpsNotCounted: (contenders: string, belt: string) =>
        `Fewest wake windows among ${contenders}${belt}. Wake-ups could not be counted for them.`,
    tieOnWakeUps: (others: number, kind: string) =>
        ` ${othersText(others, kind)} on wake-ups, so the one with fewer wake windows was picked.`,
    tieOnWakeUpsUncounted: (others: number, kind: string) =>
        ` ${othersText(others, kind)} on wake-ups, so the one with fewer wake windows was picked, not counting the `
        + 'extra wake windows that only cut wake-ups.',
    tieOnRecovery: (others: number, kind: string) =>
        ` ${othersText(others, kind)} on wake-ups, so the one that recovers sooner after inputs stop or outputs back up was picked.`,
    tieOnWindows: (others: number, kind: string) =>
        ` ${othersText(others, kind)} on wake-ups and wake windows, so the first one in the list is shown.`,
    tieKindMoving: ' for a moving belt',
    recoveryDoesNotDecide: ' The recovery trials do not decide on this build.',
    noneForMovingBelt: (rate: string, deadlock: boolean) => deadlock
        ? `No clock made for a moving belt holds ${rate}/s.`
        : `No clock made for a moving belt holds ${rate}/s and recovers.`,
    backedUpOnly: ' This one, made for backed-up belts, does.',
    backedUpFewestWakeUps: ' Of those made for backed-up belts, this one has the fewest wake-ups.',
    backedUpWakeUpsNotCounted: ' Of those made for backed-up belts, this one has the fewest wake windows; wake-ups '
        + 'could not be counted for them.',
    mayFailOnMovingBelt: ' It may fail on a moving belt.',
    noneHolds: (rate: string, deadlock: boolean) => deadlock ? `No clock holds ${rate}/s.` : `No clock holds ${rate}/s and recovers.`,
    atRateHolds: (rate: string, fewest: boolean) =>
        ` This one holds ${rate}/s from the modeled cold start${fewest ? ' with the fewest wake-ups' : ''}.`,
    atRateRuns: (rate: string, fewest: boolean) => ` This one runs at ${rate}/s${fewest ? ' with the fewest wake-ups' : ''}.`,
    nearest: ' This one runs nearest to it.',
    nearestAt: (itsRate: string) => ` This one runs nearest to it, at ${itsRate}/s.`,
    nearestHolds: ' Of the equally near clocks, it is the one that holds its output from the modeled cold start.',
    stableOver: (itsRate: string, percent: string) => ` This one is stable and runs over it, at ${itsRate}/s (${percent} over): `
        + 'a stable clock over the target is picked before a clock nearer to it that is unstable or runs under it.',
};

/** "1 other clock for a moving belt ties" / "2 other clocks tie" */
function othersText(others: number, kind: string): string {
    return others === 1 ? `One other clock${kind} is level with it` : `${others} other clocks${kind} are level with it`;
}

/** As the rate warning prints a rate: 240, 12.5, 0.33 */
const figure = (rate: number) => Number(rate.toFixed(2)).toString();

/** A share as a percentage, as the engine's labels print it: "2.32%", "under 0.01%" */
const percentOf = (share: number) => share * 100 < 0.005 ? 'under 0.01%' : `${Number((share * 100).toFixed(2))}%`;

/** Wake-ups as the selection compares them: to a thousandth */
const wakeUpsKey = (wakeUps: number | null) => wakeUps === null ? null : Math.round(wakeUps * 1000);

/** Rate off the target as the selection compares it: to a thousandth of an item a second */
const offTargetKey = (rateOffTarget: number) => Math.round(Math.abs(rateOffTarget) * 1000);

export function pickRuleOf(config: Config): PickRule {
    return {
        backedUpBelts: config.overrides?.backed_up_belts === true,
        searchedForFewerWakeUps: config.overrides?.search_for_fewer_wake_ups === true,
    };
}

/**
 * Index of the clock the selection rule picks from `alternatives`: what the engine selects for the same clocks, worked
 * out with its own function over one run. Null when there are none.
 */
export function recommendedIndexOf(alternatives: Pick<PickableClock, 'ranking'>[]): number | null {
    if (alternatives.length === 0) {
        return null;
    }
    return combineClockAlternativeRuns([{ signature: 'recommended', alternatives }], it => it.ranking).selected_index;
}

/**
 * Why the rule picks the clock at `recommendedIndex`, in a sentence or two for after "Recommended: {label}.". While
 * the clocks are still being made (`final` false) it says the pick may change; after a run the player stopped
 * (`stopped`), that a better clock may not have been made. Empty when nothing is recommended.
 */
export function recommendationReason(
    alternatives: PickableClock[],
    recommendedIndex: number | null,
    rule: PickRule | null,
    final: boolean,
    stopped = false,
): string {
    const pick = recommendedIndex === null ? undefined : alternatives[recommendedIndex];
    if (!pick) {
        return '';
    }
    const reason = reasonOf(alternatives, pick, rule);
    if (final) {
        return reason;
    }
    return (stopped ? RECOMMENDED_COPY.stopped : RECOMMENDED_COPY.provisional) + reason;
}

/** The pick is made for a moving belt, and the player did not say the belts are backed up */
const isOnMovingBelt = (pick: Pick<PickableClock, 'beltLabel'>, rule: PickRule | null) => !rule?.backedUpBelts && pick.beltLabel.startsWith('moving');

/** The belt a reason says its clocks are made for: " with backed-up belts", " on a moving belt", or nothing */
const beltWordsOf = (pick: Pick<PickableClock, 'beltLabel'>, rule: PickRule | null) =>
    rule?.backedUpBelts ? RECOMMENDED_COPY.beltBackedUp : isOnMovingBelt(pick, rule) ? RECOMMENDED_COPY.beltMoving : '';

/**
 * What the name Fewest deciders means for a clock that has it (see `plainClockName`), in the words of the pick's reason:
 * "Fewest deciders of the clocks that keep making 240/s and recover: the least wiring to do by hand."
 */
export function fewestDecidersReason(
    clock: Pick<PickableClock, 'ranking' | 'beltLabel' | 'deadlockRisk' | 'assessment' | 'counts'>,
    rule: PickRule | null,
): string {
    const rate = figure(clock.assessment.items_per_second - clock.ranking.rate_off_target);
    const contenders = RECOMMENDED_COPY.contenders(rate, clock.deadlockRisk !== null, clock.counts);
    return RECOMMENDED_COPY.fewestDeciders(contenders, beltWordsOf(clock, rule));
}

function reasonOf(alternatives: PickableClock[], pick: PickableClock, rule: PickRule | null): string {
    const { ranking } = pick;
    const rate = figure(pick.assessment.items_per_second - ranking.rate_off_target);
    if (pick.assessment.backpressure_loss === null && pick.assessment.start_dependence?.verdict !== 'start-dependent') {
        return `Selected by the engine's rule at ${figure(pick.assessment.items_per_second)}/s. No usable recovery result is available.`;
    }
    // on a build with a deadlock risk a clock that holds the rate meets it, recovering or not; elsewhere it is Stable
    const deadlock = pick.deadlockRisk !== null;
    if (!ranking.meets_target_rate) {
        return nearestReason(alternatives, pick, rate, deadlock);
    }
    const recovery = pick.verdict === 'no recovery' ? RECOMMENDED_COPY.recoveryDoesNotDecide : '';
    if (!ranking.matches_belt_choice) {
        // only picked when no clock made for the belt meets the rate, so it beat the others made without the slack
        const others = alternatives.filter(other => other !== pick && other.ranking.meets_target_rate);
        const contest = others.length === 0 ? RECOMMENDED_COPY.backedUpOnly
            : ranking.wake_ups_per_minute === null ? RECOMMENDED_COPY.backedUpWakeUpsNotCounted
                : RECOMMENDED_COPY.backedUpFewestWakeUps + tieOf(pick, others, '');
        return RECOMMENDED_COPY.noneForMovingBelt(rate, deadlock) + contest + RECOMMENDED_COPY.mayFailOnMovingBelt + recovery;
    }
    const moving = isOnMovingBelt(pick, rule);
    const belt = beltWordsOf(pick, rule);
    const others = alternatives.filter(other => other !== pick
        && other.ranking.meets_target_rate && other.ranking.matches_belt_choice);
    if (others.length === 0) {
        return RECOMMENDED_COPY.onlyContender(rate, belt, deadlock) + recovery;
    }
    const contenders = RECOMMENDED_COPY.contenders(rate, deadlock, pick.counts);
    // uncounted wake-ups rank after any count, so when the pick's were not counted no contender's were
    if (ranking.wake_ups_per_minute === null) {
        return RECOMMENDED_COPY.wakeUpsNotCounted(contenders, belt) + recovery;
    }
    return RECOMMENDED_COPY.fewestWakeUps(contenders, belt)
        + tieOf(pick, others, moving ? RECOMMENDED_COPY.tieKindMoving : '') + recovery;
}

/**
 * What decided between the pick and those of `others` with as many wake-ups: the windows, or the order. The selection
 * counts the windows without the output feeders' (the inserters that feed the machine the output is taken from); when
 * the table's column does not show the pick with fewer, the sentence says so.
 */
function tieOf(pick: PickableClock, others: PickableClock[], kind: string): string {
    const wakeUps = wakeUpsKey(pick.ranking.wake_ups_per_minute);
    const tiedOnWakeUps = others.filter(other => wakeUpsKey(other.ranking.wake_ups_per_minute) === wakeUps);
    // of equals on wake-ups the one that gets back from a loss sooner is picked, before the windows decide
    const recovery = (clock: PickableClock) => clock.ranking.recovery_periods ?? Infinity;
    if (tiedOnWakeUps.length > 0 && tiedOnWakeUps.every(other => recovery(other) > recovery(pick))) {
        return RECOMMENDED_COPY.tieOnRecovery(tiedOnWakeUps.length, kind);
    }
    const tiedOnRecovery = tiedOnWakeUps.filter(other => recovery(other) === recovery(pick));
    const tiedOnWindows = tiedOnRecovery.filter(other => other.ranking.window_count === pick.ranking.window_count);
    if (tiedOnWindows.length > 0) {
        return RECOMMENDED_COPY.tieOnWindows(tiedOnWindows.length, kind);
    }
    if (tiedOnRecovery.length === 0) {
        return '';
    }
    const fewerOnScreen = tiedOnRecovery.every(other => pick.inserterWindowCount < other.inserterWindowCount);
    return fewerOnScreen
        ? RECOMMENDED_COPY.tieOnWakeUps(tiedOnRecovery.length, kind)
        : RECOMMENDED_COPY.tieOnWakeUpsUncounted(tiedOnRecovery.length, kind);
}

/** Why the pick when no clock qualifies: actual modeled-start rate and sampled starts remain distinct. */
function nearestReason(alternatives: PickableClock[], pick: PickableClock, rate: string, deadlock: boolean): string {
    const { ranking } = pick;
    if (pick.assessment.start_dependence?.verdict === 'start-dependent') {
        return `No clock qualifies under the engine's selection rule. This one is assessed at ${figure(pick.assessment.items_per_second)}/s and reaches the target from only some sampled starts. See Model and tested starts.`;
    }
    const lead = RECOMMENDED_COPY.noneHolds(rate, deadlock);
    if (ranking.stable_above_target === true) {
        const target = pick.assessment.items_per_second - ranking.rate_off_target;
        return lead + RECOMMENDED_COPY.stableOver(figure(pick.assessment.items_per_second), percentOf(ranking.rate_off_target / target));
    }
    const counted = ranking.wake_ups_per_minute !== null;
    const near = offTargetKey(ranking.rate_off_target);
    if (near === 0) {
        // at the rate as the selection compares it, so holding the output decided, then the wake-ups
        return lead + (ranking.holds_expected_output
            ? RECOMMENDED_COPY.atRateHolds(rate, counted)
            : RECOMMENDED_COPY.atRateRuns(rate, counted));
    }
    const itsRate = figure(pick.assessment.items_per_second);
    const holdsOverEquallyNear = ranking.holds_expected_output && alternatives.some(other => other !== pick
        && offTargetKey(other.ranking.rate_off_target) === near && !other.ranking.holds_expected_output);
    return lead + (itsRate === rate ? RECOMMENDED_COPY.nearest : RECOMMENDED_COPY.nearestAt(itsRate))
        + (holdsOverEquallyNear ? RECOMMENDED_COPY.nearestHolds : '');
}

/** The "This run" line of "How clocks are chosen": the belt the clocks were made for, and whether the searches ran */
export function disclosureRunLine(rule: PickRule | null): string {
    return `${rule?.backedUpBelts ? RECOMMENDED_COPY.runBackedUpBelts : RECOMMENDED_COPY.runMovingBelts} `
        + (rule?.searchedForFewerWakeUps ? RECOMMENDED_COPY.runSearched : RECOMMENDED_COPY.runSearchedWhenNeeded);
}

/** The recommended clock's row first, the others in the order given */
function recommendedFirst<T>(rows: ClockRow<T>[], recommendedIndex: number | null): ClockRow<T>[] {
    const recommended = rows.filter(({ index }) => index === recommendedIndex);
    return recommended.length === 0 ? rows : [...recommended, ...rows.filter(({ index }) => index !== recommendedIndex)];
}

/**
 * The rows of the clock table in two groups: the stable clocks, then the others under a divider, so showing the
 * unstable ones never moves a stable row. While the unstable ones are hidden (and something is stable) only the selected
 * and the recommended of them stay. Shown, the rows in `pinnedIds` (those that stayed while hidden) come first in the
 * group, so showing the others does not move them either; the rest follow in list order. The recommended clock is
 * first in its group, so the answer leads the table, unless `recommendedFirst` is false (a run is going).
 */
export function partitionClockRows<T extends Pick<ClockAlternativeView, 'id' | 'verdict'>>(
    alternatives: T[],
    options: {
        selectedIndex: number;
        recommendedIndex: number | null;
        showUnstable: boolean;
        pinnedIds?: string[];
        /** The recommended row first in its group (default); off while a run can still change the pick */
        recommendedFirst?: boolean;
    },
): { stable: ClockRow<T>[]; unstable: ClockRow<T>[]; unstableCount: number; hiddenCount: number; anyStable: boolean } {
    const rows = alternatives.map((alternative, index) => ({ alternative, index }));
    const stable = rows.filter(({ alternative }) => alternative.verdict === 'stable');
    const allUnstable = rows.filter(({ alternative }) => alternative.verdict !== 'stable');
    const anyStable = stable.length > 0;
    const pinned = new Set(options.pinnedIds ?? []);
    // unstable clocks are hidden until asked for, unless nothing is stable: then they are all there is to look at
    const unstable = anyStable && !options.showUnstable
        ? allUnstable.filter(({ index }) => index === options.selectedIndex || index === options.recommendedIndex)
        : [
            ...allUnstable.filter(({ alternative }) => pinned.has(alternative.id)),
            ...allUnstable.filter(({ alternative }) => !pinned.has(alternative.id)),
        ];
    const lead = (group: ClockRow<T>[]) => options.recommendedFirst === false ? group : recommendedFirst(group, options.recommendedIndex);
    return {
        stable: lead(stable),
        unstable: lead(unstable),
        unstableCount: allUnstable.length,
        hiddenCount: allUnstable.length - unstable.length,
        anyStable,
    };
}

export interface BeltClockGroups<T> {
    matches: ClockRow<T>[];
    requiresChange: ClockRow<T>[];
}

/** Group eligible, globally indexed rows without changing their order or eligibility. */
export function groupClockRowsByBelt<T extends Pick<ClockAlternativeView, 'ranking'>>(
    rows: readonly ClockRow<T>[],
): BeltClockGroups<T> {
    return {
        matches: rows.filter(({ alternative }) => alternative.ranking.matches_belt_choice),
        requiresChange: rows.filter(({ alternative }) => !alternative.ranking.matches_belt_choice),
    };
}
