import { describe, expect, it } from 'vitest';
import type { ClockRanking, ClockVerdict } from 'clock-generator/browser';
import { rateWarningOf } from './rateWarning';
import { startCheckSummary } from './modelAssumptions';
import { RECOMMENDED_COPY, type PickRule } from './recommendedClock';
import {
    SUMMARY_COPY,
    beltCellText,
    beltLine,
    beltValue,
    beltValueSub,
    clockTechnicalName,
    differenceFromRecommended,
    foldedMakes,
    makesText,
    plainClockName,
    recoversOf,
    lossLimitText,
    minutesAndSecondsText,
    pickNameMeaning,
    wakeUpsText,
    worksOf,
    type SummaryClock,
} from './clockSummary';

const TARGET = 240;

type Loss = NonNullable<SummaryClock['assessment']['backpressure_loss']>;

interface ClockOptions extends Partial<ClockRanking> {
    verdict?: ClockVerdict;
    beltLabel?: string;
    deadlock?: boolean;
    deciders?: number;
    /** Over the recovery result its verdict gives; null when its recovery was not tried */
    loss?: Partial<Loss> | null;
}

/** A stable clock at the target rate, made for the belt asked for, with 10 wake-ups, 4 windows and 4 deciders, unless told otherwise */
function clock(id: string, options: ClockOptions = {}): SummaryClock {
    const { verdict = 'stable', beltLabel = 'moving (+4 ticks)', deadlock = false, deciders = 4, loss, ...ranking } = options;
    const full: ClockRanking = {
        meets_target_rate: true,
        rate_off_target: 0,
        holds_expected_output: true,
        matches_belt_choice: true,
        wake_ups_per_minute: 10,
        window_count: 4,
        ...ranking,
    };
    const tried: Loss | null = verdict === 'unstable' ? null : {
        survives: verdict === 'stable', broken_by: verdict === 'no recovery' ? ['an input stops arriving'] : [], recovered_after_periods: verdict === 'stable' ? 1 : null,
    };
    return {
        id, label: `Engine name of ${id}`, verdict, beltLabel, deciders,
        deadlockRisk: deadlock ? 'Deadlock risk: inserters 1 and 2 both bring the same item.' : null,
        ranking: full,
        assessment: {
            holds: verdict !== 'unstable',
            items_per_second: TARGET + full.rate_off_target,
            wake_ups_per_minute: full.wake_ups_per_minute,
            backpressure_loss: loss === null || tried === null ? null : { ...tried, ...loss },
            start_dependence: null,
        },
    };
}

const nameOf = (clocks: SummaryClock[], id: string) => plainClockName(clocks, clocks.findIndex(it => it.id === id));

describe('sampled starts remain separate from rate and recovery', () => {
    it('names a target-rate dependent clock and retains its evaluated recovery and actual sample counts', () => {
        const dependent = clock('dependent', { verdict: 'unstable', meets_target_rate: false });
        dependent.assessment = { ...dependent.assessment, holds: true,
            backpressure_loss: { survives: true, broken_by: [], recovered_after_periods: 2 },
            start_dependence: { verdict: 'start-dependent', expected_output_items: 240,
                starts: ['cold', 'ascending'].map((id, i) => ({ id, label: id, reaches_target: i === 0,
                    output_items_per_period: i === 0 ? 240 : 120, cycle: null, off_bins: null, span_items: null, long_run_keeps_up: i === 0 })) } };
        expect(plainClockName([dependent], 0)).toBe(SUMMARY_COPY.startDependent);
        expect(worksOf(dependent)).toEqual({ kind: 'caution', text: SUMMARY_COPY.worksStartDependent });
        expect(recoversOf(dependent)).toMatchObject({ kind: 'yes', value: SUMMARY_COPY.recoversYes });
        expect(rateWarningOf(dependent)).toContain('some sampled starts');
        expect(rateWarningOf(dependent)).not.toContain('240 of 240');
        expect(startCheckSummary([dependent], { startDependenceRequested: true, complete: true })).toBe('Tried from 2 other starting states, across 1 of 1 clocks.');
        const unavailable = clock('unavailable');
        expect(startCheckSummary([unavailable], { startDependenceRequested: false, complete: true })).toBe('Other starting states were not tried.');
        expect(startCheckSummary([unavailable], { startDependenceRequested: true, complete: true })).toBe('Results for other starting states are unavailable.');
        expect(startCheckSummary([dependent, unavailable], { startDependenceRequested: true, complete: false })).toBe('This generation is incomplete. Tried from 2 other starting states, across 1 of 2 clocks. Results for other starting states are unavailable for 1.');
        expect(startCheckSummary([], { startDependenceRequested: true, complete: true })).toBe('No clocks were available to check.');
        expect(recoversOf(clock('untried', { loss: null }))).toMatchObject({ kind: 'not-tested', value: SUMMARY_COPY.recoversUnavailable });
        // the loss trials' baseline missed its output: no cause, so no verdict on recovery
        const baseline = clock('baseline', { verdict: 'no recovery', meets_target_rate: false, loss: { broken_by: [] } });
        expect(recoversOf(baseline)).toMatchObject({ value: SUMMARY_COPY.recoversUnavailable, detail: SUMMARY_COPY.recoversBaselineUnavailableDetail });
        expect(plainClockName([baseline], 0)).toBe(SUMMARY_COPY.recoveryUnavailable);
        expect(worksOf(baseline)).toEqual({ kind: 'caution', text: SUMMARY_COPY.recoveryUnavailable });
        expect(differenceFromRecommended(baseline, clock('recommended'))).toBe('Recovery results are unavailable for this clock.');
    });
});

describe('plainClockName', () => {
    const { fewestWakeUps, fewestDeciders, fewestWakeWindows } = SUMMARY_COPY;
    const another = SUMMARY_COPY.another('240');

    // the names asked of each clock, by id
    it.each<[string, SummaryClock[], Record<string, string>]>([
        ['names the clock with the fewest wake-ups among the contenders',
            [clock('a', { wake_ups_per_minute: 12 }), clock('b', { wake_ups_per_minute: 8 })], { b: fewestWakeUps }],
        ['gives tied clocks the same name',
            [clock('a', { wake_ups_per_minute: 8.0001 }), clock('b', { wake_ups_per_minute: 8 })], { a: fewestWakeUps, b: fewestWakeUps }],
        ['names a clock with more wake-ups but the fewest windows "Fewest wake windows", not by the deciders every clock has as many of',
            [clock('a', { wake_ups_per_minute: 8, window_count: 6 }), clock('b', { wake_ups_per_minute: 12, window_count: 3 })], { b: fewestWakeWindows }],
        ['names a clock with more wake-ups but the fewest deciders "Fewest deciders", before the windows',
            [clock('a', { wake_ups_per_minute: 8, window_count: 6, deciders: 10 }), clock('b', { wake_ups_per_minute: 12, window_count: 3, deciders: 6 })],
            { b: fewestDeciders, a: fewestWakeUps }],
        ['does not name a clock Fewest deciders when it only ties the recommended clock, whose name it leaves to the windows', [
            clock('a', { wake_ups_per_minute: 8, window_count: 6, deciders: 4 }),
            clock('b', { wake_ups_per_minute: 12, window_count: 6, deciders: 4 }),
            clock('c', { wake_ups_per_minute: 15, window_count: 3, deciders: 6 }),
        ], { a: fewestWakeUps, b: another, c: fewestWakeWindows }],
        ['does not name a clock Fewest deciders when it only ties a clock tied for the fewest wake-ups', [
            clock('a', { wake_ups_per_minute: 8.0001, window_count: 6, deciders: 8 }),
            clock('b', { wake_ups_per_minute: 8, window_count: 6, deciders: 4 }),
            clock('c', { wake_ups_per_minute: 15, window_count: 6, deciders: 4 }),
        ], { a: fewestWakeUps, b: fewestWakeUps, c: expect.not.stringContaining(fewestDeciders) }],
        ['names a clock Fewest deciders when it has fewer than the recommended clock and every clock with the fewest wake-ups', [
            clock('a', { wake_ups_per_minute: 8, window_count: 6, deciders: 5 }),
            clock('b', { wake_ups_per_minute: 12, window_count: 6, deciders: 4 }),
            clock('c', { wake_ups_per_minute: 15, window_count: 6, deciders: 4 }),
        ], { b: fewestDeciders, c: fewestDeciders }],
        ['falls through to the windows when the wake-ups were not counted',
            [clock('a', { wake_ups_per_minute: null, window_count: 5 }), clock('b', { wake_ups_per_minute: null, window_count: 3 })], { b: fewestWakeWindows, a: another }],
        ['names a clock that does not match the belt by its belt, even with the fewest wake-ups',
            [clock('a', { wake_ups_per_minute: 12 }), clock('b', { wake_ups_per_minute: 2, matches_belt_choice: false, beltLabel: 'backed-up' })],
            { b: SUMMARY_COPY.backedUpBelts, a: fewestWakeUps }],
        ['names a clock that does not recover, or does not hold its rate', [
            clock('a'),
            clock('b', { verdict: 'no recovery', meets_target_rate: false }),
            clock('c', { verdict: 'unstable', meets_target_rate: false, holds_expected_output: false }),
        ], { b: SUMMARY_COPY.noRecovery, c: SUMMARY_COPY.unstable }],
        ['names a clock off the target rate by its rate, below or above, before its verdict', [
            clock('a'),
            clock('below', { verdict: 'unstable', meets_target_rate: false, rate_off_target: -48 }),
            clock('above', { meets_target_rate: false, rate_off_target: 12.5 }),
        ], { below: SUMMARY_COPY.offTarget('192', '240'), above: SUMMARY_COPY.offTarget('252.5', '240') }],
        ['does not name a clock by a rate less than half a hundredth off', [clock('a', { rate_off_target: -0.004 })], { a: fewestWakeUps }],
        ['names any other clock by the rate it makes',
            [clock('a', { wake_ups_per_minute: 4, window_count: 2 }), clock('b', { wake_ups_per_minute: 9, window_count: 7 })], { b: another }],
        ['names a clock that holds the rate on a deadlock build by its trade-off, as its verdict does not decide', [
            clock('a', { verdict: 'no recovery', deadlock: true, wake_ups_per_minute: 6 }),
            clock('b', { verdict: 'stable', deadlock: true, wake_ups_per_minute: 9, window_count: 5 }),
        ], { a: fewestWakeUps, b: another }],
    ])('%s', (_, clocks, names) => {
        expect(Object.fromEntries(Object.keys(names).map(id => [id, nameOf(clocks, id)]))).toEqual(names);
    });

    it('is empty for an index with no clock', () => {
        expect(plainClockName([], 0)).toBe('');
    });

    it('keeps the engine name as it is', () => {
        expect(clockTechnicalName(clock('a'))).toBe('Engine name of a');
    });
});

describe('pickNameMeaning', () => {
    const decidersAndWakeUps = () => [
        clock('a', { wake_ups_per_minute: 8, window_count: 6, deciders: 10 }),
        clock('b', { wake_ups_per_minute: 12, window_count: 3, deciders: 6 }),
    ];
    const meaning = (clocks: SummaryClock[], id: string, rule: PickRule | null = null) =>
        pickNameMeaning(clocks, clocks.findIndex(it => it.id === id), rule);
    /** The pick's reason for the clock with the fewest deciders of these contenders, on a moving belt unless told otherwise */
    const reason = (contenders: string, belt = RECOMMENDED_COPY.beltMoving) =>
        `Fewest deciders of the clocks that ${contenders}${belt}: the least wiring to do by hand.`;
    const recover = 'keep making 240/s and recover';

    // what is said of clock b
    it.each<[string, SummaryClock[], PickRule | null, string]>([
        ['says what Fewest deciders is for, in the words of the pick\'s reason',
            [clock('a', { wake_ups_per_minute: 8, deciders: 10, beltLabel: '' }), clock('b', { wake_ups_per_minute: 12, deciders: 6, beltLabel: '' })], null, reason(recover, '')],
        ['names the moving belt the clocks are made for, as the reason does', decidersAndWakeUps(), null, reason(recover)],
        ['names the backed-up belts the build asks for, as the reason does',
            decidersAndWakeUps(), { backedUpBelts: true, searchedForFewerWakeUps: false }, reason(recover, RECOMMENDED_COPY.beltBackedUp)],
        ['says the clocks that hold the rate on a build with a deadlock risk, as the reason does',
            [clock('a', { wake_ups_per_minute: 8, deciders: 10, deadlock: true }), clock('b', { wake_ups_per_minute: 12, deciders: 6, deadlock: true })],
            null, reason('hold 240/s')],
    ])('%s', (_, clocks, rule, expected) => {
        expect(meaning(clocks, 'b', rule)).toBe(expected);
    });

    it('has nothing to say of a clock with any other name', () => {
        expect(meaning(decidersAndWakeUps(), 'a')).toBe('');
        expect(meaning([clock('a', { wake_ups_per_minute: 8, window_count: 6 }), clock('b', { wake_ups_per_minute: 12, window_count: 3 })], 'b')).toBe('');
    });
});

describe('recoversOf', () => {
    it('says yes for a stable clock', () => {
        expect(recoversOf(clock('a'))).toMatchObject({ kind: 'yes', value: SUMMARY_COPY.recoversYes });
    });

    it('says no, with the causes it does not recover from', () => {
        const result = recoversOf(clock('a', { verdict: 'no recovery', loss: { broken_by: ['coal stops arriving', 'iron plate is not taken away'] } }));
        expect(result.kind).toBe('no');
        expect(result.detail).toContain('coal stops arriving, or after iron plate is not taken away');
        expect(recoversOf(clock('b', { verdict: 'no recovery' })).detail).toContain('an input stops arriving');
    });

    it('says which losses were not tried, since the clock already failed one', () => {
        const notTried = ' Not tried, since one failure is enough: iron plate stops arriving, iron gear wheel is not taken away.';
        const stopped = clock('a', { verdict: 'no recovery', loss: { broken_by: ['coal stops arriving'], not_tried: ['iron plate stops arriving', 'iron gear wheel is not taken away'] } });
        expect(recoversOf(stopped).detail).toBe(`${SUMMARY_COPY.recoversNoDetail('coal stops arriving')}${notTried}`);
        expect(rateWarningOf(stopped)).toContain(`after coal stops arriving for a while, the build does not get back to its rate by itself in the simulator.${notTried}`);
        // all tried: nothing is said
        expect(recoversOf(clock('b', { verdict: 'no recovery', loss: { broken_by: ['coal stops arriving'] } })).detail).not.toContain('Not tried');
    });

    it('says "in the simulator" for yes and for no alike', () => {
        expect(recoversOf(clock('a')).detail).toMatch(/^In the simulator, /);
        expect(recoversOf(clock('b', { verdict: 'no recovery' })).detail).toMatch(/^In the simulator, /);
    });

    it('says why the recovery of a clock that holds could not be tried', () => {
        const reason = 'A clock of 47.537 ticks does not repeat in whole ticks, so its output cannot be counted by the period';
        const untried = clock('a', { loss: null });
        untried.assessment.backpressure_loss_not_tried = reason;
        expect(recoversOf(untried)).toEqual({ kind: 'not-tested', value: SUMMARY_COPY.recoversUnavailable, detail: SUMMARY_COPY.recoversNotTriedDetail(reason) });
        // the why itself, and the period that closes it
        expect(recoversOf(untried).detail).toContain(`: ${reason}.`);
    });

    it('says not tested for a clock that does not hold its rate', () => {
        expect(recoversOf(clock('a', { verdict: 'unstable' }))).toMatchObject({ kind: 'not-tested', value: SUMMARY_COPY.recoversNotTested });
    });
});

describe('lossLimitText', () => {
    const names: Record<string, string> = { nutrients: 'Nutrients', 'iron-bacteria': 'Iron bacteria' };
    const itemLabel = (id: string) => names[id] ?? id;
    const limited = (ticks: number, item: string, verdict: 'stable' | 'no recovery' = 'stable') => clock('a', { verdict, loss: { loss_limit: { ticks, item } } });

    it('names the longest loss checked and the item that spoils first, for a build whose items spoil', () => {
        expect(lossLimitText(limited(13500, 'nutrients'), itemLabel)).toBe(SUMMARY_COPY.recoversLossLimit('3 min 45 s', 'nutrients'));
        expect(lossLimitText(limited(2700, 'iron-bacteria', 'no recovery'), itemLabel)).toBe(SUMMARY_COPY.recoversLossLimit('45 s', 'iron bacteria'));
    });

    it('says nothing for a build whose items do not spoil, or a clock whose losses were not tried', () => {
        expect(lossLimitText(clock('a'), itemLabel)).toBeNull();
        expect(lossLimitText(clock('b', { loss: null }), itemLabel)).toBeNull();
    });

    it.each([[2700, '45 s'], [10800, '3 min'], [40500, '11 min 15 s'], [750, '12.5 s']])('says %i ticks in minutes and seconds: %s', (ticks, text) => {
        expect(minutesAndSecondsText(ticks)).toBe(text);
    });
});

describe('makesText and wakeUpsText', () => {
    it('names the total scope unless there is exactly one copy', () => {
        expect(makesText(clock('a'), 11)).toEqual({ value: SUMMARY_COPY.makes('240'), sub: SUMMARY_COPY.allCopies(11) });
        expect(makesText(clock('a'), 1)).toEqual({ value: SUMMARY_COPY.makes('240'), sub: '' });
    });

    it.each([0.0625, 0.9999, 1.0001])('keeps Copies %s exact while leaving the total rate and one-copy wake-ups unchanged', copies => {
        const result = clock('a', { rate_off_target: -0.125, wake_ups_per_minute: 17.6 });
        expect(makesText(result, copies)).toEqual({ value: SUMMARY_COPY.makes('239.88'), sub: `all ${copies} copies` });
        // rounded as the table rounds them, for one copy
        expect(wakeUpsText(result)).toEqual({ value: SUMMARY_COPY.wakeUps(18), sub: SUMMARY_COPY.oneCopy });
    });

    it('rounds the rate to two decimals', () => {
        expect(makesText(clock('a', { rate_off_target: -0.123 }), 1).value).toBe(SUMMARY_COPY.makes('239.88'));
    });

    it('says where the wake-ups are the average of the start points, and the cold start\'s figure where it is far off it', () => {
        const averaged = (cold: number, figures: number[]): SummaryClock => {
            const base = clock('a');
            const mean = [cold, ...figures].reduce((sum, it) => sum + it, 0) / (figures.length + 1);
            return { ...base, assessment: { ...base.assessment, wake_ups_per_minute: mean,
                wake_ups_from_starts: { places: [0, ...figures.map((_, index) => 28 * (index + 1))], wake_ups_per_minute: [cold, ...figures], mean } } };
        };
        expect(wakeUpsText(averaged(978.6, Array(11).fill(1182.6)))).toEqual({ value: '1166 a minute', sub: 'one copy, average of 12 start points; 979 from a cold start' });
        expect(wakeUpsText(averaged(1258.3, [1258.3, 1257.9, 1278.2, 1277.5, 1207.7, 1207.7, 1207.5, 1277.5, 1277.5, 1226.3, 1226.5])))
            .toEqual({ value: '1247 a minute', sub: 'one copy, average of 12 start points' });
    });

    it('says "Not counted" when they were not', () => {
        expect(wakeUpsText(clock('a', { wake_ups_per_minute: null }))).toEqual({ value: SUMMARY_COPY.wakeUpsNotCounted, sub: '' });
    });
});

describe('beltLine, beltValue and beltValueSub', () => {
    const moving = { backedUpBelts: false, searchedForFewerWakeUps: false };
    const backedUp = { backedUpBelts: true, searchedForFewerWakeUps: false };
    const { beltLineMoving, beltLineBackedUp, beltMoving, beltBackedUp } = SUMMARY_COPY;

    // the line, the tile's word and the line under it
    it.each<[string, PickRule | null, string, string, string, string | undefined]>([
        ['says moving for a clock made for a moving belt', moving, 'moving (+4 ticks)', beltLineMoving, beltMoving, undefined],
        ['says backed up when the build says so', backedUp, 'moving (+4 ticks)', beltLineBackedUp, beltBackedUp, undefined],
        ['says backed up when the clock says so', moving, 'backed-up', beltLineBackedUp, beltBackedUp, undefined],
        ['says there is no belt when no clocked inserter picks up from one', moving, '', SUMMARY_COPY.beltLineNone, SUMMARY_COPY.beltNone, SUMMARY_COPY.beltNoneSub],
        ['says there is no belt without a rule either', null, '', SUMMARY_COPY.beltLineNone, SUMMARY_COPY.beltNone, SUMMARY_COPY.beltNoneSub],
        ['goes by the label alone without a rule', null, 'moving (+2 ticks)', beltLineMoving, beltMoving, undefined],
    ])('%s', (_, rule, label, line, value, sub) => {
        expect([beltLine(rule, label), beltValue(rule, label), beltValueSub(rule, label)]).toEqual([line, value, sub]);
    });
});

describe('beltCellText', () => {
    it('says the belt in the belt question\'s words, with the slack', () => {
        expect(beltCellText('moving (+4 ticks)')).toBe(SUMMARY_COPY.beltCellMoving('+4 ticks'));
        expect(beltCellText('moving (+2–4 ticks)')).toBe(SUMMARY_COPY.beltCellMoving('+2–4 ticks'));
        expect(beltCellText('backed-up')).toBe(SUMMARY_COPY.beltBackedUp);
        expect(beltCellText('')).toBe('');
    });
});

describe('differenceFromRecommended', () => {
    const recommended = clock('r', { wake_ups_per_minute: 10 });
    const offRate = { verdict: 'unstable', meets_target_rate: false, rate_off_target: -48, wake_ups_per_minute: 30 } as const;
    /** The wake-ups sentence, with the count and its time or times spelled out */
    const wakes = (howMany: string) => `It wakes inserters ${howMany} a minute than the recommended clock.`;

    it.each<[string, SummaryClock, string]>([
        ['says the rate first', clock('s', offRate), `${SUMMARY_COPY.differsRate('192', '240')} ${wakes('20 more times')}`],
        // one time, not one times
        ['says one more wake-up', clock('s', { wake_ups_per_minute: 11 }), wakes('1 more time')],
        ['says fewer wake-ups, then the belt', clock('s', { wake_ups_per_minute: 4, matches_belt_choice: false }), `${wakes('6 fewer times')} ${SUMMARY_COPY.differsBelt}`],
        ['says nothing of wake-ups that round to the same', clock('s', { wake_ups_per_minute: 10.2 }), SUMMARY_COPY.differsNothing],
        ['says nothing of uncounted wake-ups', clock('s', { wake_ups_per_minute: null }), SUMMARY_COPY.differsNothing],
        ['says when it does not recover', clock('s', { verdict: 'no recovery' }), SUMMARY_COPY.differsNoRecovery],
    ])('%s', (_, selected, expected) => {
        expect(differenceFromRecommended(selected, recommended)).toBe(expected);
    });

    it('keeps to two sentences', () => {
        const selected = clock('s', { ...offRate, matches_belt_choice: false });
        expect(differenceFromRecommended(selected, recommended).match(/\./g)?.length).toBe(2);
    });
});

describe('foldedMakes', () => {
    const folded = SUMMARY_COPY.foldedMakes(3, '240');

    it.each<[string, SummaryClock[], string | null]>([
        ['folds 3 or more clocks that make the same rate into one line', [clock('a'), clock('b'), clock('c')], folded],
        ['keeps the column for two clocks', [clock('a'), clock('b')], null],
        ['keeps the column when one clock differs at the second decimal', [clock('a'), clock('b'), clock('c', { rate_off_target: -0.01 })], null],
        ['folds clocks that differ only past the second decimal', [clock('a'), clock('b', { rate_off_target: 0.001 }), clock('c', { rate_off_target: -0.002 })], folded],
    ])('%s', (_, clocks, expected) => {
        expect(foldedMakes(clocks)).toBe(expected);
    });
});

describe('worksOf', () => {
    it.each<[string, SummaryClock, ReturnType<typeof worksOf>]>([
        ['says yes for a clock that holds the rate and recovers, made for the belt asked for', clock('a'), { kind: 'yes', text: SUMMARY_COPY.worksYes }],
        ['says a clock for backed-up belts is only for them', clock('a', { matches_belt_choice: false }), { kind: 'caution', text: SUMMARY_COPY.worksBackedUpBelts }],
        ['names the rate a clock that holds a rate misses, before whether it recovers',
            clock('a', { verdict: 'no recovery', meets_target_rate: false, rate_off_target: -48 }), { kind: 'no', text: SUMMARY_COPY.worksOffTarget('192') }],
        ['calls a clock that does not hold its rate unstable, whatever rate it runs at',
            clock('a', { verdict: 'unstable', meets_target_rate: false, rate_off_target: -48 }), { kind: 'no', text: SUMMARY_COPY.worksUnstable }],
        ['calls a clock that does not hold its rate unstable at the target rate too', clock('b', { verdict: 'unstable' }), { kind: 'no', text: SUMMARY_COPY.worksUnstable }],
        ['says a clock that does not recover so, before its belt',
            clock('a', { verdict: 'no recovery', matches_belt_choice: false }), { kind: 'caution', text: SUMMARY_COPY.worksNoRecovery }],
    ])('%s', (_, result, expected) => {
        expect(worksOf(result)).toEqual(expected);
    });
});

describe('SUMMARY_COPY', () => {
    it('uses the glossary words, not the old ones', () => {
        const texts = Object.values(SUMMARY_COPY).map(it => typeof it === 'string' ? it : (it as (...args: unknown[]) => string)('2', '3'));
        for (const text of texts) {
            expect(text).not.toMatch(/potential|backpressure|hands?\b|transfer/i);
            expect(text.length).toBeGreaterThan(0);
        }
    });
});
