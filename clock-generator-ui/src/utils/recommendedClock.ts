import type { Config } from 'clock-generator/browser';
import { combineClockAlternativeRuns } from 'clock-generator/light';
import type { ClockAlternativeView } from '../worker/types';

/** What the selection rule is given by the config a generation ran with */
export interface PickRule {
    /** "Belts do not move": every clock is made without belt slack and counts as made for the belt */
    nonMovingBelts: boolean;
    /** "Search for fewer wake-ups": the slower searches ran whether they were needed or not */
    searchedForFewerWakeUps: boolean;
}

/** The fields of a clock the recommendation is worked out from, so the tests need not build a whole view */
type PickableClock = Pick<ClockAlternativeView, 'id' | 'verdict' | 'ranking' | 'beltLabel'> & {
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
    intro: 'Each clock was tested in the simulator. Select a row to see its blueprint and timelines.',
    lead: (label: string) => `Recommended: ${label}.`,
    backToRecommended: 'Back to recommended',
    unstableDivider: 'Unstable clocks',
    disclosureTitle: 'How clocks are chosen',
    disclosure: [
        'Each clock is tested in the simulator, driven only by its wake windows and started at several points. A '
            + 'clock that holds the target rate is then starved (each input stops arriving for a while) and jammed '
            + '(each output stops being taken away for a while), and the build has to get back to its rate by itself. '
            + 'A clock that does all of that is Stable.',
        'The clock picked for you is the Stable one with the fewest wake-ups. If clocks tie, the one with fewer wake '
            + 'windows. If none is Stable, the one that runs nearest to the target rate.',
        'A clock made for a moving belt keeps each belt inserter\'s wake window open a few ticks longer (belt slack). '
            + 'A clock made without it is only picked when no clock for a moving belt holds the rate. With "Belts do '
            + 'not move" on, every clock is made without the slack.',
    ],
    runMovingBelts: 'This run assumed moving belts.',
    runStillBelts: 'This run assumed belts that stand still.',
    runSearched: 'The slower searches for fewer wake-ups were run.',
    runSearchedWhenNeeded: 'The slower searches were only run if no other clock was stable.',
    provisional: 'More clocks are still being made, so this may change. ',
    beltStill: ' with belts that stand still',
    beltMoving: ' on a moving belt',
    fewestWakeUps: (rate: string, belt: string) => `Fewest wake-ups among the clocks that hold ${rate}/s${belt}.`,
    tieOnWakeUps: (others: number) =>
        ` ${othersText(others)} on wake-ups, so the fewest wake windows decided.`,
    tieOnWindows: (others: number) =>
        ` ${othersText(others)} on wake-ups and on wake windows, so the first listed was chosen.`,
    onlyContender: (rate: string, belt: string) => `The only clock that holds ${rate}/s${belt}.`,
    wakeUpsNotCounted: (rate: string, belt: string) =>
        `Fewest wake windows among the clocks that hold ${rate}/s${belt}. Wake-ups could not be counted for them.`,
    recoveryDoesNotDecide: ' The recovery trials do not decide on this build.',
    notForMovingBelt: (rate: string) =>
        `No clock made for a moving belt holds ${rate}/s, so this one, made for belts that stand still, has the `
        + 'fewest wake-ups of those that do. It may fail on a moving belt.',
    nearest: (rate: string, itsRate: string) => `No clock holds ${rate}/s. This one runs nearest to it, at ${itsRate}/s.`,
    nearestHolds: ' Of the equally near clocks, it is the one that holds its output from a clean start.',
};

/** "1 other clock ties" / "2 other clocks tie" */
function othersText(others: number): string {
    return others === 1 ? '1 other clock ties' : `${others} other clocks tie`;
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
    if (!ranking.meets_target_rate) {
        const near = offTargetKey(ranking.rate_off_target);
        const holdsOverEquallyNear = ranking.holds_expected_output && alternatives.some(other => other !== pick
            && offTargetKey(other.ranking.rate_off_target) === near && !other.ranking.holds_expected_output);
        return RECOMMENDED_COPY.nearest(rate, figure(pick.assessment.items_per_second))
            + (holdsOverEquallyNear ? RECOMMENDED_COPY.nearestHolds : '');
    }
    if (!ranking.matches_belt_choice) {
        return RECOMMENDED_COPY.notForMovingBelt(rate);
    }
    const belt = rule?.nonMovingBelts ? RECOMMENDED_COPY.beltStill
        : pick.beltLabel.startsWith('moving') ? RECOMMENDED_COPY.beltMoving : '';
    const others = alternatives.filter(other => other !== pick
        && other.ranking.meets_target_rate && other.ranking.matches_belt_choice);
    // on a build with a deadlock risk a clock that does not recover can hold the rate, and be picked
    const recovery = pick.verdict === 'no recovery' ? RECOMMENDED_COPY.recoveryDoesNotDecide : '';
    if (others.length === 0) {
        return RECOMMENDED_COPY.onlyContender(rate, belt) + recovery;
    }
    // uncounted wake-ups rank after any count, so when the pick's were not counted no contender's were
    if (ranking.wake_ups_per_minute === null) {
        return RECOMMENDED_COPY.wakeUpsNotCounted(rate, belt) + recovery;
    }
    const wakeUps = wakeUpsKey(ranking.wake_ups_per_minute);
    const tiedOnWakeUps = others.filter(other => wakeUpsKey(other.ranking.wake_ups_per_minute) === wakeUps);
    const tiedOnWindows = tiedOnWakeUps.filter(other => other.ranking.window_count === ranking.window_count);
    const tie = tiedOnWindows.length > 0 ? RECOMMENDED_COPY.tieOnWindows(tiedOnWindows.length)
        : tiedOnWakeUps.length > 0 ? RECOMMENDED_COPY.tieOnWakeUps(tiedOnWakeUps.length) : '';
    return RECOMMENDED_COPY.fewestWakeUps(rate, belt) + tie + recovery;
}

/** The "This run" line of "How clocks are chosen": the belt the clocks were made for, and whether the searches ran */
export function disclosureRunLine(rule: PickRule | null): string {
    return `${rule?.nonMovingBelts ? RECOMMENDED_COPY.runStillBelts : RECOMMENDED_COPY.runMovingBelts} `
        + (rule?.searchedForFewerWakeUps ? RECOMMENDED_COPY.runSearched : RECOMMENDED_COPY.runSearchedWhenNeeded);
}

/**
 * The rows of the clock table in two groups: the stable clocks, then the others under a divider, each in list order,
 * so showing the unstable ones never moves a stable row. While the unstable ones are hidden (and something is stable)
 * only the selected and the recommended of them stay.
 */
export function partitionClockRows<T extends Pick<ClockAlternativeView, 'verdict'>>(
    alternatives: T[],
    options: { selectedIndex: number; recommendedIndex: number | null; showUnstable: boolean },
): { stable: ClockRow<T>[]; unstable: ClockRow<T>[]; unstableCount: number; hiddenCount: number; anyStable: boolean } {
    const rows = alternatives.map((alternative, index) => ({ alternative, index }));
    const stable = rows.filter(({ alternative }) => alternative.verdict === 'stable');
    const allUnstable = rows.filter(({ alternative }) => alternative.verdict !== 'stable');
    const anyStable = stable.length > 0;
    // unstable clocks are hidden until asked for, unless nothing is stable: then they are all there is to look at
    const unstable = anyStable && !options.showUnstable
        ? allUnstable.filter(({ index }) => index === options.selectedIndex || index === options.recommendedIndex)
        : allUnstable;
    return {
        stable,
        unstable,
        unstableCount: allUnstable.length,
        hiddenCount: allUnstable.length - unstable.length,
        anyStable,
    };
}
