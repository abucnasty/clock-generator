import type { Config } from 'clock-generator/browser';
import { combineClockAlternativeRuns, signalsKey } from 'clock-generator/light';
import type { ClockAlternativeView } from '../worker/types';
import { shownRateOf } from './shownRate';
import { rateVerbs, type TargetCounts } from './targetCounts';

/** What the selection rule is given by the config a generation ran with */
export interface PickRule {
    /** "Search for fewer wake-ups": the slower searches ran whether they were needed or not */
    searchedForFewerWakeUps: boolean;
}

/** The fields of a clock the recommendation is worked out from, so the tests need not build a whole view */
type PickableClock = Pick<ClockAlternativeView, 'id' | 'verdict' | 'ranking' | 'beltLabel' | 'deadlockRisk' | 'inserterWindowCount'> & Partial<Pick<ClockAlternativeView, 'checkedLanes'>> & {
    assessment: Pick<ClockAlternativeView['assessment'], 'items_per_second'> & Partial<Pick<ClockAlternativeView['assessment'], 'start_dependence' | 'disturbance_trial' | 'shared_lane_losses'>>;
    /** What the rate counts, which the sentences say in their words: none is the item made */
    counts?: TargetCounts;
};

/** A row of the clock table: the clock, its index in the list, which selecting it goes by, and its rank (1 first) */
export interface ClockRow<T> {
    alternative: T;
    index: number;
    rank: number;
}

/** Every player-facing string of the clock pick, in one place for the glossary */
export const RECOMMENDED_COPY = {
    chip: 'Recommended',
    chipWhileGenerating: 'Best so far',
    intro: 'Each clock was tested in the simulator. Select a row to show it in Selected clock above. Fewer wakeups are '
        + 'better: each one costs a little UPS.',
    backToRecommended: 'Back to recommended',
    backWhileGenerating: 'Back to best so far',
    unstableDivider: 'Clocks that are not Stable',
    /** The head of the column of each clock's place in the engine's order, and its help: the seven keys, in order */
    rank: 'Rank',
    rankLead: 'The clocks are ranked by these, in order. Each one decides only between clocks that are equal on the ones before it.',
    rankKeys: [
        'It holds the setpoint and has recovery. On a build with a deadlock risk, it holds the setpoint. After these come '
            + 'clocks rounded to whole ticks that run at most 0.1% fast, then clocks whose recovery could not be tried, then '
            + 'stable clocks over the setpoint, then all other clocks.',
        'It is nearer to the setpoint, over or under it.',
        'It holds its output from the modeled cold start.',
        'It has fewer wakeups. On a build with a loop of machines, the average over 12 start points is compared.',
        'It has fewer signals.',
        'It goes back to its rate in fewer window cycles after a supply stop or an output blockage.',
        'It has fewer enable windows.',
    ],
    rankTie: 'Clocks that are equal on all seven keep the order they were made in.',
    rankFirst: 'Rank 1 is the recommended clock.',
    runSearched: 'The slower searches for fewer wakeups were run.',
    runSearchedWhenNeeded: 'The slower searches were only run if no other clock held the rate and had recovery, apart from the two that can still find fewer wakeups on a short clock.',
    provisional: 'More clocks are still being made, so this may change. ',
    stopped: 'You stopped this run early, so a better clock may not have been made yet. ',
    /**
     * The clocks the pick was compared with: those that hold the rate and recover, or on a build with a deadlock risk
     * those that hold the rate (the glossary's words, not the table's old "Stable")
     */
    contenders: (rate: string, deadlock: boolean, counts?: TargetCounts) =>
        deadlock ? `the clocks that hold ${rate}/s` : `the clocks that keep ${rateVerbs(counts).ing} ${rate}/s and go back to it after a stop`,
    fewestWakeUps: (contenders: string) => `Fewest wakeups of ${contenders}.`,
    fewestDeciders: (contenders: string) => `Fewest deciders of ${contenders}. This is the least wiring to do by hand.`,
    onlyContender: (rate: string, deadlock: boolean) =>
        deadlock ? `The only clock that holds ${rate}/s.` : `The only clock that holds ${rate}/s and has recovery.`,
    wakeUpsNotCounted: (contenders: string) =>
        `Fewest enable windows among ${contenders}. Wakeups could not be counted for them.`,
    tieOnWakeUps: (others: number) =>
        ` ${othersText(others)} on wakeups and signals, so the one with fewer enable windows was picked.`,
    tieOnWakeUpsUncounted: (others: number) =>
        ` ${othersText(others)} on wakeups and signals, so the one with fewer enable windows was picked, not counting the `
        + 'extra enable windows that only cut wakeups.',
    tieOnSignals: (others: number) =>
        ` ${othersText(others)} on wakeups, so the one with fewer signals was picked.`,
    tieOnRecovery: (others: number) =>
        ` ${othersText(others)} on wakeups and signals, so the one that goes back to its rate sooner after a supply stop or an output blockage was picked.`,
    tieOnWindows: (others: number) =>
        ` ${othersText(others)} on wakeups, signals and enable windows, so the first one in the list is shown.`,
    recoveryDoesNotDecide: ' The recovery trials do not decide on this build.',
    noneHolds: (rate: string, deadlock: boolean) => deadlock ? `No clock holds ${rate}/s.` : `No clock holds ${rate}/s and has recovery.`,
    atRateHolds: (rate: string, fewest: boolean) =>
        ` This one holds ${rate}/s from the modeled cold start${fewest ? ' with the fewest wakeups' : ''}.`,
    atRateRuns: (rate: string, fewest: boolean) => ` This one runs at ${rate}/s${fewest ? ' with the fewest wakeups' : ''}.`,
    nearest: ' This one runs nearest to it.',
    nearestAt: (itsRate: string) => ` This one runs nearest to it, at ${itsRate}/s.`,
    nearestHolds: ' Of the equally near clocks, it is the one that holds its output from the modeled cold start.',
    stableOver: (itsRate: string, percent: string) => ` This one is stable and runs over it, at ${itsRate}/s (${percent} over): `
        + 'a stable clock over the setpoint is picked before a clock nearer to it that is unstable or runs under it.',
};

/** "One other clock is level with it" / "2 other clocks are level with it" */
function othersText(others: number): string {
    return others === 1 ? 'One other clock is level with it' : `${others} other clocks are level with it`;
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
    final: boolean,
    stopped = false,
): string {
    const pick = recommendedIndex === null ? undefined : alternatives[recommendedIndex];
    if (!pick) {
        return '';
    }
    const reason = reasonOf(alternatives, pick);
    if (final) {
        return reason;
    }
    return (stopped ? RECOMMENDED_COPY.stopped : RECOMMENDED_COPY.provisional) + reason;
}

/**
 * What the name Fewest deciders means for a clock that has it (see `plainClockName`), in the words of the pick's reason:
 * "Fewest deciders of the clocks that keep making 240/s and recover: the least wiring to do by hand."
 */
export function fewestDecidersReason(
    clock: Pick<PickableClock, 'ranking' | 'deadlockRisk' | 'assessment' | 'counts'>,
): string {
    const rate = figure(clock.assessment.items_per_second - clock.ranking.rate_off_target);
    const contenders = RECOMMENDED_COPY.contenders(rate, clock.deadlockRisk !== null, clock.counts);
    return RECOMMENDED_COPY.fewestDeciders(contenders);
}

function reasonOf(alternatives: PickableClock[], pick: PickableClock): string {
    const { ranking } = pick;
    const rate = figure(pick.assessment.items_per_second - ranking.rate_off_target);
    if (pick.assessment.disturbance_trial === null && pick.assessment.start_dependence?.verdict !== 'start-dependent') {
        return `Recommended by the engine's rule at ${figure(shownRateOf(pick))}/s. No usable recovery result is available.`;
    }
    // on a build with a deadlock risk a clock that holds the rate meets it, recovering or not; elsewhere it is Stable
    const deadlock = pick.deadlockRisk !== null;
    if (!ranking.meets_target_rate) {
        return nearestReason(alternatives, pick, rate, deadlock);
    }
    const recovery = pick.verdict === 'no recovery' ? RECOMMENDED_COPY.recoveryDoesNotDecide : '';
    const others = alternatives.filter(other => other !== pick && other.ranking.meets_target_rate);
    if (others.length === 0) {
        return RECOMMENDED_COPY.onlyContender(rate, deadlock) + recovery;
    }
    const contenders = RECOMMENDED_COPY.contenders(rate, deadlock, pick.counts);
    // uncounted wake-ups rank after any count, so when the pick's were not counted no contender's were
    if (ranking.wake_ups_per_minute === null) {
        return RECOMMENDED_COPY.wakeUpsNotCounted(contenders) + recovery;
    }
    return RECOMMENDED_COPY.fewestWakeUps(contenders) + tieOf(pick, others) + recovery;
}

/**
 * What decided between the pick and those of `others` with as many wake-ups: the signals, the recovery, the windows, or
 * the order. The selection counts the windows without the output feeders' (the inserters that feed the machine the output
 * is taken from); when the table's column does not show the pick with fewer, the sentence says so.
 */
function tieOf(pick: PickableClock, others: PickableClock[]): string {
    const wakeUps = wakeUpsKey(pick.ranking.wake_ups_per_minute);
    const tiedOnWakeUps = others.filter(other => wakeUpsKey(other.ranking.wake_ups_per_minute) === wakeUps);
    // of equals on wake-ups the one whose deciders send fewer signals is picked, as the engine compares them
    const signals = (clock: PickableClock) => signalsKey(clock.ranking);
    if (tiedOnWakeUps.length > 0 && tiedOnWakeUps.every(other => signals(other) > signals(pick))) {
        return RECOMMENDED_COPY.tieOnSignals(tiedOnWakeUps.length);
    }
    const tiedOnSignals = tiedOnWakeUps.filter(other => signals(other) === signals(pick));
    // then the one that gets back from a loss sooner, before the windows decide
    const recovery = (clock: PickableClock) => clock.ranking.recovery_window_cycles ?? Infinity;
    if (tiedOnSignals.length > 0 && tiedOnSignals.every(other => recovery(other) > recovery(pick))) {
        return RECOMMENDED_COPY.tieOnRecovery(tiedOnSignals.length);
    }
    const tiedOnRecovery = tiedOnSignals.filter(other => recovery(other) === recovery(pick));
    const tiedOnWindows = tiedOnRecovery.filter(other => other.ranking.window_count === pick.ranking.window_count);
    if (tiedOnWindows.length > 0) {
        return RECOMMENDED_COPY.tieOnWindows(tiedOnWindows.length);
    }
    if (tiedOnRecovery.length === 0) {
        return '';
    }
    const fewerOnScreen = tiedOnRecovery.every(other => pick.inserterWindowCount < other.inserterWindowCount);
    return fewerOnScreen
        ? RECOMMENDED_COPY.tieOnWakeUps(tiedOnRecovery.length)
        : RECOMMENDED_COPY.tieOnWakeUpsUncounted(tiedOnRecovery.length);
}

/** Why the pick when no clock qualifies: actual modeled-start rate and sampled starts remain distinct. */
function nearestReason(alternatives: PickableClock[], pick: PickableClock, rate: string, deadlock: boolean): string {
    const { ranking } = pick;
    if (pick.assessment.start_dependence?.verdict === 'start-dependent') {
        return `No clock qualifies under the engine's ranking rule. This one is assessed at ${figure(shownRateOf(pick))}/s and reaches the setpoint from only some sampled starts. See Model and tested starts.`;
    }
    const lead = RECOMMENDED_COPY.noneHolds(rate, deadlock);
    if (ranking.stable_above_target === true) {
        const target = pick.assessment.items_per_second - ranking.rate_off_target;
        return lead + RECOMMENDED_COPY.stableOver(figure(shownRateOf(pick)), percentOf(ranking.rate_off_target / target));
    }
    const counted = ranking.wake_ups_per_minute !== null;
    const near = offTargetKey(ranking.rate_off_target);
    if (near === 0) {
        // at the rate as the selection compares it, so holding the output decided, then the wake-ups
        // the rate it shows: on a loss on a shared lane, what all the copies made, not the target
        return lead + (ranking.holds_expected_output
            ? RECOMMENDED_COPY.atRateHolds(figure(shownRateOf(pick)), counted)
            : RECOMMENDED_COPY.atRateRuns(figure(shownRateOf(pick)), counted));
    }
    const itsRate = figure(shownRateOf(pick));
    const holdsOverEquallyNear = ranking.holds_expected_output && alternatives.some(other => other !== pick
        && offTargetKey(other.ranking.rate_off_target) === near && !other.ranking.holds_expected_output);
    return lead + (itsRate === rate ? RECOMMENDED_COPY.nearest : RECOMMENDED_COPY.nearestAt(itsRate))
        + (holdsOverEquallyNear ? RECOMMENDED_COPY.nearestHolds : '');
}

/** The last line of the Rank column's help: whether the slower searches ran */
export function searchesRunLine(rule: PickRule | null): string {
    return rule?.searchedForFewerWakeUps ? RECOMMENDED_COPY.runSearched : RECOMMENDED_COPY.runSearchedWhenNeeded;
}

/**
 * The clocks in the engine's order, as indexes into `alternatives`: the recommended clock first. The clocks are the
 * worker's combination of every run so far, in the order it lists them, so ranking them as one run gives the order of
 * that combination.
 */
export function rankOrderOf(alternatives: Pick<PickableClock, 'ranking'>[]): number[] {
    return combineClockAlternativeRuns([{ signature: 'ranked', alternatives }], it => it.ranking).order;
}

/**
 * The order of the clock table's rows while a run adds clocks, as the ids of the clocks: the order it held, of the clocks
 * still there, then the clocks that arrived since, by their ranks. A table that holds nothing yet holds the clocks there by
 * their ranks. The worker lists the clocks by their task, so a clock that arrives can move the index of every other one.
 */
export function heldOrderOf(held: readonly string[], alternatives: Pick<ClockAlternativeView, 'id' | 'ranking'>[]): string[] {
    const ranked = rankOrderOf(alternatives).map(index => alternatives[index].id);
    const there = new Set(ranked);
    const kept = held.filter(id => there.has(id));
    const keptIds = new Set(kept);
    return [...kept, ...ranked.filter(id => !keptIds.has(id))];
}

/**
 * The rows of the clock table in two groups, the stable clocks (`isStable`), then the others under a divider, each row
 * with its rank in the engine's order and each group sorted by it, so the ranks run straight through both groups. While
 * a run adds clocks, each group is in the `held` order (heldOrderOf) and each row shows its rank so far.
 */
export function partitionClockRows<T extends Pick<ClockAlternativeView, 'id' | 'ranking'>>(
    alternatives: T[],
    options: {
        /** The Status column says Stable */
        isStable: (alternative: T) => boolean;
        /** While a run adds clocks: the order of the rows, by clock id; a clock it does not name comes after, by rank */
        held?: readonly string[];
    },
): { stable: ClockRow<T>[]; unstable: ClockRow<T>[] } {
    const ranked = rankOrderOf(alternatives).map((index, at) => ({ alternative: alternatives[index], index, rank: at + 1 }));
    const { held } = options;
    const placeOf = (order: readonly string[], id: string) => {
        const at = order.indexOf(id);
        return at === -1 ? order.length : at;
    };
    // a stable sort: the clocks the order does not name keep their ranks' order
    const rows = held === undefined ? ranked : [...ranked].sort((a, b) => placeOf(held, a.alternative.id) - placeOf(held, b.alternative.id));
    return {
        stable: rows.filter(({ alternative }) => options.isStable(alternative)),
        unstable: rows.filter(({ alternative }) => !options.isStable(alternative)),
    };
}

