import { describe, expect, it } from 'vitest';
import type { ClockRanking, ClockVerdict, Config } from 'clock-generator/browser';
import { combineClockAlternativeRuns } from 'clock-generator/light';
import {
    disclosureRunLine,
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
    ranking: ClockRanking;
    assessment: { items_per_second: number };
}

const TARGET = 240;

/** A stable clock at the target rate on a moving belt, made for it, with 10 wake-ups and 4 windows, unless told otherwise */
function clock(id: string, overrides: Partial<ClockRanking> & { verdict?: ClockVerdict; beltLabel?: string } = {}): Clock {
    const { verdict = 'stable', beltLabel = 'moving (+4 ticks)', ...ranking } = overrides;
    const full: ClockRanking = {
        meets_target_rate: true,
        rate_off_target: 0,
        holds_expected_output: true,
        matches_belt_choice: true,
        wake_ups_per_minute: 10,
        window_count: 4,
        ...ranking,
    };
    return { id, verdict, beltLabel, ranking: full, assessment: { items_per_second: TARGET + full.rate_off_target } };
}

/** A clock that does not hold the target rate: `off` items a second from it */
const short = (id: string, off: number, holds = true) => clock(id, {
    meets_target_rate: false,
    rate_off_target: off,
    holds_expected_output: holds,
    verdict: holds ? 'no recovery' : 'unstable',
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

    it('says the pick has the fewest wake-ups among the clocks that hold the rate on a moving belt', () => {
        expect(reason([clock('a'), ...others])).toBe('Fewest wake-ups among the clocks that hold 240/s on a moving belt.');
    });

    it('says the belts stand still when the build says so', () => {
        const still = [clock('a', { beltLabel: 'non-moving' }), ...others];
        expect(reason(still, STILL)).toBe('Fewest wake-ups among the clocks that hold 240/s with belts that stand still.');
    });

    it('leaves the belt out when no clocked inserter picks up from a belt', () => {
        expect(reason([clock('a', { beltLabel: '' }), ...others])).toBe('Fewest wake-ups among the clocks that hold 240/s.');
    });

    it('leaves the belt out for a subtick clock, made for a non-moving belt, on a build with moving belts', () => {
        expect(reason([clock('subtick', { beltLabel: 'non-moving' }), ...others]))
            .toBe('Fewest wake-ups among the clocks that hold 240/s.');
    });

    it('says when the pick is not made for a moving belt because no such clock holds the rate', () => {
        expect(reason([clock('slackless', { matches_belt_choice: false, beltLabel: 'non-moving' }), short('b', 1)]))
            .toBe('No clock made for a moving belt holds 240/s, so this one, made for belts that stand still, has the '
                + 'fewest wake-ups of those that do. It may fail on a moving belt.');
    });

    it('says how near the pick runs when no clock holds the rate', () => {
        expect(reason([short('far', -3), short('near', -0.5)])).toBe('No clock holds 240/s. This one runs nearest to it, at 239.5/s.');
    });

    it('says the pick holds its output when an equally near clock does not', () => {
        expect(reason([short('drifts', -0.5, false), short('holds', 0.5)]))
            .toBe('No clock holds 240/s. This one runs nearest to it, at 240.5/s. Of the equally near clocks, it is the '
                + 'one that holds its output from a clean start.');
    });

    it('does not say so when no other clock is equally near', () => {
        expect(reason([short('drifts', -2, false), short('holds', 0.5)])).toBe('No clock holds 240/s. This one runs nearest to it, at 240.5/s.');
    });

    it('adds that the recovery trials do not decide for a clock that holds the rate without recovering', () => {
        expect(reason([clock('a', { verdict: 'no recovery' }), ...others]))
            .toBe('Fewest wake-ups among the clocks that hold 240/s on a moving belt. The recovery trials do not decide on this build.');
    });

    it('says how many clocks tie on wake-ups and that the windows decided', () => {
        expect(reason([clock('a', { window_count: 3 }), clock('b', { wake_ups_per_minute: 10.0004 }), ...others]))
            .toBe('Fewest wake-ups among the clocks that hold 240/s on a moving belt. 1 other clock ties on wake-ups, so '
                + 'the fewest wake windows decided.');
        expect(reason([clock('a', { window_count: 3 }), clock('b'), clock('c', { window_count: 8 })]))
            .toBe('Fewest wake-ups among the clocks that hold 240/s on a moving belt. 2 other clocks tie on wake-ups, so '
                + 'the fewest wake windows decided.');
    });

    it('says the first listed was chosen when the windows tie too', () => {
        expect(reason([clock('a'), clock('b'), ...others]))
            .toBe('Fewest wake-ups among the clocks that hold 240/s on a moving belt. 1 other clock ties on wake-ups and '
                + 'on wake windows, so the first listed was chosen.');
    });

    it('says when the pick is the only clock that holds the rate', () => {
        expect(reason([short('b', 1), clock('a'), short('c', -1)])).toBe('The only clock that holds 240/s on a moving belt.');
    });

    it('goes by the windows when the wake-ups were not counted', () => {
        expect(reason([clock('a', { wake_ups_per_minute: null, window_count: 3 }), clock('b', { wake_ups_per_minute: null })]))
            .toBe('Fewest wake windows among the clocks that hold 240/s on a moving belt. Wake-ups could not be counted for them.');
    });

    it('says the pick may change while clocks are still being made, and not after', () => {
        const clocks = [clock('a'), ...others];
        expect(recommendationReason(clocks, 0, MOVING, false))
            .toBe('More clocks are still being made, so this may change. Fewest wake-ups among the clocks that hold 240/s on a moving belt.');
        expect(recommendationReason(clocks, 0, MOVING, true)).not.toContain('still being made');
    });

    it('is empty when nothing is recommended', () => {
        expect(recommendationReason([], null, MOVING, true)).toBe('');
        expect(recommendationReason([clock('a')], null, MOVING, false)).toBe('');
    });

    it('prints the target rate as the rate warning does', () => {
        const at = (rate: number) => {
            const pick = clock('a');
            return [{ ...pick, assessment: { items_per_second: rate } }];
        };
        expect(reason(at(240))).toBe('The only clock that holds 240/s on a moving belt.');
        expect(reason(at(12.5))).toBe('The only clock that holds 12.5/s on a moving belt.');
        expect(reason(at(1 / 3))).toBe('The only clock that holds 0.33/s on a moving belt.');
    });

    it('does not change with the search mode, which only changes which clocks there are', () => {
        const clocks = [clock('a'), ...others];
        expect(reason(clocks, { ...MOVING, searchedForFewerWakeUps: true })).toBe(reason(clocks, MOVING));
    });

    it('reads a missing rule as moving belts', () => {
        expect(reason([clock('a'), ...others], null)).toBe(reason([clock('a'), ...others], MOVING));
    });
});

describe('disclosureRunLine', () => {
    it('says the belt the clocks were made for and whether the searches ran', () => {
        expect(disclosureRunLine(MOVING)).toBe('This run assumed moving belts. The slower searches were only run if no other clock was stable.');
        expect(disclosureRunLine(STILL)).toBe('This run assumed belts that stand still. The slower searches were only run if no other clock was stable.');
        expect(disclosureRunLine({ nonMovingBelts: false, searchedForFewerWakeUps: true }))
            .toBe('This run assumed moving belts. The slower searches for fewer wake-ups were run.');
        expect(disclosureRunLine({ nonMovingBelts: true, searchedForFewerWakeUps: true }))
            .toBe('This run assumed belts that stand still. The slower searches for fewer wake-ups were run.');
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
    const row = (verdict: ClockVerdict) => ({ verdict });
    // 0 stable, 1 unstable, 2 stable, 3 no recovery, 4 unstable
    const clocks = [row('stable'), row('unstable'), row('stable'), row('no recovery'), row('unstable')];
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

    it('shows every clock in one group when none is stable', () => {
        const none = [row('unstable'), row('no recovery')];
        const rows = partitionClockRows(none, { selectedIndex: 1, recommendedIndex: 1, showUnstable: false });
        expect(rows.stable).toEqual([]);
        expect(indexes(rows.unstable)).toEqual([0, 1]);
        expect(rows.anyStable).toBe(false);
        expect(rows.hiddenCount).toBe(0);
        expect(rows.unstableCount).toBe(2);
    });
});
