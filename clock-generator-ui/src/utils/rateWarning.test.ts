import { describe, expect, it } from 'vitest';
import type { ClockAlternativeView } from '../worker/types';
import { copyBlueprintLabelOf, isBelowTarget, rateWarningOf } from './rateWarning';
import { STALE_COPY_LABEL } from './resultsStaleness';

type Clock = Pick<ClockAlternativeView, 'verdict' | 'assessment' | 'ranking' | 'deadlockRisk'>;

/** A clock running at `itemsPerSecond`, `offTarget` from the target (negative: short of it) */
const clock = (itemsPerSecond: number, offTarget: number, meetsTarget = offTarget === 0): Clock => ({
    verdict: 'stable',
    assessment: { items_per_second: itemsPerSecond } as ClockAlternativeView['assessment'],
    ranking: { meets_target_rate: meetsTarget, rate_off_target: offTarget } as ClockAlternativeView['ranking'],
    deadlockRisk: null,
});

describe('copyBlueprintLabelOf', () => {
    // a row that leaves out stale or running has it false
    it.each<{ why: string; clock: Clock | undefined; stale?: boolean; running?: boolean; label: string }>([
        { why: 'a clock short of the target', clock: clock(192, -48), label: 'Copy blueprint (192/s, below target)' },
        // the rate as the warning sentence prints it
        { why: 'a rate of 12.5/s', clock: clock(12.5, -2), label: 'Copy blueprint (12.5/s, below target)' },
        { why: 'a rate of 0.333333/s', clock: clock(0.333333, -0.1), label: 'Copy blueprint (0.33/s, below target)' },
        { why: 'a rate of 240/s, its zero kept', clock: clock(240, -10), label: 'Copy blueprint (240/s, below target)' },
        { why: 'the smallest shortfall it prints', clock: clock(239.99, -0.01), label: 'Copy blueprint (239.99/s, below target)' },
        { why: 'a shortfall too small to print', clock: clock(239.996, -0.004), label: 'Copy blueprint' },
        { why: 'no clock', clock: undefined, label: 'Copy blueprint' },
        { why: 'a clock at the target', clock: clock(240, 0, true), label: 'Copy blueprint' },
        { why: 'a clock above the target', clock: clock(252, 12, false), label: 'Copy blueprint' },
        { why: 'a clock unstable at the target rate', clock: clock(240, 0, false), label: 'Copy blueprint' },
        // while a generation is still making clocks
        { why: 'the best so far, at the target', clock: clock(240, 0, true), running: true, label: 'Copy current best' },
        { why: 'no clock yet', clock: undefined, running: true, label: 'Copy current best' },
        { why: 'the best so far, short of the target', clock: clock(192, -48), running: true, label: 'Copy current best (192/s, below target)' },
        // the clocks are for an earlier build, which is said ahead of anything else
        { why: 'an old clock short of the target', clock: clock(192, -48), stale: true, label: STALE_COPY_LABEL },
        { why: 'old clocks, none selected', clock: undefined, stale: true, label: STALE_COPY_LABEL },
        { why: 'an old best so far', clock: clock(192, -48), stale: true, running: true, label: STALE_COPY_LABEL },
    ])('labels $why', ({ clock, stale = false, running, label }) => {
        expect(copyBlueprintLabelOf(clock, stale, running)).toBe(label);
    });

    it('agrees with the warning said when the blueprint is copied', () => {
        const short = clock(192, -48), atTarget = clock(240, 0, true);
        expect(rateWarningOf(short)).not.toBeNull();
        expect(copyBlueprintLabelOf(short, false)).toBe('Copy blueprint (192/s, below target)');
        expect(rateWarningOf(atTarget)).toBeNull();
        expect(copyBlueprintLabelOf(atTarget, false)).toBe('Copy blueprint');
    });
});

describe('isBelowTarget', () => {
    it('counts a shortfall from the smallest the label prints', () => {
        expect(isBelowTarget(clock(239.99, -0.01))).toBe(true);
        expect(isBelowTarget(clock(239.996, -0.004))).toBe(false);
        expect(isBelowTarget(undefined)).toBe(false);
    });
});

describe('a stable clock over the target, picked where none meets it', () => {
    it('says how far over the target it runs', () => {
        const result = clock(82.286, 1.86725, false);
        result.ranking.stable_above_target = true;
        expect(rateWarningOf(result)).toBe('This clock runs over the target: 82.29/s for the 80.42/s requested, 2.32% over, in the simulator.');
    });
});

describe('numerical output and actual hold checks', () => {
    it('does not turn the observed above-target numerical mismatch into a failed hold check', () => {
        const result = clock(216.061381, 0.061381, false);
        result.assessment.holds = true;
        expect(rateWarningOf(result)).toContain('output rate differs from the target');
        expect(rateWarningOf(result)).toContain('216.06/s; requested 216/s');
        expect(rateWarningOf(result)).not.toContain('does not hold');
        result.assessment.holds = false;
        expect(rateWarningOf(result)).toContain('does not hold its expected output');
    });
});

// Atlan cell 29: the 2,888-tick clock of a 2,888.666-tick period meets goal 1 at 0.02% fast
describe('a clock rounded down to whole ticks that meets the target rate', () => {
    it('says how much it runs fast, and not that its rate differs', () => {
        const rounded = clock(9.972299, 0.002299, true);
        rounded.assessment.holds = true;
        rounded.ranking.runs_fast = 0.0002306;
        expect(rateWarningOf(rounded)).toBe('This clock’s period is rounded down to whole ticks, so it runs 0.02% fast: '
            + '9.972/s for the 9.97/s requested, within the 0.1% a rounded clock may run and what the machines can make.');
        expect(copyBlueprintLabelOf(rounded, false)).toBe('Copy blueprint');
    });
});
