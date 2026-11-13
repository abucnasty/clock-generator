import { describe, expect, it } from 'vitest';
import type { ClockRanking, ClockVerdict, Config } from 'clock-generator/browser';
import { combineClockAlternativeRuns } from 'clock-generator/light';
import {
    RECOMMENDED_COPY,
    partitionClockRows,
    pickRuleOf,
    rankOrderOf,
    recommendationReason,
    recommendedIndexOf,
    searchesRunLine,
    type PickRule,
} from './recommendedClock';
import { ELECTROMAGNETIC_330_TWO_SWINGS, viewsOf } from '../test/checkedLanesFixtures';

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

const WHEN_NEEDED: PickRule = { searchedForFewerWakeUps: false };
const SEARCHED: PickRule = { searchedForFewerWakeUps: true };

/** The id of the clock the rule picks from `clocks`; null for none */
const picked = (clocks: Clock[]) => {
    const index = recommendedIndexOf(clocks);
    return index === null ? null : clocks[index].id;
};

/** The reason for the clock the rule picks from `clocks`, after the run */
const reason = (clocks: Clock[]) =>
    recommendationReason(clocks, recommendedIndexOf(clocks), true);

describe('recommendedIndexOf', () => {
    it.each<[string, Clock[], string | null]>([
        ['is null for no clocks', [], null],
        ['picks the fewest wakeups among the clocks that keep making the rate',
            [clock('a', { wake_ups_per_minute: 12 }), short('near', 0.5), clock('b', { wake_ups_per_minute: 8 })], 'b'],
        ['picks the fewest wakeups whatever belt a clock takes from', [clock('backed', { beltLabel: 'backed-up', wake_ups_per_minute: 2 }),
            clock('moving', { wake_ups_per_minute: 9 })], 'backed'],
        ['picks the nearest to the target rate when none holds it', [short('far', -3), short('near', 0.4), short('above', 2)], 'near'],
        ['breaks a tie on wakeups with the fewest windows', [clock('a', { window_count: 6 }), clock('b', { window_count: 3 })], 'b'],
        ['breaks a tie on windows too with the first listed', [clock('first'), clock('second')], 'first'],
    ])('%s', (_, clocks, id) => {
        expect(picked(clocks)).toBe(id);
    });

    it('equals what the engine selects for the same clocks split over several runs', () => {
        const runs = [
            { signature: 'batched', alternatives: [clock('a', { wake_ups_per_minute: 15 }), short('b', 1)] },
            { signature: 'uneven', alternatives: [clock('c', { wake_ups_per_minute: 7, window_count: 9 })] },
            { signature: 'shifted', alternatives: [clock('d', { wake_ups_per_minute: 7, window_count: 5 }), short('e', 1)] },
        ];
        const engine = combineClockAlternativeRuns([runs[2], null, runs[0], runs[1]], it => it.ranking);
        expect(recommendedIndexOf(engine.alternatives)).toBe(engine.selected_index);
        expect(engine.alternatives[engine.selected_index].id).toBe('d');
    });

    it('follows the winning clock, not its place, when an earlier-ordered clock is put ahead of it', () => {
        const winner = clock('winner', { wake_ups_per_minute: 5 });
        const after = [clock('late', { wake_ups_per_minute: 20 }), clock('a'), winner];
        expect(recommendedIndexOf([clock('a'), winner])).toBe(1);
        expect(recommendedIndexOf(after)).toBe(2);
        expect(picked(after)).toBe('winner');
    });
});

describe('recommendationReason', () => {
    const { recoveryDoesNotDecide } = RECOMMENDED_COPY;
    const { fewestWakeUps, wakeUpsNotCounted, tieOnWakeUps, tieOnWakeUpsUncounted, tieOnWindows } = RECOMMENDED_COPY;
    // the clocks a pick at 240/s is compared with: those that keep making it and recover, or with a deadlock risk those that hold it
    const recovering = 'the clocks that keep making 240/s and go back to it after a stop';
    const holding = 'the clocks that hold 240/s';
    const others = [clock('b', { wake_ups_per_minute: 20 }), clock('c', { wake_ups_per_minute: 30 })];
    // the reason for the pick of [clock('a'), ...others]: no build-wide belt answer, whatever belt the clocks are made for
    const fewest = 'Fewest wakeups of the clocks that keep making 240/s and go back to it after a stop.';

    /** `text` is `expected`, in sentences one space apart */
    const sentences = (text: string, expected: string) => {
        expect(text).toBe(expected);
        expect(text).toMatch(/^[A-Z]\S*( \S+)*\.$/);
        expect(text).not.toMatch(/\.[A-Z]/);
    };
    /** The reason for the pick from `clocks` is `expected` */
    const says = (_: string, clocks: Clock[], expected: string) => sentences(reason(clocks), expected);

    it.each<[string, Clock[], string]>([
        ['says the pick has the fewest wakeups among the clocks that keep making the rate and go back to it after a stop', [clock('a'), ...others], fewest],
        ['says "hold" only on a build with a deadlock risk, where a clock that holds the rate counts without recovering',
            [clock('a', { deadlock: true }), clock('b', { deadlock: true, wake_ups_per_minute: 20 })], fewestWakeUps(holding)],
        ['adds that the recovery trials do not decide for a clock that holds the rate without recovering',
            [clock('a', { deadlock: true, verdict: 'no recovery' }), clock('b', { deadlock: true, wake_ups_per_minute: 20 })],
            fewestWakeUps(holding) + recoveryDoesNotDecide],
        ['names no belt for a clock made for a backed-up belt', [clock('a', { beltLabel: 'backed-up' }), ...others], fewest],
        ['names no belt when no clocked inserter picks up from a belt', [clock('a', { beltLabel: '' }), ...others], fewestWakeUps(recovering)],
        ['says how many clocks tie on wakeups and that the one with fewer enable windows was picked: one',
            [clock('a', { window_count: 3 }), clock('b', { wake_ups_per_minute: 10.0004 }), ...others], fewest + tieOnWakeUps(1)],
        ['says how many clocks tie on wakeups and that the one with fewer enable windows was picked: 2',
            [clock('a', { window_count: 3 }), clock('b'), clock('c', { window_count: 8 })], fewest + tieOnWakeUps(2)],
        ['says the windows are counted without the extra ones when the table does not show the pick with fewer',
            [clock('a', { window_count: 3, shownWindows: 7 }), clock('b', { window_count: 4, shownWindows: 6 })], fewest + tieOnWakeUpsUncounted(1)],
        ['says the first listed was picked when the windows tie too', [clock('a'), clock('b'), ...others], fewest + tieOnWindows(1)],
        ['says when the pick is the only clock that holds the rate and recovers',
            [short('b', 1), clock('a'), short('c', -1)], 'The only clock that holds 240/s and has recovery.'],
        ['says when the pick is the only clock that holds the rate on a build with a deadlock risk',
            [clock('a', { deadlock: true }), short('b', 1)], 'The only clock that holds 240/s.'],
        ['goes by the windows when the wakeups were not counted',
            [clock('a', { wake_ups_per_minute: null, window_count: 3 }), clock('b', { wake_ups_per_minute: null })], wakeUpsNotCounted(recovering)],
    ])('%s', says);


    it('says the pick recovers sooner when it ties on wakeups with clocks that take longer to get back', () => {
        const pick = clock('fast', { wake_ups_per_minute: 0, recovery_window_cycles: 3, window_count: 9 });
        const slow = clock('slow', { wake_ups_per_minute: 0, recovery_window_cycles: 33, window_count: 2 });
        sentences(recommendationReason([pick, slow], 0, true, false),
            'Fewest wakeups of the clocks that keep making 240/s and go back to it after a stop.' + RECOMMENDED_COPY.tieOnRecovery(1));
    });

    describe('when no clock meets the rate', () => {
        const { nearest, nearestAt, nearestHolds } = RECOMMENDED_COPY;
        const none = 'No clock holds 240/s and has recovery.';

        it.each<[string, Clock[], string]>([
            ['says how near the pick runs', [short('far', -3), short('near', -0.5)], none + nearestAt('239.5')],
            ['says the pick holds its output when an equally near clock does not', [short('drifts', -0.5, false), short('holds', 0.5)],
                none + nearestAt('240.5') + nearestHolds],
            ['does not say so when no other clock is equally near', [short('drifts', -2, false), short('holds', 0.5)], none + nearestAt('240.5')],
            ['does not call a clock at the target rate the nearest: it holds the rate from a clean start',
                [short('more', 0, true, { wake_ups_per_minute: 30 }), short('fewer', 0), short('far', -2)],
                `${none} This one holds 240/s from the modeled cold start with the fewest wakeups.`],
            ['says a clock at the rate that does not hold its output only runs at it', [short('drifts', 0, false)],
                `${none} This one runs at 240/s with the fewest wakeups.`],
            ['says a clock at the rate that holds its output holds it, without the fewest wakeups when they were not counted',
                [short('uncounted', 0, true, { wake_ups_per_minute: null })], `${none} This one holds 240/s from the modeled cold start.`],
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
        sentences(recommendationReason([clock('a'), ...others], 0, false, stopped), lead + fewest);
    });

    it('is empty when nothing is recommended', () => {
        expect(recommendationReason([], null, true)).toBe('');
        expect(recommendationReason([clock('a')], null, false)).toBe('');
    });

    it('prints the target rate as the rate warning does', () => {
        const at = (rate: number) => reason([{ ...clock('a'), assessment: { items_per_second: rate } }]);
        expect([at(240), at(12.5), at(1 / 3)]).toEqual(['240', '12.5', '0.33'].map(rate => `The only clock that holds ${rate}/s and has recovery.`));
    });
});

describe('RECOMMENDED_COPY', () => {
    it('says "Best so far" and offers "Back to best so far" while clocks are still being made', () => {
        expect(RECOMMENDED_COPY).toMatchObject({ chipWhileGenerating: 'Best so far', backWhileGenerating: 'Back to best so far' });
    });

    it('says in the help of the Rank column what ranks first on a build with a deadlock risk', () => {
        expect(RECOMMENDED_COPY.rankKeys[0]).toContain('On a build with a deadlock risk, it holds the setpoint.');
    });

    it('names the six keys of the engine\'s order in the help of the Rank column, in order, and rank 1 as the recommended clock', () => {
        const { rankKeys, rankFirst, rankTie } = RECOMMENDED_COPY;
        expect(rankKeys).toHaveLength(6);
        // the tier, the distance from the setpoint, holding the output, the wakeups, the recovery, the enable windows
        ['rounded to whole ticks', 'nearer to the setpoint', 'holds its output', 'fewer wakeups', 'fewer window cycles', 'fewer enable windows']
            .forEach((words, key) => expect(rankKeys[key]).toContain(words));
        expect(rankTie).toBe('Clocks that are equal on all six keep the order they were made in.');
        expect(rankFirst).toBe('Rank 1 is the recommended clock.');
    });

    it('says one other clock is level with the pick, and 2 other clocks are', () => {
        const { tieOnWakeUps } = RECOMMENDED_COPY;
        expect(tieOnWakeUps(1)).toContain(' One other clock is level with it ');
        expect(tieOnWakeUps(2)).toContain(' 2 other clocks are level with it ');
    });
});

describe('searchesRunLine', () => {
    it('says whether the searches ran, and names no belt', () => {
        const { runSearched: searched, runSearchedWhenNeeded: whenNeeded } = RECOMMENDED_COPY;
        expect(searchesRunLine(WHEN_NEEDED)).toBe(whenNeeded);
        expect(searchesRunLine(SEARCHED)).toBe(searched);
        expect(searchesRunLine(null)).toBe(whenNeeded);
    });
});

describe('pickRuleOf', () => {
    it('reads the search mode from the overrides, and nothing of the belts', () => {
        const config = (overrides?: Config['overrides']) => ({ overrides }) as Config;
        expect(pickRuleOf(config())).toEqual(WHEN_NEEDED);
        expect(pickRuleOf(config({ backed_up_belts: true }))).toEqual(WHEN_NEEDED);
        expect(pickRuleOf(config({ search_for_fewer_wake_ups: true }))).toEqual(SEARCHED);
    });
});

describe('rankOrderOf', () => {
    it('is the engine\'s order of the clocks, the recommended clock first', () => {
        const clocks = [short('near', 0.5), clock('more', { wake_ups_per_minute: 12 }), clock('fewest', { wake_ups_per_minute: 8 }), short('far', -3)];
        expect(rankOrderOf(clocks).map(index => clocks[index].id)).toEqual(['fewest', 'more', 'near', 'far']);
        expect(rankOrderOf(clocks)[0]).toBe(recommendedIndexOf(clocks));
        expect(rankOrderOf([])).toEqual([]);
    });

    it('is the order of the engine\'s combination of every run, as the worker lists the clocks', () => {
        const runs = [
            { signature: 'batched', alternatives: [clock('a', { wake_ups_per_minute: 15 }), short('b', 1)] },
            { signature: 'uneven', alternatives: [clock('c', { wake_ups_per_minute: 7, window_count: 9 })] },
            { signature: 'shifted', alternatives: [clock('d', { wake_ups_per_minute: 7, window_count: 5 }), short('e', 1)] },
        ];
        const engine = combineClockAlternativeRuns([runs[2], null, runs[0], runs[1]], it => it.ranking);
        expect(rankOrderOf(engine.alternatives)).toEqual(engine.order);
    });
});

describe('partitionClockRows', () => {
    type Options = Parameters<typeof partitionClockRows>[1];
    // in list order: 0 stable with 20 wakeups, 1 unstable 2/s short, 2 stable with 5, 3 no recovery 1/s short, 4 unstable 3/s short
    const clocks = [clock('a', { wake_ups_per_minute: 20 }), short('b', -2, false), clock('c', { wake_ups_per_minute: 5 }), short('d', -1), short('e', -3, false)];
    const isStable = (it: Clock) => it.verdict === 'stable';
    /** The groups by the indexes of their rows with their ranks, and the counts */
    const groups = (rows: Clock[], options: Omit<Options, 'isStable'>) => {
        const { stable, unstable, ...counts } = partitionClockRows(rows, { ...options, isStable });
        const of = (group: typeof stable) => group.map(it => [it.index, it.rank]);
        return { stable: of(stable), unstable: of(unstable), ...counts };
    };

    // the options, then the stable and the other rows shown as [index, rank], and how many of the others are hidden
    it.each<[string, Omit<Options, 'isStable'>, number[][], number[][], number]>([
        ['puts the stable clocks first and the others after, each in the engine\'s order, numbered straight through',
            { selectedIndex: 0, showUnstable: true }, [[2, 1], [0, 2]], [[3, 3], [1, 4], [4, 5]], 0],
        ['keeps only the selected unstable clock while the others are hidden, with its rank',
            { selectedIndex: 4, showUnstable: false }, [[2, 1], [0, 2]], [[4, 5]], 2],
    ])('%s', (_, options, stable, unstable, hiddenCount) => {
        expect(groups(clocks, options)).toEqual({ stable, unstable, unstableCount: 3, hiddenCount, anyStable: true });
    });

    it('keeps the recommended clock in view when it is not stable', () => {
        // a build with a deadlock risk: a clock that holds the setpoint without recovery meets it, here with the fewest wakeups
        const deadlock = [clock('stable', { wake_ups_per_minute: 9 }), short('drifts', -1, false), clock('holds', { verdict: 'no recovery', wake_ups_per_minute: 2 })];
        expect(groups(deadlock, { selectedIndex: 0, showUnstable: false }))
            .toEqual({ stable: [[0, 2]], unstable: [[2, 1]], unstableCount: 2, hiddenCount: 1, anyStable: true });
    });

    it('sorts every row by its rank while a run adds clocks: a clock that arrives and ranks first leads, the others move down one', () => {
        const before = groups(clocks, { selectedIndex: 0, showUnstable: true });
        const after = groups([...clocks, clock('new', { wake_ups_per_minute: 1 })], { selectedIndex: 0, showUnstable: true });
        expect(before.stable).toEqual([[2, 1], [0, 2]]);
        expect(after.stable).toEqual([[5, 1], [2, 2], [0, 3]]);
        expect(after.unstable).toEqual([[3, 4], [1, 5], [4, 6]]);
    });

    it('shows every clock in one group when none is stable', () => {
        expect(groups([short('far', -2), short('near', -1, false)], { selectedIndex: 1, showUnstable: false }))
            .toEqual({ stable: [], unstable: [[1, 1], [0, 2]], unstableCount: 2, hiddenCount: 0, anyStable: false });
    });
});

describe('RECOMMENDED_COPY.intro', () => {
    it('names the card a row is shown in by its heading, Selected clock (#658)', () => {
        expect(RECOMMENDED_COPY.intro).toContain('show it in Selected clock above');
        expect(RECOMMENDED_COPY.intro).not.toContain('Your clock');
    });
});

describe('the reason of a recommended clock with a loss on a shared lane', () => {
    const views = viewsOf(ELECTROMAGNETIC_330_TWO_SWINGS);
    const index = ELECTROMAGNETIC_330_TWO_SWINGS.selected_index;

    it('says the rate all the copies made together, not the setpoint as its rate: electromagnetic science 330 with 2 swings', () => {
        expect(recommendedIndexOf(views)).toBe(index);
        expect(views[index].checkedLanes!.copies_made!.items_per_second).toBeCloseTo(318.79, 2);
        expect(recommendationReason(views, index, true)).toBe('No clock holds 330/s and has recovery. This one runs at 318.79/s with the fewest wakeups.');
    });

    it('says the setpoint where the result has no rate of the copies (an older result), as before', () => {
        const older = views.map(view => ({ ...view, checkedLanes: { ...view.checkedLanes!, copies_made: undefined } }));
        expect(recommendationReason(older, index, true)).toBe('No clock holds 330/s and has recovery. This one runs at 330/s with the fewest wakeups.');
    });
});
