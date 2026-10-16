import type { Config } from 'clock-generator/browser';
import { combineClockAlternativeRuns } from 'clock-generator/light';
import type { ClockAlternativeView } from '../worker/types';

/** What the selection rule is given by the config a generation ran with */
export interface PickRule {
    /** The input belts are backed up and standing still: every clock is made without belt slack and counts as made for the belt */
    nonMovingBelts: boolean;
    /** "Search for fewer wake-ups": the slower searches ran whether they were needed or not */
    searchedForFewerWakeUps: boolean;
}

/** The fields of a clock the recommendation is worked out from, so the tests need not build a whole view */
type PickableClock = Pick<ClockAlternativeView, 'id' | 'verdict' | 'ranking' | 'beltLabel' | 'deadlockRisk' | 'inserterWindowCount'> & {
    assessment: Pick<ClockAlternativeView['assessment'], 'items_per_second'>;
};

/** A row of the clock table: the clock and its index in the list, which selecting it goes by */
interface ClockRow<T> {
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
        'Each clock is tested in the simulator, driven only by its wake windows and started at several points. A '
            + 'clock that holds the target rate is then starved (each input stops arriving for a while) and jammed '
            + '(each output stops being taken away for a while), and the build has to get back to its rate by itself. '
            + 'A clock that does all of that holds the rate and recovers.',
        'The clock picked for you is the one that holds the rate and recovers with the fewest wake-ups; on a build '
            + 'with a deadlock risk, the one '
            + 'with the fewest wake-ups of the clocks that hold the rate. If clocks tie, the one with fewer wake '
            + 'windows. If none qualifies, the one that runs nearest to the target rate.',
        'A clock made for a moving belt keeps each belt inserter\'s wake window open a few ticks longer (belt slack). '
            + 'A clock made without it is only picked when no clock for a moving belt holds the rate. If you say your '
            + 'input belts are backed up and standing still (Configure, Belts), every clock is made without the slack.',
    ],
    runMovingBelts: 'This run assumed moving belts.',
    runStillBelts: 'This run assumed belts that stand still.',
    runSearched: 'The slower searches for fewer wake-ups were run.',
    runSearchedWhenNeeded: 'The slower searches were only run if no other clock held the rate and recovered.',
    provisional: 'More clocks are still being made, so this may change. ',
    beltStill: ' with belts that stand still',
    beltMoving: ' on a moving belt',
    /**
     * The clocks the pick was compared with: those that hold the rate and recover, or on a build with a deadlock risk
     * those that hold the rate (the glossary's words, not the table's old "Stable")
     */
    contenders: (rate: string, deadlock: boolean) => deadlock ? `the clocks that hold ${rate}/s` : `the clocks that hold ${rate}/s and recover`,
    fewestWakeUps: (contenders: string, belt: string) => `Fewest wake-ups among ${contenders}${belt}.`,
    onlyContender: (rate: string, belt: string, deadlock: boolean) =>
        deadlock ? `The only clock that holds ${rate}/s${belt}.` : `The only clock that holds ${rate}/s and recovers${belt}.`,
    wakeUpsNotCounted: (contenders: string, belt: string) =>
        `Fewest wake windows among ${contenders}${belt}. Wake-ups could not be counted for them.`,
    tieOnWakeUps: (others: number, kind: string) =>
        ` ${othersText(others, kind)} on wake-ups, so the one with fewer wake windows was picked.`,
    tieOnWakeUpsUncounted: (others: number, kind: string) =>
        ` ${othersText(others, kind)} on wake-ups, so the one with fewer wake windows was picked, not counting the `
        + 'extra wake windows that only cut wake-ups.',
    tieOnWindows: (others: number, kind: string) =>
        ` ${othersText(others, kind)} on wake-ups and on wake windows, so the first listed was picked.`,
    tieKindMoving: ' for a moving belt',
    recoveryDoesNotDecide: ' The recovery trials do not decide on this build.',
    noneForMovingBelt: (rate: string, deadlock: boolean) => deadlock
        ? `No clock made for a moving belt holds ${rate}/s.`
        : `No clock made for a moving belt holds ${rate}/s and recovers.`,
    stillOnly: ' This one, made for belts that stand still, does.',
    stillFewestWakeUps: ' Of those made for belts that stand still, this one has the fewest wake-ups.',
    stillWakeUpsNotCounted: ' Of those made for belts that stand still, this one has the fewest wake windows; wake-ups '
        + 'could not be counted for them.',
    mayFailOnMovingBelt: ' It may fail on a moving belt.',
    noneHolds: (rate: string, deadlock: boolean) => deadlock ? `No clock holds ${rate}/s.` : `No clock holds ${rate}/s and recovers.`,
    atRateHolds: (rate: string, fewest: boolean) =>
        ` This one holds ${rate}/s from a clean start${fewest ? ' with the fewest wake-ups' : ''}.`,
    atRateRuns: (rate: string, fewest: boolean) => ` This one runs at ${rate}/s${fewest ? ' with the fewest wake-ups' : ''}.`,
    nearest: ' This one runs nearest to it.',
    nearestAt: (itsRate: string) => ` This one runs nearest to it, at ${itsRate}/s.`,
    nearestHolds: ' Of the equally near clocks, it is the one that holds its output from a clean start.',
};

/** "1 other clock for a moving belt ties" / "2 other clocks tie" */
function othersText(others: number, kind: string): string {
    return others === 1 ? `1 other clock${kind} ties` : `${others} other clocks${kind} tie`;
}

/** As the rate warning prints a rate: 240, 12.5, 0.33 */
const figure = (rate: number) => Number(rate.toFixed(2)).toString();

/** Wake-ups as the selection compares them: to a thousandth */
const wakeUpsKey = (wakeUps: number | null) => wakeUps === null ? null : Math.round(wakeUps * 1000);

/** Rate off the target as the selection compares it: to a thousandth of an item a second */
const offTargetKey = (rateOffTarget: number) => Math.round(Math.abs(rateOffTarget) * 1000);

export function pickRuleOf(config: Config): PickRule {
    return {
        nonMovingBelts: config.overrides?.non_moving_belts === true,
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
 * the clocks are still being made (`final` false) it says the pick may change. Empty when nothing is recommended.
 */
export function recommendationReason(
    alternatives: PickableClock[],
    recommendedIndex: number | null,
    rule: PickRule | null,
    final: boolean,
): string {
    const pick = recommendedIndex === null ? undefined : alternatives[recommendedIndex];
    if (!pick) {
        return '';
    }
    const reason = reasonOf(alternatives, pick, rule);
    return final ? reason : RECOMMENDED_COPY.provisional + reason;
}

function reasonOf(alternatives: PickableClock[], pick: PickableClock, rule: PickRule | null): string {
    const { ranking } = pick;
    const rate = figure(pick.assessment.items_per_second - ranking.rate_off_target);
    // on a build with a deadlock risk a clock that holds the rate meets it, recovering or not; elsewhere it is Stable
    const deadlock = pick.deadlockRisk !== null;
    if (!ranking.meets_target_rate) {
        return nearestReason(alternatives, pick, rate, deadlock);
    }
    const recovery = pick.verdict === 'no recovery' ? RECOMMENDED_COPY.recoveryDoesNotDecide : '';
    if (!ranking.matches_belt_choice) {
        // only picked when no clock made for the belt meets the rate, so it beat the others made without the slack
        const others = alternatives.filter(other => other !== pick && other.ranking.meets_target_rate);
        const contest = others.length === 0 ? RECOMMENDED_COPY.stillOnly
            : ranking.wake_ups_per_minute === null ? RECOMMENDED_COPY.stillWakeUpsNotCounted
                : RECOMMENDED_COPY.stillFewestWakeUps + tieOf(pick, others, '');
        return RECOMMENDED_COPY.noneForMovingBelt(rate, deadlock) + contest + RECOMMENDED_COPY.mayFailOnMovingBelt + recovery;
    }
    const moving = !rule?.nonMovingBelts && pick.beltLabel.startsWith('moving');
    const belt = rule?.nonMovingBelts ? RECOMMENDED_COPY.beltStill : moving ? RECOMMENDED_COPY.beltMoving : '';
    const others = alternatives.filter(other => other !== pick
        && other.ranking.meets_target_rate && other.ranking.matches_belt_choice);
    if (others.length === 0) {
        return RECOMMENDED_COPY.onlyContender(rate, belt, deadlock) + recovery;
    }
    const contenders = RECOMMENDED_COPY.contenders(rate, deadlock);
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
    const tiedOnWindows = tiedOnWakeUps.filter(other => other.ranking.window_count === pick.ranking.window_count);
    if (tiedOnWindows.length > 0) {
        return RECOMMENDED_COPY.tieOnWindows(tiedOnWindows.length, kind);
    }
    if (tiedOnWakeUps.length === 0) {
        return '';
    }
    const fewerOnScreen = tiedOnWakeUps.every(other => pick.inserterWindowCount < other.inserterWindowCount);
    return fewerOnScreen
        ? RECOMMENDED_COPY.tieOnWakeUps(tiedOnWakeUps.length, kind)
        : RECOMMENDED_COPY.tieOnWakeUpsUncounted(tiedOnWakeUps.length, kind);
}

/** Why the pick when no clock meets the target rate: it runs at the rate from a clean start, or the nearest to it */
function nearestReason(alternatives: PickableClock[], pick: PickableClock, rate: string, deadlock: boolean): string {
    const { ranking } = pick;
    const lead = RECOMMENDED_COPY.noneHolds(rate, deadlock);
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
    return `${rule?.nonMovingBelts ? RECOMMENDED_COPY.runStillBelts : RECOMMENDED_COPY.runMovingBelts} `
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
