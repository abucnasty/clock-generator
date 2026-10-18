import { describe, expect, it } from 'vitest';
import type { ClockRanking, ClockVerdict, Config } from 'clock-generator/browser';
import { combineClockAlternativeRuns } from 'clock-generator/light';
import {
    RECOMMENDED_COPY,
    disclosureRunLine,
    groupClockRowsByBelt,
    partitionClockRows,
    pickRuleOf,
    recommendationReason,
    recommendedIndexOf,
    type PickRule,
} from './recommendedClock';

interface Clock {
    id: string;
    verdict: ClockVerdict;
    beltLabel: string;
    deadlockRisk: string | null;
    inserterWindowCount: number;
    ranking: ClockRanking;
    assessment: { items_per_second: number };
}

const TARGET = 240;

interface ClockOptions extends Partial<ClockRanking> {
    verdict?: ClockVerdict;
    beltLabel?: string;
    /** The build has a deadlock risk */
    deadlock?: boolean;
    /** The windows the table shows; the ranking's `window_count` unless given */
    shownWindows?: number;
}

/**
 * A stable clock at the target rate on a moving belt, made for it, with 10 wake-ups and 4 windows, on a build without a
 * deadlock risk, unless told otherwise
 */
function clock(id: string, options: ClockOptions = {}): Clock {
    const { verdict = 'stable', beltLabel = 'moving (+4 ticks)', deadlock = false, shownWindows, ...ranking } = options;
    const full: ClockRanking = {
        meets_target_rate: true,
        rate_off_target: 0,
        holds_expected_output: true,
        matches_belt_choice: true,
        wake_ups_per_minute: 10,
        window_count: 4,
        ...ranking,
    };
    return {
        id,
        verdict,
        beltLabel,
        deadlockRisk: deadlock ? 'Deadlock risk: inserters 1 and 2 both bring the same item.' : null,
        inserterWindowCount: shownWindows ?? full.window_count,
        ranking: full,
        assessment: { items_per_second: TARGET + full.rate_off_target },
    };
}

/** A clock that does not meet the target rate: `off` items a second from it */
const short = (id: string, off: number, holds = true, options: ClockOptions = {}) => clock(id, {
    meets_target_rate: false,
    rate_off_target: off,
    holds_expected_output: holds,
    verdict: holds ? 'no recovery' : 'unstable',
    ...options,
});

const MOVING: PickRule = { nonMovingBelts: false, searchedForFewerWakeUps: false };
const STILL: PickRule = { nonMovingBelts: true, searchedForFewerWakeUps: false };

const ids = <T extends { id: string }>(clocks: T[], index: number | null) => index === null ? null : clocks[index].id;

/** The reason for the clock the rule picks from `clocks`, after the run */
const reason = (clocks: Clock[], rule: PickRule | null = MOVING) =>
    recommendationReason(clocks, recommendedIndexOf(clocks), rule, true);

describe('recommendedIndexOf', () => {
    it('is null for no clocks', () => {
        expect(recommendedIndexOf([])).toBeNull();
    });

    it('picks the fewest wake-ups among the clocks that hold the rate', () => {
        const clocks = [clock('a', { wake_ups_per_minute: 12 }), short('near', 0.5), clock('b', { wake_ups_per_minute: 8 })];
        expect(ids(clocks, recommendedIndexOf(clocks))).toBe('b');
    });

    it('puts a clock not made for the belt behind one that is, and picks it when no such clock holds the rate', () => {
        const wrongBelt = clock('slackless', { matches_belt_choice: false, wake_ups_per_minute: 2 });
        const clocks = [wrongBelt, clock('moving', { wake_ups_per_minute: 9 })];
        expect(ids(clocks, recommendedIndexOf(clocks))).toBe('moving');
        const without = [wrongBelt, short('near', 1)];
        expect(ids(without, recommendedIndexOf(without))).toBe('slackless');
    });

    it('picks the nearest to the target rate when none holds it', () => {
        const clocks = [short('far', -3), short('near', 0.4), short('above', 2)];
        expect(ids(clocks, recommendedIndexOf(clocks))).toBe('near');
    });

    it('breaks a tie on wake-ups with the fewest windows, then the first listed', () => {
        const byWindows = [clock('a', { window_count: 6 }), clock('b', { window_count: 3 })];
        expect(ids(byWindows, recommendedIndexOf(byWindows))).toBe('b');
        const listed = [clock('first'), clock('second')];
        expect(ids(listed, recommendedIndexOf(listed))).toBe('first');
    });

    it('equals what the engine selects for the same clocks split over several runs', () => {
        const runs = [
            { signature: 'batched', alternatives: [clock('a', { wake_ups_per_minute: 15 }), short('b', 1)] },
            { signature: 'uneven', alternatives: [clock('c', { wake_ups_per_minute: 7, window_count: 9 })] },
            { signature: 'shifted', alternatives: [clock('d', { wake_ups_per_minute: 7, window_count: 5 }), clock('e', { matches_belt_choice: false, wake_ups_per_minute: 1 })] },
        ];
        const engine = combineClockAlternativeRuns([runs[2], null, runs[0], runs[1]], it => it.ranking);
        expect(recommendedIndexOf(engine.alternatives)).toBe(engine.selected_index);
        expect(engine.alternatives[engine.selected_index].id).toBe('d');
    });

    it('follows the winning clock, not its place, when an earlier-ordered clock is put ahead of it', () => {
        const winner = clock('winner', { wake_ups_per_minute: 5 });
        const before = [clock('a'), winner];
        const after = [clock('late', { wake_ups_per_minute: 20 }), clock('a'), winner];
        expect(recommendedIndexOf(before)).toBe(1);
        expect(recommendedIndexOf(after)).toBe(2);
        expect(ids(after, recommendedIndexOf(after))).toBe('winner');
    });
});

describe('recommendationReason', () => {
    const others = [clock('b', { wake_ups_per_minute: 20 }), clock('c', { wake_ups_per_minute: 30 })];

    it('says the pick has the fewest wake-ups among the clocks that hold the rate and recover on a moving belt', () => {
        expect(reason([clock('a'), ...others])).toBe('Fewest wake-ups among the clocks that hold 240/s and recover on a moving belt.');
    });

    it('says "hold" only on a build with a deadlock risk, where a clock that holds the rate counts without recovering', () => {
        const risky = [clock('a', { deadlock: true }), clock('b', { deadlock: true, wake_ups_per_minute: 20 })];
        expect(reason(risky)).toBe('Fewest wake-ups among the clocks that hold 240/s on a moving belt.');
    });

    it('says the belts stand still when the build says so', () => {
        const still = [clock('a', { beltLabel: 'non-moving' }), ...others];
        expect(reason(still, STILL)).toBe('Fewest wake-ups among the clocks that hold 240/s and recover with backed-up belts.');
    });

    it('leaves the belt out when no clocked inserter picks up from a belt', () => {
        expect(reason([clock('a', { beltLabel: '' }), ...others])).toBe('Fewest wake-ups among the clocks that hold 240/s and recover.');
    });

    it('leaves the belt out for a subtick clock, made for a non-moving belt, on a build with moving belts', () => {
        expect(reason([clock('subtick', { beltLabel: 'non-moving' }), ...others]))
            .toBe('Fewest wake-ups among the clocks that hold 240/s and recover.');
    });

    describe('a clock made for backed-up belts, picked because none for a moving belt meets the rate', () => {
        const still = (id: string, options: ClockOptions = {}) =>
            clock(id, { matches_belt_choice: false, beltLabel: 'non-moving', ...options });

        it('says it is the only one when it is', () => {
            expect(reason([still('slackless'), short('b', 1)]))
                .toBe('No clock made for a moving belt holds 240/s and recovers. This one, made for backed-up belts, '
                    + 'does. It may fail on a moving belt.');
        });

        it('says it has the fewest wake-ups of those that do', () => {
            expect(reason([still('a', { wake_ups_per_minute: 30 }), still('b'), short('c', 1)]))
                .toBe('No clock made for a moving belt holds 240/s and recovers. Of those made for backed-up belts, '
                    + 'this one has the fewest wake-ups. It may fail on a moving belt.');
        });

        it('says what broke a tie on wake-ups', () => {
            expect(reason([still('a', { window_count: 3 }), still('b')]))
                .toBe('No clock made for a moving belt holds 240/s and recovers. Of those made for backed-up belts, '
                    + 'this one has the fewest wake-ups. 1 other clock ties on wake-ups, so the one with fewer wake '
                    + 'windows was picked. It may fail on a moving belt.');
        });

        it('adds the recovery note on a build with a deadlock risk', () => {
            expect(reason([still('a', { deadlock: true, verdict: 'no recovery' })]))
                .toBe('No clock made for a moving belt holds 240/s. This one, made for backed-up belts, does. It '
                    + 'may fail on a moving belt. The recovery trials do not decide on this build.');
        });
    });

    describe('when no clock meets the rate', () => {
        it('says how near the pick runs', () => {
            expect(reason([short('far', -3), short('near', -0.5)]))
                .toBe('No clock holds 240/s and recovers. This one runs nearest to it, at 239.5/s.');
        });

        it('says the pick holds its output when an equally near clock does not', () => {
            expect(reason([short('drifts', -0.5, false), short('holds', 0.5)]))
                .toBe('No clock holds 240/s and recovers. This one runs nearest to it, at 240.5/s. Of the equally near '
                    + 'clocks, it is the one that holds its output from the modeled cold start.');
        });

        it('does not say so when no other clock is equally near', () => {
            expect(reason([short('drifts', -2, false), short('holds', 0.5)]))
                .toBe('No clock holds 240/s and recovers. This one runs nearest to it, at 240.5/s.');
        });

        it('does not call a clock at the target rate the nearest: it holds the rate from a clean start', () => {
            const atRate = [short('more', 0, true, { wake_ups_per_minute: 30 }), short('fewer', 0), short('far', -2)];
            expect(reason(atRate)).toBe('No clock holds 240/s and recovers. This one holds 240/s from the modeled cold start with '
                + 'the fewest wake-ups.');
        });

        it('says a clock at the rate that does not hold its output only runs at it', () => {
            expect(reason([short('drifts', 0, false)])).toBe('No clock holds 240/s and recovers. This one runs at 240/s with the fewest wake-ups.');
            expect(reason([short('uncounted', 0, true, { wake_ups_per_minute: null })]))
                .toBe('No clock holds 240/s and recovers. This one holds 240/s from the modeled cold start.');
        });

        it('does not print the same rate twice when the pick is off by less than the printed figure', () => {
            expect(reason([short('close', 0.002)])).toBe('No clock holds 240/s and recovers. This one runs nearest to it.');
        });

        it('says no clock holds the rate on a build with a deadlock risk', () => {
            expect(reason([short('near', -0.5, false, { deadlock: true })]))
                .toBe('No clock holds 240/s. This one runs nearest to it, at 239.5/s.');
        });
    });

    it('adds that the recovery trials do not decide for a clock that holds the rate without recovering', () => {
        const risky = [clock('a', { deadlock: true, verdict: 'no recovery' }), clock('b', { deadlock: true, wake_ups_per_minute: 20 })];
        expect(reason(risky))
            .toBe('Fewest wake-ups among the clocks that hold 240/s on a moving belt. The recovery trials do not decide on this build.');
    });

    it('says how many clocks for a moving belt tie on wake-ups and that the one with fewer wake windows was picked', () => {
        expect(reason([clock('a', { window_count: 3 }), clock('b', { wake_ups_per_minute: 10.0004 }), ...others]))
            .toBe('Fewest wake-ups among the clocks that hold 240/s and recover on a moving belt. 1 other clock for a moving belt '
                + 'ties on wake-ups, so the one with fewer wake windows was picked.');
        expect(reason([clock('a', { window_count: 3 }), clock('b'), clock('c', { window_count: 8 })]))
            .toBe('Fewest wake-ups among the clocks that hold 240/s and recover on a moving belt. 2 other clocks for a moving belt '
                + 'tie on wake-ups, so the one with fewer wake windows was picked.');
    });

    it('says the windows are counted without the extra ones when the table does not show the pick with fewer', () => {
        expect(reason([clock('a', { window_count: 3, shownWindows: 7 }), clock('b', { window_count: 4, shownWindows: 6 })]))
            .toBe('Fewest wake-ups among the clocks that hold 240/s and recover on a moving belt. 1 other clock for a moving belt '
                + 'ties on wake-ups, so the one with fewer wake windows was picked, not counting the extra wake windows that '
                + 'only cut wake-ups.');
    });

    it('leaves the belt out of the tie with backed-up belts', () => {
        expect(reason([clock('a', { window_count: 3, beltLabel: 'non-moving' }), clock('b', { beltLabel: 'non-moving' })], STILL))
            .toBe('Fewest wake-ups among the clocks that hold 240/s and recover with backed-up belts. 1 other clock ties on '
                + 'wake-ups, so the one with fewer wake windows was picked.');
    });

    it('says the first listed was picked when the windows tie too', () => {
        expect(reason([clock('a'), clock('b'), ...others]))
            .toBe('Fewest wake-ups among the clocks that hold 240/s and recover on a moving belt. 1 other clock for a moving belt '
                + 'ties on wake-ups and on wake windows, so the first listed was picked.');
    });

    it('says when the pick is the only clock that holds the rate and recovers', () => {
        expect(reason([short('b', 1), clock('a'), short('c', -1)])).toBe('The only clock that holds 240/s and recovers on a moving belt.');
        expect(reason([clock('a', { deadlock: true }), short('b', 1)])).toBe('The only clock that holds 240/s on a moving belt.');
    });

    it('goes by the windows when the wake-ups were not counted', () => {
        expect(reason([clock('a', { wake_ups_per_minute: null, window_count: 3 }), clock('b', { wake_ups_per_minute: null })]))
            .toBe('Fewest wake windows among the clocks that hold 240/s and recover on a moving belt. Wake-ups could not be counted for them.');
    });

    it('says the pick may change while clocks are still being made, and not after', () => {
        const clocks = [clock('a'), ...others];
        expect(recommendationReason(clocks, 0, MOVING, false))
            .toBe('More clocks are still being made, so this may change. Fewest wake-ups among the clocks that hold 240/s and recover on a moving belt.');
        expect(recommendationReason(clocks, 0, MOVING, true)).not.toContain('still being made');
    });

    it('says a better clock may not have been made after a run the player stopped', () => {
        const clocks = [clock('a'), ...others];
        expect(recommendationReason(clocks, 0, MOVING, false, true))
            .toBe('You stopped this run early, so a better clock may not have been made yet. Fewest wake-ups among the clocks that hold 240/s and recover on a moving belt.');
    });

    it('is empty when nothing is recommended', () => {
        expect(recommendationReason([], null, MOVING, true)).toBe('');
        expect(recommendationReason([clock('a')], null, MOVING, false)).toBe('');
    });

    it('prints the target rate as the rate warning does', () => {
        const at = (rate: number) => [{ ...clock('a'), assessment: { items_per_second: rate } }];
        expect(reason(at(240))).toBe('The only clock that holds 240/s and recovers on a moving belt.');
        expect(reason(at(12.5))).toBe('The only clock that holds 12.5/s and recovers on a moving belt.');
        expect(reason(at(1 / 3))).toBe('The only clock that holds 0.33/s and recovers on a moving belt.');
    });

    it('does not change with the search mode, which only changes which clocks there are', () => {
        const clocks = [clock('a'), ...others];
        expect(reason(clocks, { ...MOVING, searchedForFewerWakeUps: true })).toBe(reason(clocks, MOVING));
    });

    it('reads a missing rule as moving belts', () => {
        expect(reason([clock('a'), ...others], null)).toBe(reason([clock('a'), ...others], MOVING));
    });
});

describe('RECOMMENDED_COPY', () => {
    it('says "Best so far" and offers "Back to the pick" while clocks are still being made', () => {
        expect(RECOMMENDED_COPY.chipWhileGenerating).toBe('Best so far');
        expect(RECOMMENDED_COPY.backWhileGenerating).toBe('Back to the pick');
    });

    it('says in "How clocks are chosen" what is picked on a build with a deadlock risk', () => {
        expect(RECOMMENDED_COPY.disclosure[1]).toContain('on a build with a deadlock risk, the one with the fewest wake-ups of the clocks that hold the rate');
    });
});

describe('disclosureRunLine', () => {
    it('says the belt the clocks were made for and whether the searches ran', () => {
        expect(disclosureRunLine(MOVING)).toBe('This run assumed moving belts. The slower searches were only run if no other clock held the rate and recovered.');
        expect(disclosureRunLine(STILL)).toBe('This run assumed backed-up belts. The slower searches were only run if no other clock held the rate and recovered.');
        expect(disclosureRunLine({ nonMovingBelts: false, searchedForFewerWakeUps: true }))
            .toBe('This run assumed moving belts. The slower searches for fewer wake-ups were run.');
        expect(disclosureRunLine({ nonMovingBelts: true, searchedForFewerWakeUps: true }))
            .toBe('This run assumed backed-up belts. The slower searches for fewer wake-ups were run.');
        expect(disclosureRunLine(null)).toBe(disclosureRunLine(MOVING));
    });
});

describe('pickRuleOf', () => {
    const config = (overrides?: Config['overrides']) => ({ overrides }) as Config;

    it('reads the belts and the search mode from the overrides', () => {
        expect(pickRuleOf(config())).toEqual(MOVING);
        expect(pickRuleOf(config({ non_moving_belts: true }))).toEqual(STILL);
        expect(pickRuleOf(config({ search_for_fewer_wake_ups: true }))).toEqual({ nonMovingBelts: false, searchedForFewerWakeUps: true });
        expect(pickRuleOf(config({ non_moving_belts: false, search_for_fewer_wake_ups: false }))).toEqual(MOVING);
    });
});

describe('partitionClockRows', () => {
    const rowsOf = (verdicts: ClockVerdict[]) => verdicts.map((verdict, index) => ({ id: `clock-${index}`, verdict }));
    // 0 stable, 1 unstable, 2 stable, 3 no recovery, 4 unstable
    const clocks = rowsOf(['stable', 'unstable', 'stable', 'no recovery', 'unstable']);
    const indexes = (rows: { index: number }[]) => rows.map(it => it.index);

    it('puts the stable clocks first and the others after, each in list order, with no recovery among the others', () => {
        const rows = partitionClockRows(clocks, { selectedIndex: 0, recommendedIndex: 0, showUnstable: true });
        expect(indexes(rows.stable)).toEqual([0, 2]);
        expect(indexes(rows.unstable)).toEqual([1, 3, 4]);
        expect(rows.unstableCount).toBe(3);
        expect(rows.hiddenCount).toBe(0);
        expect(rows.anyStable).toBe(true);
    });

    it('keeps only the selected and the recommended unstable clocks while the others are hidden', () => {
        const rows = partitionClockRows(clocks, { selectedIndex: 4, recommendedIndex: 0, showUnstable: false });
        expect(indexes(rows.stable)).toEqual([0, 2]);
        expect(indexes(rows.unstable)).toEqual([4]);
        expect(rows.hiddenCount).toBe(2);
        expect(rows.unstableCount).toBe(3);
    });

    it('keeps the recommended clock when it is not stable', () => {
        const rows = partitionClockRows(clocks, { selectedIndex: 0, recommendedIndex: 3, showUnstable: false });
        expect(indexes(rows.unstable)).toEqual([3]);
        expect(rows.hiddenCount).toBe(2);
    });

    it('keeps the rows that stayed while hidden first under the divider once the others are shown (utility science)', () => {
        // unstable rows at 2 and 3 come before the recommended no-recovery row at 5 in the list
        const utility = rowsOf(['stable', 'stable', 'unstable', 'unstable', 'stable', 'no recovery', 'unstable']);
        const hidden = partitionClockRows(utility, { selectedIndex: 0, recommendedIndex: 5, showUnstable: false });
        expect(indexes(hidden.unstable)).toEqual([5]);
        const shown = partitionClockRows(utility, {
            selectedIndex: 0, recommendedIndex: 5, showUnstable: true, pinnedIds: hidden.unstable.map(row => row.alternative.id),
        });
        expect(indexes(shown.unstable)).toEqual([5, 2, 3, 6]);
        // with an unstable row selected too, both stay in place, the recommended first
        const both = partitionClockRows(utility, { selectedIndex: 3, recommendedIndex: 5, showUnstable: false });
        expect(indexes(both.unstable)).toEqual([5, 3]);
        expect(indexes(partitionClockRows(utility, {
            selectedIndex: 3, recommendedIndex: 5, showUnstable: true, pinnedIds: both.unstable.map(row => row.alternative.id),
        }).unstable)).toEqual([5, 3, 2, 6]);
    });

    it('puts the recommended clock first in its group, the others in list order', () => {
        const rows = partitionClockRows(clocks, { selectedIndex: 0, recommendedIndex: 2, showUnstable: true });
        expect(indexes(rows.stable)).toEqual([2, 0]);
        expect(indexes(rows.unstable)).toEqual([1, 3, 4]);
    });

    it('keeps list order while a run can still change the pick', () => {
        const rows = partitionClockRows(clocks, { selectedIndex: 0, recommendedIndex: 2, showUnstable: true, recommendedFirst: false });
        expect(indexes(rows.stable)).toEqual([0, 2]);
    });

    it('shows every clock in one group when none is stable', () => {
        const none = rowsOf(['unstable', 'no recovery']);
        const rows = partitionClockRows(none, { selectedIndex: 1, recommendedIndex: 1, showUnstable: false });
        expect(rows.stable).toEqual([]);
        expect(indexes(rows.unstable)).toEqual([1, 0]);
        expect(rows.anyStable).toBe(false);
        expect(rows.hiddenCount).toBe(0);
        expect(rows.unstableCount).toBe(2);
    });
});

describe('belt grouping after global eligibility', () => {
    it('retains original indexes, recommendation order and selected exceptions without exposing hidden clocks in another belt group', () => {
        const clocks = [
            clock('stable', { verdict: 'stable', matches_belt_choice: true }),
            clock('hidden-other-belt', { verdict: 'unstable', matches_belt_choice: false }),
            clock('selected-other-belt', { verdict: 'unstable', matches_belt_choice: false }),
            clock('recommended', { verdict: 'stable', matches_belt_choice: true }),
        ];
        const rows = partitionClockRows(clocks, { selectedIndex: 2, recommendedIndex: 3, showUnstable: false });
        const stable = groupClockRowsByBelt(rows.stable);
        const other = groupClockRowsByBelt(rows.unstable);
        expect(stable.matches.map(row => row.index)).toEqual([3, 0]);
        expect(other.requiresChange.map(row => row.index)).toEqual([2]);
        expect(other.requiresChange[0]).toBe(rows.unstable[0]);
        expect(stable.requiresChange).toEqual([]);
        expect(rows.hiddenCount).toBe(1);
    });
});
