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
    /** Its estimated cost, ns a tick, all of it wake-ups; 1,000 unless given, null for a clock whose wake-ups were not counted */
    costNs?: number | null;
}

/**
 * A stable clock at the target rate on a moving belt, made for it, with 10 wake-ups, a cost of 1,000 ns a tick and 4
 * windows, on a build without a deadlock risk, unless told otherwise
 */
function clock(id: string, options: ClockOptions = {}): Clock {
    const { verdict = 'stable', beltLabel = 'moving (+4 ticks)', deadlock = false, shownWindows, costNs = 1000, ...ranking } = options;
    const full: ClockRanking = {
        meets_target_rate: true,
        rate_off_target: 0,
        holds_expected_output: true,
        matches_belt_choice: true,
        wake_ups_per_minute: costNs === null ? null : 10,
        cost: costNs === null ? null
            : { ns_per_tick: costNs, input_wake_ups: costNs, output_wake_ups: 0, belt_waits: 0, windows: 0, wires: 0, deciders: 0 },
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

const MOVING: PickRule = { backedUpBelts: false, searchedForFewerWakeUps: false };
const BACKED_UP: PickRule = { backedUpBelts: true, searchedForFewerWakeUps: false };
const SEARCHED: PickRule = { backedUpBelts: false, searchedForFewerWakeUps: true };

/** The id of the clock the rule picks from `clocks`; null for none */
const picked = (clocks: Clock[]) => {
    const index = recommendedIndexOf(clocks);
    return index === null ? null : clocks[index].id;
};

/** The reason for the clock the rule picks from `clocks`, after the run */
const reason = (clocks: Clock[], rule: PickRule | null = MOVING) =>
    recommendationReason(clocks, recommendedIndexOf(clocks), rule, true);

describe('recommendedIndexOf', () => {
    const wrongBelt = clock('slackless', { matches_belt_choice: false, costNs: 200 });

    it.each<[string, Clock[], string | null]>([
        ['is null for no clocks', [], null],
        ['picks the lowest cost among the clocks that keep making the rate',
            [clock('a', { costNs: 1200 }), short('near', 0.5), clock('b', { costNs: 800 })], 'b'],
        ['puts a clock not made for the belt behind one that is', [wrongBelt, clock('moving', { costNs: 900 })], 'moving'],
        ['picks a clock not made for the belt when no such clock holds the rate', [wrongBelt, short('near', 1)], 'slackless'],
        ['picks the nearest to the target rate when none holds it', [short('far', -3), short('near', 0.4), short('above', 2)], 'near'],
        ['ties costs closer than the engine\'s floor and picks the one that recovers sooner, whatever its wake-ups',
            [clock('cheaper', { costNs: 1000, recovery_periods: 30, wake_ups_per_minute: 4 }), clock('sooner', { costNs: 1004, recovery_periods: 3, wake_ups_per_minute: 40 })], 'sooner'],
        ['picks the cheaper of two costs the floor parts, whatever their recovery',
            [clock('cheaper', { costNs: 1000, recovery_periods: 30 }), clock('sooner', { costNs: 1006, recovery_periods: 3 })], 'cheaper'],
        ['breaks a tie on cost with the fewest windows', [clock('a', { window_count: 6 }), clock('b', { window_count: 3 })], 'b'],
        ['breaks a tie on windows too with the first listed', [clock('first'), clock('second')], 'first'],
    ])('%s', (_, clocks, id) => {
        expect(picked(clocks)).toBe(id);
    });

    it('equals what the engine selects for the same clocks split over several runs', () => {
        const runs = [
            { signature: 'batched', alternatives: [clock('a', { costNs: 1500 }), short('b', 1)] },
            { signature: 'uneven', alternatives: [clock('c', { costNs: 700, window_count: 9 })] },
            { signature: 'shifted', alternatives: [clock('d', { costNs: 700, window_count: 5 }), clock('e', { matches_belt_choice: false, costNs: 100 })] },
        ];
        const engine = combineClockAlternativeRuns([runs[2], null, runs[0], runs[1]], it => it.ranking);
        expect(recommendedIndexOf(engine.alternatives)).toBe(engine.selected_index);
        expect(engine.alternatives[engine.selected_index].id).toBe('d');
    });

    it('follows the winning clock, not its place, when an earlier-ordered clock is put ahead of it', () => {
        const winner = clock('winner', { costNs: 500 });
        const after = [clock('late', { costNs: 2000 }), clock('a'), winner];
        expect(recommendedIndexOf([clock('a'), winner])).toBe(1);
        expect(recommendedIndexOf(after)).toBe(2);
        expect(picked(after)).toBe('winner');
    });
});

describe('recommendationReason', () => {
    const { beltMoving, tieKindMoving, recoveryDoesNotDecide, mayFailOnMovingBelt } = RECOMMENDED_COPY;
    const { lowestCost, wakeUpsNotCounted, tieOnCost, tieOnCostUncounted, tieOnWindows } = RECOMMENDED_COPY;
    // the clocks a pick at 240/s is compared with: those that keep making it and recover, or with a deadlock risk those that hold it
    const recovering = 'the clocks that keep making 240/s and recover';
    const holding = 'the clocks that hold 240/s';
    const others = [clock('b', { costNs: 2000 }), clock('c', { costNs: 3000 })];
    // the reason for the pick of [clock('a'), ...others], and with backed-up belts
    const fewest = 'Lowest estimated UPS cost of the clocks that keep making 240/s and recover on a moving belt.';
    const fewestBackedUp = 'Lowest estimated UPS cost of the clocks that keep making 240/s and recover with backed-up belts.';

    /** `text` is `expected`, in sentences one space apart */
    const sentences = (text: string, expected: string) => {
        expect(text).toBe(expected);
        expect(text).toMatch(/^[A-Z]\S*( \S+)*\.$/);
        expect(text).not.toMatch(/\.[A-Z]/);
    };
    /** The reason for the pick from `clocks` is `expected` */
    const says = (_: string, clocks: Clock[], expected: string, rule?: PickRule | null) => sentences(reason(clocks, rule), expected);

    it.each<[string, Clock[], string, (PickRule | null)?]>([
        ['says the pick has the lowest estimated cost among the clocks that keep making the rate and recover on a moving belt', [clock('a'), ...others], fewest],
        ['says "hold" only on a build with a deadlock risk, where a clock that holds the rate counts without recovering',
            [clock('a', { deadlock: true }), clock('b', { deadlock: true, costNs: 2000 })], lowestCost(holding, beltMoving)],
        ['adds that the recovery trials do not decide for a clock that holds the rate without recovering',
            [clock('a', { deadlock: true, verdict: 'no recovery' }), clock('b', { deadlock: true, costNs: 2000 })],
            lowestCost(holding, beltMoving) + recoveryDoesNotDecide],
        ['says the belts are backed up when the build says so', [clock('a', { beltLabel: 'backed-up' }), ...others], fewestBackedUp, BACKED_UP],
        ['leaves the belt out when no clocked inserter picks up from a belt', [clock('a', { beltLabel: '' }), ...others], lowestCost(recovering, '')],
        ['leaves the belt out for a subtick clock, made for a backed-up belt, on a build with moving belts',
            [clock('subtick', { beltLabel: 'backed-up' }), ...others], lowestCost(recovering, '')],
        ['does not change with the search mode, which only changes which clocks there are', [clock('a'), ...others], fewest, SEARCHED],
        ['reads a missing rule as moving belts', [clock('a'), ...others], fewest, null],
        ['says how many clocks for a moving belt tie on cost and that the one with fewer wake windows was picked: one',
            [clock('a', { window_count: 3 }), clock('b', { costNs: 1000.04 }), ...others], fewest + tieOnCost(1, tieKindMoving)],
        ['says how many clocks for a moving belt tie on cost and that the one with fewer wake windows was picked: 2',
            [clock('a', { window_count: 3 }), clock('b'), clock('c', { window_count: 8 })], fewest + tieOnCost(2, tieKindMoving)],
        ['says the windows are counted without the extra ones when the table does not show the pick with fewer',
            [clock('a', { window_count: 3, shownWindows: 7 }), clock('b', { window_count: 4, shownWindows: 6 })], fewest + tieOnCostUncounted(1, tieKindMoving)],
        ['leaves the belt out of the tie with backed-up belts', [clock('a', { window_count: 3, beltLabel: 'backed-up' }), clock('b', { beltLabel: 'backed-up' })],
            fewestBackedUp + tieOnCost(1, ''), BACKED_UP],
        ['says the first listed was picked when the windows tie too', [clock('a'), clock('b'), ...others], fewest + tieOnWindows(1, tieKindMoving)],
        ['says when the pick is the only clock that holds the rate and recovers',
            [short('b', 1), clock('a'), short('c', -1)], 'The only clock that holds 240/s and recovers on a moving belt.'],
        ['says when the pick is the only clock that holds the rate on a build with a deadlock risk',
            [clock('a', { deadlock: true }), short('b', 1)], 'The only clock that holds 240/s on a moving belt.'],
        ['goes by the windows when the wake-ups were not counted',
            [clock('a', { costNs: null, window_count: 3 }), clock('b', { costNs: null })], wakeUpsNotCounted(recovering, beltMoving)],
    ])('%s', says);

    describe('a clock made for backed-up belts, picked because none for a moving belt meets the rate', () => {
        const backedUp = (id: string, options: ClockOptions = {}) =>
            clock(id, { matches_belt_choice: false, beltLabel: 'backed-up', ...options });
        const { backedUpOnly, backedUpLowestCost } = RECOMMENDED_COPY;
        const none = 'No clock made for a moving belt holds 240/s and recovers.';

        it.each<[string, Clock[], string]>([
            ['says it is the only one when it is', [backedUp('slackless'), short('b', 1)], none + backedUpOnly + mayFailOnMovingBelt],
            ['says it has the lowest cost of those that do', [backedUp('a', { costNs: 3000 }), backedUp('b'), short('c', 1)],
                none + backedUpLowestCost + mayFailOnMovingBelt],
            ['says what broke a tie on cost', [backedUp('a', { window_count: 3 }), backedUp('b')],
                none + backedUpLowestCost + tieOnCost(1, '') + mayFailOnMovingBelt],
            ['adds the recovery note on a build with a deadlock risk', [backedUp('a', { deadlock: true, verdict: 'no recovery' })],
                'No clock made for a moving belt holds 240/s.' + backedUpOnly + mayFailOnMovingBelt + recoveryDoesNotDecide],
        ])('%s', says);
    });

    it('says the pick recovers sooner when it ties on cost with clocks that take longer to get back', () => {
        const pick = clock('fast', { costNs: 0, recovery_periods: 3, window_count: 9 });
        const slow = clock('slow', { costNs: 0, recovery_periods: 33, window_count: 2 });
        sentences(recommendationReason([pick, slow], 0, MOVING, true, false),
            'Lowest estimated UPS cost of the clocks that keep making 240/s and recover on a moving belt.'
            + RECOMMENDED_COPY.tieOnRecovery(1, RECOMMENDED_COPY.tieKindMoving));
    });

    it('says the pick recovers sooner when its cost is level with a cheaper clock\'s', () => {
        const cheaper = clock('cheaper', { costNs: 1000, recovery_periods: 30 });
        const pick = clock('sooner', { costNs: 1004, recovery_periods: 3 });
        sentences(reason([cheaper, pick]), 'Lowest estimated UPS cost of the clocks that keep making 240/s and recover on a moving belt.'
            + RECOMMENDED_COPY.tieOnRecovery(1, RECOMMENDED_COPY.tieKindMoving));
    });

    describe('when no clock meets the rate', () => {
        const { nearest, nearestAt, nearestHolds } = RECOMMENDED_COPY;
        const none = 'No clock holds 240/s and recovers.';

        it.each<[string, Clock[], string]>([
            ['says how near the pick runs', [short('far', -3), short('near', -0.5)], none + nearestAt('239.5')],
            ['says the pick holds its output when an equally near clock does not', [short('drifts', -0.5, false), short('holds', 0.5)],
                none + nearestAt('240.5') + nearestHolds],
            ['does not say so when no other clock is equally near', [short('drifts', -2, false), short('holds', 0.5)], none + nearestAt('240.5')],
            ['does not call a clock at the target rate the nearest: it holds the rate from a clean start',
                [short('more', 0, true, { costNs: 3000 }), short('fewer', 0), short('far', -2)],
                `${none} This one holds 240/s from the modeled cold start at the lowest estimated UPS cost.`],
            ['says a clock at the rate that does not hold its output only runs at it', [short('drifts', 0, false)],
                `${none} This one runs at 240/s at the lowest estimated UPS cost.`],
            ['says a clock at the rate that holds its output holds it, without the lowest cost when the wake-ups were not counted',
                [short('uncounted', 0, true, { costNs: null })], `${none} This one holds 240/s from the modeled cold start.`],
            ['does not print the same rate twice when the pick is off by less than the printed figure', [short('close', 0.002)], none + nearest],
            ['says no clock holds the rate on a build with a deadlock risk', [short('near', -0.5, false, { deadlock: true })],
                'No clock holds 240/s.' + nearestAt('239.5')],
            ['says a stable clock over the target is picked before an unstable one nearer to it, and how far over',
                [short('near', -0.5, false), short('over', 6, true, { verdict: 'stable', stable_above_target: true })],
                none + RECOMMENDED_COPY.stableOver('246', '2.5%')],
        ])('%s', says);
    });

    it.each<[string, boolean, string]>([
        ['says the pick may change while clocks are still being made', false, RECOMMENDED_COPY.provisional],
        ['says a better clock may not have been made after a run the player stopped', true, RECOMMENDED_COPY.stopped],
    ])('%s', (_, stopped, lead) => {
        sentences(recommendationReason([clock('a'), ...others], 0, MOVING, false, stopped), lead + fewest);
    });

    it('is empty when nothing is recommended', () => {
        expect(recommendationReason([], null, MOVING, true)).toBe('');
        expect(recommendationReason([clock('a')], null, MOVING, false)).toBe('');
    });

    it('prints the target rate as the rate warning does', () => {
        const at = (rate: number) => reason([{ ...clock('a'), assessment: { items_per_second: rate } }]);
        expect([at(240), at(12.5), at(1 / 3)]).toEqual(['240', '12.5', '0.33'].map(rate => `The only clock that holds ${rate}/s and recovers on a moving belt.`));
    });
});

describe('RECOMMENDED_COPY', () => {
    it('says "Best so far" and offers "Back to the pick" while clocks are still being made', () => {
        expect(RECOMMENDED_COPY).toMatchObject({ chipWhileGenerating: 'Best so far', backWhileGenerating: 'Back to the pick' });
    });

    it('says in "How clocks are chosen" what is picked on a build with a deadlock risk', () => {
        expect(RECOMMENDED_COPY.disclosure[1]).toContain('on a build with a deadlock risk, the one with the lowest estimated UPS cost of the clocks that hold the rate');
    });

    it('says one other clock is level with the pick, and 2 other clocks are', () => {
        const { tieOnCost, tieKindMoving } = RECOMMENDED_COPY;
        expect(tieOnCost(1, '')).toContain(' One other clock is level with it ');
        expect(tieOnCost(1, tieKindMoving)).toContain(' One other clock for a moving belt is level with it ');
        expect(tieOnCost(2, tieKindMoving)).toContain(' 2 other clocks for a moving belt are level with it ');
    });
});

describe('disclosureRunLine', () => {
    it('says the belt the clocks were made for and whether the searches ran', () => {
        const { runMovingBelts: moving, runBackedUpBelts: backedUp, runSearched: searched, runSearchedWhenNeeded: whenNeeded } = RECOMMENDED_COPY;
        expect(disclosureRunLine(MOVING)).toBe(`${moving} ${whenNeeded}`);
        expect(disclosureRunLine(BACKED_UP)).toBe(`${backedUp} ${whenNeeded}`);
        expect(disclosureRunLine(SEARCHED)).toBe(`${moving} ${searched}`);
        expect(disclosureRunLine({ backedUpBelts: true, searchedForFewerWakeUps: true })).toBe(`${backedUp} ${searched}`);
        expect(disclosureRunLine(null)).toBe(disclosureRunLine(MOVING));
    });
});

describe('pickRuleOf', () => {
    it('reads the belts and the search mode from the overrides', () => {
        const config = (overrides?: Config['overrides']) => ({ overrides }) as Config;
        expect(pickRuleOf(config())).toEqual(MOVING);
        expect(pickRuleOf(config({ backed_up_belts: true }))).toEqual(BACKED_UP);
        expect(pickRuleOf(config({ search_for_fewer_wake_ups: true }))).toEqual(SEARCHED);
        expect(pickRuleOf(config({ backed_up_belts: false, search_for_fewer_wake_ups: false }))).toEqual(MOVING);
    });
});

describe('partitionClockRows', () => {
    type Options = Parameters<typeof partitionClockRows>[1];
    const rowsOf = (verdicts: ClockVerdict[]) => verdicts.map((verdict, index) => ({ id: `clock-${index}`, verdict }));
    // 0 stable, 1 unstable, 2 stable, 3 no recovery, 4 unstable
    const clocks = rowsOf(['stable', 'unstable', 'stable', 'no recovery', 'unstable']);
    const indexes = (rows: { index: number }[]) => rows.map(it => it.index);
    /** The groups by the indexes of their rows, and the counts */
    const groups = (rows: ReturnType<typeof rowsOf>, options: Options) => {
        const { stable, unstable, ...counts } = partitionClockRows(rows, options);
        return { stable: indexes(stable), unstable: indexes(unstable), ...counts };
    };

    // the options, then the stable and the other rows shown and how many of the others are hidden
    it.each<[string, Options, number[], number[], number]>([
        ['puts the stable clocks first and the others after, each in list order, with no recovery among the others',
            { selectedIndex: 0, recommendedIndex: 0, showUnstable: true }, [0, 2], [1, 3, 4], 0],
        ['keeps only the selected and the recommended unstable clocks while the others are hidden',
            { selectedIndex: 4, recommendedIndex: 0, showUnstable: false }, [0, 2], [4], 2],
        ['keeps the recommended clock when it is not stable', { selectedIndex: 0, recommendedIndex: 3, showUnstable: false }, [0, 2], [3], 2],
        ['puts the recommended clock first in its group, the others in list order',
            { selectedIndex: 0, recommendedIndex: 2, showUnstable: true }, [2, 0], [1, 3, 4], 0],
        ['keeps list order while a run can still change the pick',
            { selectedIndex: 0, recommendedIndex: 2, showUnstable: true, recommendedFirst: false }, [0, 2], [1, 3, 4], 0],
    ])('%s', (_, options, stable, unstable, hiddenCount) => {
        expect(groups(clocks, options)).toEqual({ stable, unstable, unstableCount: 3, hiddenCount, anyStable: true });
    });

    it('keeps the rows that stayed while hidden first under the divider once the others are shown (utility science)', () => {
        // unstable rows at 2 and 3 come before the recommended no-recovery row at 5 in the list
        const utility = rowsOf(['stable', 'stable', 'unstable', 'unstable', 'stable', 'no recovery', 'unstable']);
        // the other rows with `selectedIndex` selected while hidden, then shown with those that stayed pinned
        const hiddenThenShown = (selectedIndex: number) => {
            const hidden = partitionClockRows(utility, { selectedIndex, recommendedIndex: 5, showUnstable: false }).unstable;
            const pinnedIds = hidden.map(row => row.alternative.id);
            return [indexes(hidden), indexes(partitionClockRows(utility, { selectedIndex, recommendedIndex: 5, showUnstable: true, pinnedIds }).unstable)];
        };
        expect(hiddenThenShown(0)).toEqual([[5], [5, 2, 3, 6]]);
        // with an unstable row selected too, both stay in place, the recommended first
        expect(hiddenThenShown(3)).toEqual([[5, 3], [5, 3, 2, 6]]);
    });

    it('shows every clock in one group when none is stable', () => {
        expect(groups(rowsOf(['unstable', 'no recovery']), { selectedIndex: 1, recommendedIndex: 1, showUnstable: false }))
            .toEqual({ stable: [], unstable: [1, 0], unstableCount: 2, hiddenCount: 0, anyStable: false });
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
