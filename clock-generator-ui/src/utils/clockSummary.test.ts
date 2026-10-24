import { describe, expect, it } from 'vitest';
import type { ClockRanking, ClockVerdict } from 'clock-generator/browser';
import { rateWarningOf } from './rateWarning';
import { startCheckSummary } from './modelAssumptions';
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
    wakeUpsText,
    worksOf,
    type SummaryClock,
} from './clockSummary';

const TARGET = 240;

interface ClockOptions extends Partial<ClockRanking> {
    verdict?: ClockVerdict;
    beltLabel?: string;
    deadlock?: boolean;
    brokenBy?: string[];
    deciders?: number;
}

/** A stable clock at the target rate, made for the belt asked for, with 10 wake-ups, 4 windows and 4 deciders, unless told otherwise */
function clock(id: string, options: ClockOptions = {}): SummaryClock {
    const { verdict = 'stable', beltLabel = 'moving (+4 ticks)', deadlock = false, brokenBy, deciders = 4, ...ranking } = options;
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
        label: `Engine name of ${id}`,
        verdict,
        beltLabel,
        deciders,
        deadlockRisk: deadlock ? 'Deadlock risk: inserters 1 and 2 both bring the same item.' : null,
        ranking: full,
        assessment: {
            holds: verdict !== 'unstable',
            items_per_second: TARGET + full.rate_off_target,
            wake_ups_per_minute: full.wake_ups_per_minute,
            backpressure_loss: verdict === 'unstable' ? null : {
                survives: verdict === 'stable', broken_by: brokenBy ?? (verdict === 'no recovery' ? ['an input stops arriving'] : []), recovered_after_periods: verdict === 'stable' ? 1 : null,
            },
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
        expect(plainClockName([dependent], 0)).toBe('Depends on how it is started');
        expect(worksOf(dependent)).toEqual({ kind: 'caution', text: 'Start-dependent' });
        expect(recoversOf(dependent)).toMatchObject({ kind: 'yes', value: 'Yes' });
        expect(rateWarningOf(dependent)).toContain('some sampled starts');
        expect(rateWarningOf(dependent)).not.toContain('240 of 240');
        expect(startCheckSummary([dependent], { startDependenceRequested: true, complete: true })).toBe('Tried from 2 other starting states, across 1 of 1 clocks.');
        const unavailable = clock('unavailable');
        expect(startCheckSummary([unavailable], { startDependenceRequested: false, complete: true })).toBe('Other starting states were not tried.');
        expect(startCheckSummary([unavailable], { startDependenceRequested: true, complete: true })).toBe('Results for other starting states are unavailable.');
        expect(startCheckSummary([dependent, unavailable], { startDependenceRequested: true, complete: false })).toBe('This generation is incomplete. Tried from 2 other starting states, across 1 of 2 clocks. Results for other starting states are unavailable for 1.');
        expect(startCheckSummary([], { startDependenceRequested: true, complete: true })).toBe('No clocks were available to check.');
        unavailable.assessment.backpressure_loss = null;
        expect(recoversOf(unavailable)).toMatchObject({ kind: 'not-tested', value: 'Unavailable' });
        unavailable.verdict = 'no recovery';
        unavailable.ranking.meets_target_rate = false;
        unavailable.assessment.backpressure_loss = { survives: false, broken_by: [], recovered_after_periods: null };
        expect(recoversOf(unavailable)).toMatchObject({ value: 'Unavailable', detail: expect.stringContaining('undisturbed baseline') });
        expect(plainClockName([unavailable], 0)).toBe('Recovery unavailable');
        expect(worksOf(unavailable)).toEqual({ kind: 'caution', text: 'Recovery unavailable' });
        expect(differenceFromRecommended(unavailable, clock('recommended'))).toBe('Recovery results are unavailable for this clock.');
    });
});

describe('plainClockName', () => {
    it('names the clock with the fewest wake-ups among the contenders', () => {
        const clocks = [clock('a', { wake_ups_per_minute: 12 }), clock('b', { wake_ups_per_minute: 8 })];
        expect(nameOf(clocks, 'b')).toBe('Fewest wake-ups');
    });

    it('gives tied clocks the same name', () => {
        const clocks = [clock('a', { wake_ups_per_minute: 8.0001 }), clock('b', { wake_ups_per_minute: 8 })];
        expect(nameOf(clocks, 'a')).toBe('Fewest wake-ups');
        expect(nameOf(clocks, 'b')).toBe('Fewest wake-ups');
    });

    it('names a clock with more wake-ups but the fewest windows "Fewest wake windows"', () => {
        const clocks = [clock('a', { wake_ups_per_minute: 8, window_count: 6 }), clock('b', { wake_ups_per_minute: 12, window_count: 3 })];
        expect(nameOf(clocks, 'b')).toBe('Fewest wake windows');
    });

    it('names a clock with more wake-ups but the fewest deciders "Fewest deciders", before the windows', () => {
        const clocks = [clock('a', { wake_ups_per_minute: 8, window_count: 6, deciders: 10 }), clock('b', { wake_ups_per_minute: 12, window_count: 3, deciders: 6 })];
        expect(nameOf(clocks, 'b')).toBe('Fewest deciders');
        expect(nameOf(clocks, 'a')).toBe('Fewest wake-ups');
    });

    it('does not name a clock by its deciders when every clock has as many', () => {
        const clocks = [clock('a', { wake_ups_per_minute: 8, window_count: 6 }), clock('b', { wake_ups_per_minute: 12, window_count: 3 })];
        expect(nameOf(clocks, 'b')).toBe('Fewest wake windows');
    });

    it('falls through to the windows when the wake-ups were not counted', () => {
        const clocks = [clock('a', { wake_ups_per_minute: null, window_count: 5 }), clock('b', { wake_ups_per_minute: null, window_count: 3 })];
        expect(nameOf(clocks, 'b')).toBe('Fewest wake windows');
        expect(nameOf(clocks, 'a')).toBe('Another way to make 240/s');
    });

    it('names a clock that does not match the belt by its belt, even with the fewest wake-ups', () => {
        const clocks = [clock('a', { wake_ups_per_minute: 12 }), clock('b', { wake_ups_per_minute: 2, matches_belt_choice: false, beltLabel: 'backed-up' })];
        expect(nameOf(clocks, 'b')).toBe('For backed-up belts');
        expect(nameOf(clocks, 'a')).toBe('Fewest wake-ups');
    });

    it('names a clock that does not recover, or does not hold its rate', () => {
        const clocks = [clock('a'), clock('b', { verdict: 'no recovery', meets_target_rate: false }), clock('c', { verdict: 'unstable', meets_target_rate: false, holds_expected_output: false })];
        expect(nameOf(clocks, 'b')).toBe('Does not recover when jammed or starved');
        expect(nameOf(clocks, 'c')).toBe('Does not hold its rate');
    });

    it('names a clock off the target rate by its rate, below or above, before its verdict', () => {
        const clocks = [
            clock('a'),
            clock('below', { verdict: 'unstable', meets_target_rate: false, rate_off_target: -48 }),
            clock('above', { meets_target_rate: false, rate_off_target: 12.5 }),
        ];
        expect(nameOf(clocks, 'below')).toBe('Runs at 192/s, not 240/s');
        expect(nameOf(clocks, 'above')).toBe('Runs at 252.5/s, not 240/s');
    });

    it('does not name a clock by a rate less than half a hundredth off', () => {
        const clocks = [clock('a', { rate_off_target: -0.004 })];
        expect(nameOf(clocks, 'a')).toBe('Fewest wake-ups');
    });

    it('names any other clock by the rate it makes', () => {
        const clocks = [clock('a', { wake_ups_per_minute: 4, window_count: 2 }), clock('b', { wake_ups_per_minute: 9, window_count: 7 })];
        expect(nameOf(clocks, 'b')).toBe('Another way to make 240/s');
    });

    it('names a clock that holds the rate on a deadlock build by its trade-off, as its verdict does not decide', () => {
        const clocks = [
            clock('a', { verdict: 'no recovery', deadlock: true, wake_ups_per_minute: 6 }),
            clock('b', { verdict: 'stable', deadlock: true, wake_ups_per_minute: 9, window_count: 5 }),
        ];
        expect(nameOf(clocks, 'a')).toBe('Fewest wake-ups');
        expect(nameOf(clocks, 'b')).toBe('Another way to make 240/s');
    });

    it('is empty for an index with no clock', () => {
        expect(plainClockName([], 0)).toBe('');
    });

    it('keeps the engine name as it is', () => {
        expect(clockTechnicalName(clock('a'))).toBe('Engine name of a');
    });
});

describe('recoversOf', () => {
    it('says yes for a stable clock', () => {
        expect(recoversOf(clock('a'))).toMatchObject({ kind: 'yes', value: 'Yes' });
    });

    it('says no, with the causes it does not recover from', () => {
        const result = recoversOf(clock('a', { verdict: 'no recovery', brokenBy: ['coal stops arriving', 'iron-plate is not taken away'] }));
        expect(result.kind).toBe('no');
        expect(result.detail).toContain('coal stops arriving, or after iron-plate is not taken away');
        expect(recoversOf(clock('b', { verdict: 'no recovery' })).detail).toContain('an input stops arriving');
    });

    it('says which losses were not tried, since the clock already failed one', () => {
        const stopped = clock('a', { verdict: 'no recovery', brokenBy: ['coal stops arriving'] });
        stopped.assessment.backpressure_loss!.not_tried = ['iron-plate stops arriving', 'iron-gear-wheel is not taken away'];
        expect(recoversOf(stopped).detail).toBe('In the simulator, after coal stops arriving for a while, it does not get back to its rate by itself. '
            + 'Not tried, since one failure is enough: iron-plate stops arriving, iron-gear-wheel is not taken away.');
        expect(rateWarningOf(stopped)).toContain('after coal stops arriving for a while, the build does not get back to its rate by itself in the simulator. '
            + 'Not tried, since one failure is enough: iron-plate stops arriving, iron-gear-wheel is not taken away.');
        // all tried: nothing is said
        expect(recoversOf(clock('b', { verdict: 'no recovery', brokenBy: ['coal stops arriving'] })).detail).not.toContain('Not tried');
    });

    it('says "in the simulator" for yes and for no alike', () => {
        expect(recoversOf(clock('a')).detail).toMatch(/^In the simulator, /);
        expect(recoversOf(clock('b', { verdict: 'no recovery' })).detail).toMatch(/^In the simulator, /);
        expect(recoversOf(clock('c', { verdict: 'no recovery', brokenBy: ['coal stops arriving'] })).detail).toMatch(/^In the simulator, /);
    });

    it('says why the recovery of a clock that holds could not be tried', () => {
        const untried = clock('a');
        untried.assessment.backpressure_loss = null;
        untried.assessment.backpressure_loss_not_tried = 'A clock of 47.537 ticks does not repeat in whole ticks, so its output cannot be counted by the period';
        expect(recoversOf(untried)).toEqual({ kind: 'not-tested', value: 'Unavailable',
            detail: 'Recovery could not be tried in the simulator: A clock of 47.537 ticks does not repeat in whole ticks, so its output cannot be counted by the period.' });
    });

    it('says not tested for a clock that does not hold its rate', () => {
        expect(recoversOf(clock('a', { verdict: 'unstable' }))).toMatchObject({ kind: 'not-tested', value: 'Not tested' });
    });
});

describe('lossLimitText', () => {
    const names: Record<string, string> = { nutrients: 'Nutrients', 'iron-bacteria': 'Iron bacteria' };
    const itemLabel = (id: string) => names[id] ?? id;
    const limited = (ticks: number, item: string, verdict: 'stable' | 'no recovery' = 'stable') => {
        const limitedClock = clock('a', { verdict });
        limitedClock.assessment.backpressure_loss = { ...limitedClock.assessment.backpressure_loss!, loss_limit: { ticks, item } };
        return limitedClock;
    };

    it('names the longest loss checked and the item that spoils first, for a build whose items spoil', () => {
        expect(lossLimitText(limited(13500, 'nutrients'), itemLabel))
            .toBe('Checked for losses up to 3 min 45 s. A longer loss spoils the nutrients in the build, and no clock brings it back.');
        expect(lossLimitText(limited(2700, 'iron-bacteria', 'no recovery'), itemLabel))
            .toBe('Checked for losses up to 45 s. A longer loss spoils the iron bacteria in the build, and no clock brings it back.');
    });

    it('says nothing for a build whose items do not spoil, or a clock whose losses were not tried', () => {
        expect(lossLimitText(clock('a'), itemLabel)).toBeNull();
        const untried = clock('b');
        untried.assessment.backpressure_loss = null;
        expect(lossLimitText(untried, itemLabel)).toBeNull();
    });

    it('says a stretch in minutes and seconds', () => {
        expect(minutesAndSecondsText(2700)).toBe('45 s');
        expect(minutesAndSecondsText(10800)).toBe('3 min');
        expect(minutesAndSecondsText(40500)).toBe('11 min 15 s');
        expect(minutesAndSecondsText(750)).toBe('12.5 s');
    });
});

describe('makesText and wakeUpsText', () => {
    it('names the total scope unless there is exactly one copy', () => {
        expect(makesText(clock('a'), 11)).toEqual({ value: '240/s', sub: 'all 11 copies' });
        expect(makesText(clock('a'), 1)).toEqual({ value: '240/s', sub: '' });
    });

    it.each([0.0625, 0.9999, 1.0001])('keeps Copies %s exact while leaving the total rate and one-copy wake-ups unchanged', copies => {
        const result = clock('a', { rate_off_target: -0.125, wake_ups_per_minute: 17.6 });
        expect(makesText(result, copies)).toEqual({ value: '239.88/s', sub: `all ${copies} copies` });
        expect(wakeUpsText(result)).toEqual({ value: '18 a minute', sub: 'one copy' });
    });

    it('rounds the rate to two decimals', () => {
        expect(makesText(clock('a', { rate_off_target: -0.123 }), 1).value).toBe('239.88/s');
    });

    it('rounds the wake-ups as the table does, for one copy', () => {
        expect(wakeUpsText(clock('a', { wake_ups_per_minute: 17.6 }))).toEqual({ value: '18 a minute', sub: 'one copy' });
    });

    it('says "Not counted" when they were not', () => {
        expect(wakeUpsText(clock('a', { wake_ups_per_minute: null }))).toEqual({ value: 'Not counted', sub: '' });
    });
});

describe('beltLine and beltValue', () => {
    const moving = { backedUpBelts: false, searchedForFewerWakeUps: false };
    const backedUp = { backedUpBelts: true, searchedForFewerWakeUps: false };

    it('says moving for a clock made for a moving belt', () => {
        expect(beltLine(moving, 'moving (+4 ticks)')).toBe('Made for moving belts.');
        expect(beltValue(moving, 'moving (+4 ticks)')).toBe('Moving');
    });

    it('says backed up when the build or the clock says so', () => {
        expect(beltLine(backedUp, 'moving (+4 ticks)')).toBe('Made for backed-up belts.');
        expect(beltLine(moving, 'backed-up')).toBe('Made for backed-up belts.');
        expect(beltValue(moving, 'backed-up')).toBe('Backed up');
    });

    it('says there is no belt when no clocked inserter picks up from one', () => {
        expect(beltLine(moving, '')).toBe('No inserter on the clock picks up from a belt.');
        expect(beltValue(null, '')).toBe('None');
        expect(beltValueSub(moving, '')).toBe('no inserter picks up from a belt');
        expect(beltValueSub(moving, 'moving (+4 ticks)')).toBeUndefined();
    });

    it('goes by the label alone without a rule', () => {
        expect(beltLine(null, 'moving (+2 ticks)')).toBe('Made for moving belts.');
    });
});

describe('beltCellText', () => {
    it('says the belt in the belt question\'s words, with the slack', () => {
        expect(beltCellText('moving (+4 ticks)')).toBe('Moving (+4 ticks belt slack)');
        expect(beltCellText('moving (+2–4 ticks)')).toBe('Moving (+2–4 ticks belt slack)');
        expect(beltCellText('backed-up')).toBe('Backed up');
        expect(beltCellText('')).toBe('');
    });
});

describe('differenceFromRecommended', () => {
    const recommended = clock('r', { wake_ups_per_minute: 10 });

    it('says the rate first', () => {
        const selected = clock('s', { verdict: 'unstable', meets_target_rate: false, rate_off_target: -48, wake_ups_per_minute: 30 });
        expect(differenceFromRecommended(selected, recommended))
            .toBe('This one makes 192/s, not 240/s. It wakes inserters 20 more times a minute than the recommended clock.');
    });

    it('says more, fewer or nothing about the wake-ups', () => {
        expect(differenceFromRecommended(clock('s', { wake_ups_per_minute: 11 }), recommended))
            .toBe('It wakes inserters 1 more time a minute than the recommended clock.');
        expect(differenceFromRecommended(clock('s', { wake_ups_per_minute: 4, matches_belt_choice: false }), recommended))
            .toBe('It wakes inserters 6 fewer times a minute than the recommended clock. It is made for backed-up belts.');
        expect(differenceFromRecommended(clock('s', { wake_ups_per_minute: 10.2 }), recommended)).toBe('It is not the recommended clock.');
    });

    it('says nothing of uncounted wake-ups', () => {
        expect(differenceFromRecommended(clock('s', { wake_ups_per_minute: null }), recommended)).toBe('It is not the recommended clock.');
    });

    it('says when it does not recover', () => {
        expect(differenceFromRecommended(clock('s', { verdict: 'no recovery' }), recommended))
            .toBe('It does not recover after it is starved or jammed.');
    });

    it('keeps to two sentences', () => {
        const selected = clock('s', { verdict: 'unstable', meets_target_rate: false, rate_off_target: -48, wake_ups_per_minute: 30, matches_belt_choice: false });
        expect(differenceFromRecommended(selected, recommended).match(/\./g)?.length).toBe(2);
    });
});

describe('foldedMakes', () => {
    it('folds 3 or more clocks that make the same rate into one line', () => {
        expect(foldedMakes([clock('a'), clock('b'), clock('c')])).toBe('All 3 clocks make 240/s.');
    });

    it('keeps the column for two clocks', () => {
        expect(foldedMakes([clock('a'), clock('b')])).toBeNull();
    });

    it('keeps the column when one clock differs at the second decimal', () => {
        expect(foldedMakes([clock('a'), clock('b'), clock('c', { rate_off_target: -0.01 })])).toBeNull();
    });

    it('folds clocks that differ only past the second decimal', () => {
        expect(foldedMakes([clock('a'), clock('b', { rate_off_target: 0.001 }), clock('c', { rate_off_target: -0.002 })]))
            .toBe('All 3 clocks make 240/s.');
    });
});

describe('worksOf', () => {
    it('says yes for a clock that holds the rate and recovers, made for the belt asked for', () => {
        expect(worksOf(clock('a'))).toEqual({ kind: 'yes', text: 'Yes' });
    });

    it('says a clock for backed-up belts is only for them', () => {
        expect(worksOf(clock('a', { matches_belt_choice: false }))).toEqual({ kind: 'caution', text: 'Designed for backed-up supply' });
    });

    it('names the rate a clock that holds a rate misses, before whether it recovers', () => {
        expect(worksOf(clock('a', { verdict: 'no recovery', meets_target_rate: false, rate_off_target: -48 })))
            .toEqual({ kind: 'no', text: 'Misses the rate (192/s)' });
    });

    it('calls a clock that does not hold its rate unstable, whatever rate it runs at', () => {
        expect(worksOf(clock('a', { verdict: 'unstable', meets_target_rate: false, rate_off_target: -48 })))
            .toEqual({ kind: 'no', text: 'Unstable' });
    });

    it('says a clock that does not recover so, and one that does not hold its rate is unstable', () => {
        expect(worksOf(clock('a', { verdict: 'no recovery', matches_belt_choice: false }))).toEqual({ kind: 'caution', text: 'Does not recover' });
        expect(worksOf(clock('b', { verdict: 'unstable' }))).toEqual({ kind: 'no', text: 'Unstable' });
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
