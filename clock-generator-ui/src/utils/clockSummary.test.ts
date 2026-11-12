import { describe, expect, it } from 'vitest';
import type { ClockRanking, ClockVerdict } from 'clock-generator/browser';
import { rateWarningOf } from './rateWarning';
import { startCheckSummary } from './modelAssumptions';
import {
    REASON_WORDS,
    SUMMARY_COPY,
    attemptResultOf,
    outputTermOf,
    clockBadges,
    signalsText,
    differenceFromRecommended,
    foldedMakes,
    makesText,
    recoversOf,
    lossLimitText,
    minutesAndSecondsText,
    pickNameMeaning,
    statusOf,
    wakeUpsText,
    type SummaryClock,
} from './clockSummary';
import { AUTOMATION_240, ELECTROMAGNETIC_330_TWO_SWINGS, viewOf, viewsOf } from '../test/checkedLanesFixtures';

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
        expect(statusOf(dependent)).toEqual({ kind: 'start-dependent', text: 'Start-dependent' });
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
        expect(nameOf([baseline], 'baseline')).toEqual([SUMMARY_COPY.error]);
        expect(statusOf(baseline)).toEqual({ kind: 'error', text: 'Error', detail: SUMMARY_COPY.errorBaselineMissed });
        expect(differenceFromRecommended(baseline, clock('recommended'))).toBe('Recovery results are unavailable for this clock.');
    });
});

describe('clockBadges', () => {
    const { fewestWakeUps, fewestDeciders, stable } = SUMMARY_COPY;

    // the chips asked of each clock, by id: the recommended clock has its own chip, so none for what it has fewest of
    it.each<[string, SummaryClock[], Record<string, string[]>]>([
        ['gives the fewest-wakeups chip to a tied clock that is not the recommended one, not to the recommended one',
            [clock('a', { wake_ups_per_minute: 8.0001 }), clock('b', { wake_ups_per_minute: 8 })], { a: [stable], b: [stable, fewestWakeUps] }],
        ['gives only Stable to a clock with more wakeups',
            [clock('a', { wake_ups_per_minute: 12 }), clock('b', { wake_ups_per_minute: 8 })], { a: [stable], b: [stable] }],
        ['gives the fewest-deciders chip to a clock with more wakeups but the fewest deciders',
            [clock('a', { wake_ups_per_minute: 8, window_count: 6, deciders: 10 }), clock('b', { wake_ups_per_minute: 12, window_count: 3, deciders: 6 })],
            { b: [stable, fewestDeciders], a: [stable] }],
        ['does not give Fewest deciders to a clock that only ties the recommended clock', [
            clock('a', { wake_ups_per_minute: 8, window_count: 6, deciders: 4 }),
            clock('b', { wake_ups_per_minute: 12, window_count: 6, deciders: 4 }),
            clock('c', { wake_ups_per_minute: 15, window_count: 3, deciders: 6 }),
        ], { a: [stable], b: [stable], c: [stable] }],
        ['does not give Fewest deciders to a clock that only ties a clock tied for the fewest wakeups', [
            clock('a', { wake_ups_per_minute: 8.0001, window_count: 6, deciders: 8 }),
            clock('b', { wake_ups_per_minute: 8, window_count: 6, deciders: 4 }),
            clock('c', { wake_ups_per_minute: 15, window_count: 6, deciders: 4 }),
        ], { a: [stable], b: [stable, fewestWakeUps], c: [stable] }],
        ['gives Fewest deciders to a clock that has fewer than the recommended clock and every clock with the fewest wakeups', [
            clock('a', { wake_ups_per_minute: 8, window_count: 6, deciders: 5 }),
            clock('b', { wake_ups_per_minute: 12, window_count: 6, deciders: 4 }),
            clock('c', { wake_ups_per_minute: 15, window_count: 6, deciders: 4 }),
        ], { b: [stable, fewestDeciders], c: [stable, fewestDeciders] }],
        ['says a clock that has no recovery, or underproduces, so', [
            clock('a'),
            clock('b', { verdict: 'no recovery', meets_target_rate: false }),
            clock('c', { verdict: 'unstable', meets_target_rate: false, holds_expected_output: false }),
        ], { b: [SUMMARY_COPY.noRecovery], c: [SUMMARY_COPY.underproduces] }],
        ['says that a clock off the setpoint underproduces or overproduces, before its verdict', [
            clock('a'),
            clock('below', { verdict: 'unstable', meets_target_rate: false, rate_off_target: -48 }),
            clock('above', { meets_target_rate: false, rate_off_target: 12.5 }),
        ], { below: [SUMMARY_COPY.underproduces], above: [SUMMARY_COPY.overproduces] }],
        ['does not say a rate less than half a hundredth off', [clock('a', { rate_off_target: -0.004 })], { a: [stable] }],
        ['gives a clock with a deadlock risk that meets the target the status the rule gives, as the Status column does', [
            clock('a', { verdict: 'no recovery', deadlock: true, wake_ups_per_minute: 6 }),
            clock('b', { verdict: 'stable', deadlock: true, wake_ups_per_minute: 9, window_count: 5 }),
        ], { a: [SUMMARY_COPY.noRecovery], b: [stable] }],
        ['says No recovery, never Stable, of a clock with no recovery', [clock('a', { verdict: 'no recovery' })], { a: [SUMMARY_COPY.noRecovery] }],
        ['says Stable of a rounded clock that runs fast and meets the target', [clock('a', { rate_off_target: 0.24, runs_fast: 0.001 })], { a: [stable] }],
        ['says Error, not Stable, of a clock that meets the target whose recovery gave no answer, as the Status column does',
            [clock('a', { loss: null })], { a: [SUMMARY_COPY.error] }],
    ])('%s', (_, clocks, names) => {
        expect(Object.fromEntries(Object.keys(names).map(id => [id, nameOf(clocks, id)]))).toEqual(names);
    });

    it('is empty for an index with no clock', () => {
        expect(clockBadges([], 0)).toEqual([]);
    });

    it('gives the status chip what outputTermOf gives, with what is said beside it', () => {
        expect(clockBadges([clock('below', { verdict: 'unstable', meets_target_rate: false, rate_off_target: -48 })], 0))
            .toEqual([{ kind: 'status', status: 'underproduces', text: 'Underproduces', detail: 'makes 192/s of 240/s' }]);
        expect(clockBadges([withLoss(clock('a', { verdict: 'unstable' }), 'belt_gaps')], 0))
            .toEqual([{ kind: 'status', status: 'underproduces', text: 'Underproduces', detail: 'Missed pickups due to belt gaps' }]);
        expect(clockBadges([clock('a')], 0)).toEqual([{ kind: 'status', status: 'stable', text: 'Stable' }]);
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
        ['is Stable for a rounded clock that runs fast and meets the target by the selection\'s rule', clock('a', { rate_off_target: 0.24, runs_fast: 0.001 }),
            { term: 'Stable' }],
        ['is Overproduces for a rounded clock that runs fast and does not meet the target', clock('a', { meets_target_rate: false, rate_off_target: 0.24 }),
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
        expect(Object.keys(REASON_WORDS).sort()).toEqual(['belt_gaps', 'target_full', 'unknown']);
        expect(REASON_WORDS.belt_gaps).toBe('Missed pickups due to belt gaps');
        expect(REASON_WORDS.target_full).not.toBe('');
        // a loss with no diagnostic: the chip stands alone
        expect(REASON_WORDS.unknown).toBe('');
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

/** A clock with a result of an older engine or a trial that stopped: no recovery result, and the engine's reason where it gives one */
function untried(base: SummaryClock, reason?: string): SummaryClock {
    return { ...base, assessment: { ...base.assessment, disturbance_trial: null, ...(reason !== undefined && { disturbance_trial_not_tried: reason }) } };
}

describe('statusOf: the one status the chip, the Status column and the full table say', () => {
    it.each<[string, SummaryClock, ReturnType<typeof statusOf>]>([
        ['is Stable for a clock that holds the rate and recovers', clock('a'), { kind: 'stable', text: 'Stable' }],
        ['says that a clock under the setpoint underproduces, before whether it recovers',
            clock('a', { verdict: 'no recovery', meets_target_rate: false, rate_off_target: -48 }), { kind: 'underproduces', text: 'Underproduces', detail: 'makes 192/s of 240/s' }],
        ['says that a clock whose verdict is unstable underproduces below the setpoint',
            clock('a', { verdict: 'unstable', meets_target_rate: false, rate_off_target: -48 }), { kind: 'underproduces', text: 'Underproduces', detail: 'makes 192/s of 240/s' }],
        ['says that a clock whose verdict is unstable overproduces above the setpoint',
            clock('a', { verdict: 'unstable', meets_target_rate: false, rate_off_target: 10 }), { kind: 'overproduces', text: 'Overproduces', detail: 'makes 250/s of 240/s' }],
        ['is Stable for a rounded clock that runs fast and meets the target, as for any clock that meets it',
            clock('a', { rate_off_target: 0.24, runs_fast: 0.001 }), { kind: 'stable', text: 'Stable' }],
        ['says that a stable clock above the setpoint that does not meet the target overproduces',
            clock('a', { meets_target_rate: false, rate_off_target: 12.5, stable_above_target: true }), { kind: 'overproduces', text: 'Overproduces', detail: 'makes 252.5/s of 240/s' }],
        ['says that a clock whose verdict is unstable underproduces at the target rate too', withLoss(clock('b', { verdict: 'unstable' })), { kind: 'underproduces', text: 'Underproduces' }],
        ['says No recovery of a clock that does not recover', clock('a', { verdict: 'no recovery' }), { kind: 'no-recovery', text: 'No recovery' }],
        ['says No recovery of a clock with a deadlock risk that meets the target: no special case',
            clock('a', { verdict: 'no recovery', deadlock: true }), { kind: 'no-recovery', text: 'No recovery' }],
        ['says that a clock underproduces before its recovery gave no answer', untried(clock('a', { verdict: 'unstable', meets_target_rate: false, rate_off_target: -48 })),
            { kind: 'underproduces', text: 'Underproduces', detail: 'makes 192/s of 240/s' }],
        ['says Error with the engine\'s reason, as data, where the loss trials could not be run',
            untried(clock('a'), 'the build has no loss to try'), { kind: 'error', text: 'Error', detail: 'the build has no loss to try' }],
        ['says Error where the run with nothing cut did not make its expected output',
            clock('a', { loss: { survives: false, broken_by: [] } }), { kind: 'error', text: 'Error', detail: SUMMARY_COPY.errorBaselineMissed }],
        ['says Error where there is no recovery result', untried(clock('a')), { kind: 'error', text: 'Error', detail: SUMMARY_COPY.errorNoResult }],
        ['says Error, not Stable, of a clock that is not unstable and whose recovery gave no answer', untried(clock('a'), 'stopped'),
            { kind: 'error', text: 'Error', detail: 'stopped' }],
        ['says Error of a clock with no recovery whose trials gave no answer', untried(clock('a', { verdict: 'no recovery' })),
            { kind: 'error', text: 'Error', detail: SUMMARY_COPY.errorNoResult }],
    ])('%s', (_, result, expected) => {
        expect(statusOf(result)).toEqual(expected);
    });

    it('says Start-dependent of a clock that is start-dependent, whatever else it is', () => {
        const dependent = clock('a', { verdict: 'unstable', meets_target_rate: false, rate_off_target: -48 });
        dependent.assessment = { ...dependent.assessment, start_dependence: { verdict: 'start-dependent', expected_output_items: 240, starts: [] } };
        expect(statusOf(dependent)).toEqual({ kind: 'start-dependent', text: 'Start-dependent' });
    });

    it('gives the chip and the Status column the same word, from the one rule', () => {
        const clocks = [clock('a'), clock('b', { verdict: 'no recovery' }), untried(clock('c'), 'stopped'),
            clock('d', { verdict: 'unstable', meets_target_rate: false, rate_off_target: -48 })];
        expect(clocks.map((_, i) => clockBadges(clocks, i)[0])).toEqual(clocks.map(it => {
            const { kind, ...status } = statusOf(it);
            return { kind: 'status', status: kind, ...status };
        }));
    });
});

describe('the help of the Status column', () => {
    it('names every status the column can show, each once', () => {
        const help = SUMMARY_COPY.statusHelp.map(([word, meaning]) => `${word}: ${meaning}`).join(' ');
        for (const word of ['Stable', 'Underproduces', 'Overproduces', 'No recovery', 'Error', 'Start-dependent']) {
            expect(help.split(word).length - 1, word).toBe(1);
        }
        expect(SUMMARY_COPY.statusHelp.map(([word]) => word)).toEqual([SUMMARY_COPY.stable, SUMMARY_COPY.underproduces, SUMMARY_COPY.overproduces,
            SUMMARY_COPY.noRecovery, SUMMARY_COPY.error, SUMMARY_COPY.startDependent]);
    });
});

describe('SUMMARY_COPY', () => {
    it('uses the glossary words, not the old ones', () => {
        const texts = Object.values(SUMMARY_COPY)
            .flatMap(it => typeof it === 'string' ? [it] : Array.isArray(it) ? it.flat() : [(it as (...args: unknown[]) => string)('2', '3')]);
        for (const text of texts) {
            expect(text).not.toMatch(/potential|backpressure|hands?\b|transfer|starved|jammed|wake window|wake-up/i);
            expect(text.length).toBeGreaterThan(0);
        }
    });
});

// the rate the engine gives for all the copies on their shared lanes (checked_lanes.copies_made), read from its own results
describe('the rate of a clock with a loss on a shared lane: what all the copies made together', () => {
    const takt = viewOf(AUTOMATION_240, 'takt_batches_observed');
    const stable = viewOf(AUTOMATION_240, 'time_study_windows');
    /** The same clock from an older result, which has no rate of the copies */
    const older = (view: SummaryClock): SummaryClock => ({ ...view, checkedLanes: { ...view.checkedLanes!, copies_made: undefined } });

    it('is the Makes figure of the 216-tick clock: 234.07/s, all 9 copies; the stable clock keeps 240/s', () => {
        expect(makesText(takt, 9)).toEqual({ value: '234.07/s', sub: 'all 9 copies' });
        expect(makesText(stable, 9)).toEqual({ value: '240/s', sub: 'all 9 copies' });
    });

    it('is said where the selected clock differs from the recommended one, in place of "It underproduces."', () => {
        expect(differenceFromRecommended(takt, stable)).toBe(`${SUMMARY_COPY.differsRate('234.07', '240')} It wakes inserters 109 fewer times a minute than the recommended clock.`);
        expect(differenceFromRecommended(viewOf(AUTOMATION_240, 'euclidean_swings'), stable)).toBe(`${SUMMARY_COPY.differsRate('238.77', '240')} It wakes inserters 301 fewer times a minute than the recommended clock.`);
    });

    it('keeps clocks with different rates out of the folded line: electromagnetic science 330 with 2 swings', () => {
        const views = viewsOf(ELECTROMAGNETIC_330_TWO_SWINGS);
        // every clock has a loss; the clock-only runs all make 330/s
        expect(views.every(view => view.assessment.items_per_second === 330 && (view.assessment.shared_lane_losses?.length ?? 0) > 0)).toBe(true);
        expect(foldedMakes(views)).toBeNull();
        // the three with the same rate at two decimals fold
        const same = views.filter(view => view.checkedLanes!.copies_made!.items_per_second.toFixed(2) === '318.59');
        expect(same.length).toBe(3);
        expect(foldedMakes(same)).toBe(SUMMARY_COPY.foldedMakes(3, '318.59'));
    });

    it('does not change the status, the words beside it or the term the differs sentence leaves out', () => {
        expect(outputTermOf(takt)).toEqual({ term: SUMMARY_COPY.underproduces, detail: REASON_WORDS.target_full });
        expect(statusOf(takt)).toEqual({ kind: 'underproduces', text: SUMMARY_COPY.underproduces, detail: REASON_WORDS.target_full });
    });

    it('is the clock-only rate on a clock of an older result without the rate of the copies, as before', () => {
        expect(makesText(older(takt), 9).value).toBe('240/s');
        expect(differenceFromRecommended(older(takt), stable)).toBe('It wakes inserters 109 fewer times a minute than the recommended clock. It underproduces.');
        expect(foldedMakes(viewsOf(ELECTROMAGNETIC_330_TWO_SWINGS).map(older))).toBe(SUMMARY_COPY.foldedMakes(6, '330'));
    });

    it('is the clock-only rate on a clock without a loss, and on one the copies were not run for', () => {
        expect(makesText(viewOf(AUTOMATION_240, 'pitch_pickups'), 9).value).toBe('240/s');
        expect(makesText(viewOf(AUTOMATION_240, 'takt_batches_observed_swings_4'), 9).value).toBe('180/s');
    });

    it('is beside the chip of a clock off the setpoint that has a loss: "makes" the copies\' rate', () => {
        const off = { ...withLoss(clock('a', { verdict: 'unstable', meets_target_rate: false, rate_off_target: -60 })) };
        const measured: SummaryClock = { ...off, checkedLanes: { ...off.checkedLanes!, copies_made: { items_per_second: 171.5, window_cycles: 30 } } };
        expect(outputTermOf(measured)).toEqual({ term: SUMMARY_COPY.underproduces, detail: 'makes 171.5/s of 240/s' });
        expect(outputTermOf(off)).toEqual({ term: SUMMARY_COPY.underproduces, detail: 'makes 180/s of 240/s' });
    });
});
