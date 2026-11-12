import { describe, expect, it } from 'vitest';
import type { ClockRanking, ClockVerdict } from 'clock-generator/browser';
import { rateWarningOf } from './rateWarning';
import { startCheckSummary } from './modelAssumptions';
import {
    REASON_WORDS,
    SUMMARY_COPY,
    attemptResultOf,
    outputTermOf,
    beltCellText,
    beltLine,
    beltValue,
    beltValueSub,
    clockBadges,
    signalsText,
    differenceFromRecommended,
    foldedMakes,
    makesText,
    recoversOf,
    lossLimitText,
    minutesAndSecondsText,
    pickNameMeaning,
    wakeUpsText,
    worksOf,
    type SummaryClock,
} from './clockSummary';

const TARGET = 240;

type Loss = NonNullable<SummaryClock['assessment']['disturbance_trial']>;

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
        wake_ups_per_minute: 10,
        window_count: 4,
        ...ranking,
    };
    const tried: Loss | null = verdict === 'unstable' ? null : {
        survives: verdict === 'stable', broken_by: verdict === 'no recovery' ? ['an input stops arriving'] : [], recovered_after_window_cycles: verdict === 'stable' ? 1 : null,
    };
    return {
        id, label: `Engine name of ${id}`, verdict, beltLabel, deciders,
        deadlockRisk: deadlock ? 'Deadlock risk: inserters 1 and 2 both bring the same item.' : null,
        ranking: full,
        assessment: {
            holds: verdict !== 'unstable',
            items_per_second: TARGET + full.rate_off_target,
            wake_ups_per_minute: full.wake_ups_per_minute,
            disturbance_trial: loss === null || tried === null ? null : { ...tried, ...loss },
            start_dependence: null,
        },
    };
}

/** The chips beside a clock's name, as their words */
const nameOf = (clocks: SummaryClock[], id: string) => clockBadges(clocks, clocks.findIndex(it => it.id === id)).map(badge => badge.text);

describe('sampled starts remain separate from rate and recovery', () => {
    it('names a target-rate dependent clock and retains its evaluated recovery and actual sample counts', () => {
        const dependent = clock('dependent', { verdict: 'unstable', meets_target_rate: false });
        dependent.assessment = { ...dependent.assessment, holds: true,
            disturbance_trial: { survives: true, broken_by: [], recovered_after_window_cycles: 2 },
            start_dependence: { verdict: 'start-dependent', expected_output_items: 240,
                starts: ['cold', 'ascending'].map((id, i) => ({ id, label: id, reaches_target: i === 0,
                    output_items_per_window_cycle: i === 0 ? 240 : 120, cycle: null, off_bins: null, span_items: null, long_run_keeps_up: i === 0 })) } };
        expect(nameOf([dependent], 'dependent')).toEqual([SUMMARY_COPY.startDependent]);
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
        expect(nameOf([baseline], 'baseline')).toEqual([SUMMARY_COPY.recoveryUnavailable]);
        expect(worksOf(baseline)).toEqual({ kind: 'caution', text: SUMMARY_COPY.recoveryUnavailable });
        expect(differenceFromRecommended(baseline, clock('recommended'))).toBe('Recovery results are unavailable for this clock.');
    });
});

describe('clockBadges', () => {
    const { fewestWakeUps, fewestDeciders } = SUMMARY_COPY;

    // the chips asked of each clock, by id: the recommended clock has its own chip, so none for what it has fewest of
    it.each<[string, SummaryClock[], Record<string, string[]>]>([
        ['gives the fewest-wakeups chip to a tied clock that is not the recommended one, not to the recommended one',
            [clock('a', { wake_ups_per_minute: 8.0001 }), clock('b', { wake_ups_per_minute: 8 })], { a: [], b: [fewestWakeUps] }],
        ['gives no chip to a clock with more wakeups',
            [clock('a', { wake_ups_per_minute: 12 }), clock('b', { wake_ups_per_minute: 8 })], { a: [], b: [] }],
        ['gives the fewest-deciders chip to a clock with more wakeups but the fewest deciders',
            [clock('a', { wake_ups_per_minute: 8, window_count: 6, deciders: 10 }), clock('b', { wake_ups_per_minute: 12, window_count: 3, deciders: 6 })],
            { b: [fewestDeciders], a: [] }],
        ['does not give Fewest deciders to a clock that only ties the recommended clock', [
            clock('a', { wake_ups_per_minute: 8, window_count: 6, deciders: 4 }),
            clock('b', { wake_ups_per_minute: 12, window_count: 6, deciders: 4 }),
            clock('c', { wake_ups_per_minute: 15, window_count: 3, deciders: 6 }),
        ], { a: [], b: [], c: [] }],
        ['does not give Fewest deciders to a clock that only ties a clock tied for the fewest wakeups', [
            clock('a', { wake_ups_per_minute: 8.0001, window_count: 6, deciders: 8 }),
            clock('b', { wake_ups_per_minute: 8, window_count: 6, deciders: 4 }),
            clock('c', { wake_ups_per_minute: 15, window_count: 6, deciders: 4 }),
        ], { a: [], b: [fewestWakeUps], c: [] }],
        ['gives Fewest deciders to a clock that has fewer than the recommended clock and every clock with the fewest wakeups', [
            clock('a', { wake_ups_per_minute: 8, window_count: 6, deciders: 5 }),
            clock('b', { wake_ups_per_minute: 12, window_count: 6, deciders: 4 }),
            clock('c', { wake_ups_per_minute: 15, window_count: 6, deciders: 4 }),
        ], { b: [fewestDeciders], c: [fewestDeciders] }],
        ['says a clock that has no recovery, or underproduces, so', [
            clock('a'),
            clock('b', { verdict: 'no recovery', meets_target_rate: false }),
            clock('c', { verdict: 'unstable', meets_target_rate: false, holds_expected_output: false }),
        ], { b: [SUMMARY_COPY.worksNoRecovery], c: [SUMMARY_COPY.underproduces] }],
        ['says that a clock off the setpoint underproduces or overproduces, before its verdict', [
            clock('a'),
            clock('below', { verdict: 'unstable', meets_target_rate: false, rate_off_target: -48 }),
            clock('above', { meets_target_rate: false, rate_off_target: 12.5 }),
        ], { below: [SUMMARY_COPY.underproduces], above: [SUMMARY_COPY.overproduces] }],
        ['does not say a rate less than half a hundredth off', [clock('a', { rate_off_target: -0.004 })], { a: [] }],
        ['gives a clock with a deadlock risk that holds the rate no recovery chip, as its verdict does not decide', [
            clock('a', { verdict: 'no recovery', deadlock: true, wake_ups_per_minute: 6 }),
            clock('b', { verdict: 'stable', deadlock: true, wake_ups_per_minute: 9, window_count: 5 }),
        ], { a: [], b: [] }],
    ])('%s', (_, clocks, names) => {
        expect(Object.fromEntries(Object.keys(names).map(id => [id, nameOf(clocks, id)]))).toEqual(names);
    });

    it('is empty for an index with no clock', () => {
        expect(clockBadges([], 0)).toEqual([]);
    });

    it('gives the status chip what outputTermOf gives, with what is said beside it', () => {
        expect(clockBadges([clock('below', { verdict: 'unstable', meets_target_rate: false, rate_off_target: -48 })], 0))
            .toEqual([{ kind: 'status', text: 'Underproduces', detail: 'makes 192/s of 240/s' }]);
        expect(clockBadges([withLoss(clock('a', { verdict: 'unstable' }), 'belt_gaps')], 0))
            .toEqual([{ kind: 'status', text: 'Underproduces', detail: 'Missed pickups due to belt gaps' }]);
        expect(clockBadges([clock('a')], 0)).toEqual([]);
    });
});

/** A clock with a loss on a lane its copies share, and the reason code of its cause where one is given */
function withLoss(base: SummaryClock, code?: 'belt_gaps'): SummaryClock {
    return { ...base, assessment: { ...base.assessment, shared_lane_losses: [{} as never] },
        checkedLanes: { cause: { ...(code !== undefined && { reason: { code, data: { missed: 6, with_gap: 3 } } }) } } as never };
}

describe('outputTermOf', () => {
    it.each<[string, SummaryClock, ReturnType<typeof outputTermOf>]>([
        ['is Stable for a stable clock at the setpoint', clock('a'), { term: 'Stable' }],
        ['is Stable for a clock with no recovery at the setpoint: its own chip says that', clock('a', { verdict: 'no recovery' }), { term: 'Stable' }],
        ['is Underproduces below the setpoint, with the rate', clock('a', { verdict: 'unstable', meets_target_rate: false, rate_off_target: -48 }),
            { term: 'Underproduces', detail: 'makes 192/s of 240/s' }],
        ['is Overproduces above the setpoint, with the rate, whatever the verdict', clock('a', { verdict: 'unstable', meets_target_rate: false, rate_off_target: 10 }),
            { term: 'Overproduces', detail: 'makes 250/s of 240/s' }],
        ['is Overproduces for a stable clock over the setpoint', clock('a', { meets_target_rate: false, rate_off_target: 12.5, stable_above_target: true }),
            { term: 'Overproduces', detail: 'makes 252.5/s of 240/s' }],
        ['is Overproduces for a rounded clock that runs fast, at the target by the selection\'s rule', clock('a', { rate_off_target: 0.24, runs_fast: 0.001 }),
            { term: 'Overproduces', detail: 'makes 240.24/s of 240/s' }],
        ['is Underproduces at the setpoint with a loss on a shared lane, with the words for its reason code',
            withLoss(clock('a', { verdict: 'unstable' }), 'belt_gaps'), { term: 'Underproduces', detail: 'Missed pickups due to belt gaps' }],
        ['is Underproduces at the setpoint with a loss on a shared lane and no reason code, with nothing beside it',
            withLoss(clock('a', { verdict: 'unstable' })), { term: 'Underproduces' }],
        ['is Overproduces at the setpoint with no shared-lane loss where the judged output is above the expected output',
            { ...clock('a', { verdict: 'unstable' }), asBuilt: { actual_output_items: 352 } as never, expectedOutputItems: 336 }, { term: 'Overproduces' }],
        ['is Underproduces at the setpoint with no shared-lane loss where the judged output is below the expected output',
            { ...clock('a', { verdict: 'unstable' }), asBuilt: { actual_output_items: 320 } as never, expectedOutputItems: 336 }, { term: 'Underproduces' }],
        // neither number decides (no clock of the samples comes here): Underproduces, as the verdict unstable said before
        ['is Underproduces at the setpoint with no shared-lane loss where the judged output is not known',
            { ...clock('a', { verdict: 'unstable' }), asBuilt: null, expectedOutputItems: 336 }, { term: 'Underproduces' }],
        ['is Underproduces at the setpoint with no shared-lane loss where the judged output is the expected output',
            { ...clock('a', { verdict: 'unstable' }), asBuilt: { actual_output_items: 336 } as never, expectedOutputItems: 336 }, { term: 'Underproduces' }],
    ])('%s', (_, given, expected) => {
        expect(outputTermOf(given)).toEqual(expected);
    });

    it('says the rate with the verb of a target that counts the item destroyed', () => {
        const destroyed = { ...clock('a', { meets_target_rate: false, rate_off_target: -40 }), counts: 'destroyed' as const };
        expect(outputTermOf(destroyed).detail).toBe('destroys 200/s of 240/s');
    });
});

describe('attemptResultOf', () => {
    it('says a swing count that holds holds the rate, and one that does not underproduces or overproduces by its output', () => {
        expect(attemptResultOf({ holds: true, actual_output_items: 32, expected_output_items: 32 })).toBe('Holds the rate');
        expect(attemptResultOf({ holds: false, actual_output_items: 16, expected_output_items: 32 })).toBe('Underproduces');
        expect(attemptResultOf({ holds: false, actual_output_items: 352, expected_output_items: 336 })).toBe('Overproduces');
    });
});

describe('REASON_WORDS', () => {
    it('has the words for each reason code the engine gives', () => {
        expect(Object.keys(REASON_WORDS).sort()).toEqual(['belt_gaps', 'join_full']);
        expect(REASON_WORDS.belt_gaps).toBe('Missed pickups due to belt gaps');
        expect(REASON_WORDS.join_full).not.toBe('');
    });
});

describe('pickNameMeaning', () => {
    const decidersAndWakeUps = () => [
        clock('a', { wake_ups_per_minute: 8, window_count: 6, deciders: 10 }),
        clock('b', { wake_ups_per_minute: 12, window_count: 3, deciders: 6 }),
    ];
    const meaning = (clocks: SummaryClock[], id: string) => pickNameMeaning(clocks, clocks.findIndex(it => it.id === id));
    /** The pick's reason for the clock with the fewest deciders of these contenders */
    const reason = (contenders: string) => `Fewest deciders of the clocks that ${contenders}. This is the least wiring to do by hand.`;
    const recover = 'keep making 240/s and go back to it after a stop';

    // what is said of clock b
    it.each<[string, SummaryClock[], string]>([
        ['says what Fewest deciders is for, in the words of the pick\'s reason',
            [clock('a', { wake_ups_per_minute: 8, deciders: 10, beltLabel: '' }), clock('b', { wake_ups_per_minute: 12, deciders: 6, beltLabel: '' })], reason(recover)],
        ['names no belt, as the reason does not', decidersAndWakeUps(), reason(recover)],
        ['says the clocks that hold the rate on a build with a deadlock risk, as the reason does',
            [clock('a', { wake_ups_per_minute: 8, deciders: 10, deadlock: true }), clock('b', { wake_ups_per_minute: 12, deciders: 6, deadlock: true })],
            reason('hold 240/s')],
    ])('%s', (_, clocks, expected) => {
        expect(meaning(clocks, 'b')).toBe(expected);
    });

    it('has nothing to say of a clock without the chip', () => {
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
        expect(rateWarningOf(stopped)).toContain(`after coal stops arriving for a while, the build does not go back to its rate by itself in the simulator.${notTried}`);
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
        untried.assessment.disturbance_trial_not_tried = reason;
        expect(recoversOf(untried)).toEqual({ kind: 'not-tested', value: SUMMARY_COPY.recoversUnavailable, detail: SUMMARY_COPY.recoversNotTriedDetail(reason) });
        // the why itself, and the window cycle that closes it
        expect(recoversOf(untried).detail).toContain(`: ${reason}.`);
    });

    it('says not tested for a clock that underproduces', () => {
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

    it.each([0.0625, 0.9999, 1.0001])('keeps Copies %s exact while leaving the total rate and one-copy wakeups unchanged', copies => {
        const result = clock('a', { rate_off_target: -0.125, wake_ups_per_minute: 17.6 });
        expect(makesText(result, copies)).toEqual({ value: SUMMARY_COPY.makes('239.88'), sub: `all ${copies} copies` });
        // rounded as the table rounds them, for one copy
        expect(wakeUpsText(result)).toEqual({ value: SUMMARY_COPY.wakeUps(18), sub: SUMMARY_COPY.oneCopy });
    });

    it('rounds the rate to two decimals', () => {
        expect(makesText(clock('a', { rate_off_target: -0.123 }), 1).value).toBe(SUMMARY_COPY.makes('239.88'));
    });

    it('says where the wakeups are the average of the start points, and the cold start\'s figure where it is far off it', () => {
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
    const { beltLineMoving, beltLineBackedUp, beltMoving, beltBackedUp } = SUMMARY_COPY;

    // the engine's belt for the clock: the line, the tile's word and the line under it
    it.each<[string, string, string, string, string | undefined]>([
        ['says moving for a clock the engine made for a moving belt', 'moving', beltLineMoving, beltMoving, undefined],
        ['says backed up for a clock the engine made for a backed-up belt, whatever the belt setting', 'backed-up', beltLineBackedUp, beltBackedUp, undefined],
        ['says moving for the label of a clock kept from an engine that gave slack', 'moving (+4 ticks)', beltLineMoving, beltMoving, undefined],
        ['says there is no belt when no clocked inserter picks up from one', '', SUMMARY_COPY.beltLineNone, SUMMARY_COPY.beltNone, SUMMARY_COPY.beltNoneSub],
    ])('%s', (_, label, line, value, sub) => {
        expect([beltLine(label), beltValue(label), beltValueSub(label)]).toEqual([line, value, sub]);
    });
});

describe('beltCellText', () => {
    it('says the belt the engine made the clock for', () => {
        expect(beltCellText('moving')).toBe(SUMMARY_COPY.beltMoving);
        expect(beltCellText('moving (+4 ticks)')).toBe(SUMMARY_COPY.beltMoving);
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
        ['says that a clock at the setpoint underproduces', withLoss(clock('s', { verdict: 'unstable' })), SUMMARY_COPY.differsUnderproduces],
        ['says that a clock at the setpoint overproduces',
            { ...clock('s', { verdict: 'unstable' }), asBuilt: { actual_output_items: 352 } as never, expectedOutputItems: 336 }, SUMMARY_COPY.differsOverproduces],
        // one time, not one times
        ['says one more wakeup', clock('s', { wake_ups_per_minute: 11 }), wakes('1 more time')],
        ['says fewer wakeups', clock('s', { wake_ups_per_minute: 4 }), wakes('6 fewer times')],
        ['says nothing of wakeups that round to the same', clock('s', { wake_ups_per_minute: 10.2 }), SUMMARY_COPY.differsNothing],
        ['says nothing of uncounted wakeups', clock('s', { wake_ups_per_minute: null }), SUMMARY_COPY.differsNothing],
        ['says when it does not recover', clock('s', { verdict: 'no recovery' }), SUMMARY_COPY.differsNoRecovery],
    ])('%s', (_, selected, expected) => {
        expect(differenceFromRecommended(selected, recommended)).toBe(expected);
    });

    it('keeps to two sentences', () => {
        const selected = clock('s', { ...offRate, verdict: 'no recovery' });
        expect(differenceFromRecommended(selected, recommended).match(/\./g)?.length).toBe(2);
    });
});

describe('signalsText', () => {
    it('rounds the signals of one copy a minute, as the wakeups are', () => {
        const counted = clock('a');
        counted.assessment = { ...counted.assessment, signals_per_minute: 40.4 };
        expect(signalsText(counted)).toEqual({ value: SUMMARY_COPY.wakeUps(40), sub: SUMMARY_COPY.oneCopy });
    });

    it('says "Not counted" when they were not, or the clock was kept before they were counted', () => {
        const uncounted = clock('a');
        uncounted.assessment = { ...uncounted.assessment, signals_per_minute: null };
        expect(signalsText(uncounted)).toEqual({ value: SUMMARY_COPY.wakeUpsNotCounted, sub: '' });
        expect(signalsText(clock('b'))).toEqual({ value: SUMMARY_COPY.wakeUpsNotCounted, sub: '' });
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
        ['says that a clock under the setpoint underproduces, before whether it recovers',
            clock('a', { verdict: 'no recovery', meets_target_rate: false, rate_off_target: -48 }), { kind: 'no', text: 'Underproduces' }],
        ['says that a clock whose verdict is unstable underproduces below the setpoint',
            clock('a', { verdict: 'unstable', meets_target_rate: false, rate_off_target: -48 }), { kind: 'no', text: 'Underproduces' }],
        ['says that a clock whose verdict is unstable overproduces above the setpoint',
            clock('a', { verdict: 'unstable', meets_target_rate: false, rate_off_target: 10 }), { kind: 'no', text: 'Overproduces' }],
        ['says that a clock whose verdict is unstable underproduces at the target rate too', withLoss(clock('b', { verdict: 'unstable' })), { kind: 'no', text: 'Underproduces' }],
        ['says a clock that does not recover so',
            clock('a', { verdict: 'no recovery' }), { kind: 'caution', text: SUMMARY_COPY.worksNoRecovery }],
    ])('%s', (_, result, expected) => {
        expect(worksOf(result)).toEqual(expected);
    });
});

describe('SUMMARY_COPY', () => {
    it('uses the glossary words, not the old ones', () => {
        const texts = Object.values(SUMMARY_COPY)
            .map(it => typeof it === 'string' ? it : (it as (...args: unknown[]) => string)('2', '3'));
        for (const text of texts) {
            expect(text).not.toMatch(/potential|backpressure|hands?\b|transfer|starved|jammed|wake window|wake-up/i);
            expect(text.length).toBeGreaterThan(0);
        }
    });
});
