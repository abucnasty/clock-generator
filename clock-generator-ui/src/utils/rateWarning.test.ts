import { describe, expect, it } from 'vitest';
import type { ClockAlternativeView } from '../worker/types';
import { copyBlueprintLabelOf, isBelowTarget, rateWarningOf } from './rateWarning';

type Clock = Pick<ClockAlternativeView, 'verdict' | 'assessment' | 'ranking' | 'deadlockRisk'>;

/** A clock running at `itemsPerSecond`, `offTarget` from the target (negative: short of it) */
const clock = (itemsPerSecond: number, offTarget: number, meetsTarget = offTarget === 0): Clock => ({
    verdict: 'stable',
    assessment: { items_per_second: itemsPerSecond } as ClockAlternativeView['assessment'],
    ranking: { meets_target_rate: meetsTarget, rate_off_target: offTarget } as ClockAlternativeView['ranking'],
    deadlockRisk: null,
});

describe('copyBlueprintLabelOf', () => {
    it('names the rate of a clock short of the target', () => {
        expect(copyBlueprintLabelOf(clock(192, -48), false)).toBe('Copy blueprint (192/s, below target)');
    });

    it('prints the rate as the warning sentence does', () => {
        expect(copyBlueprintLabelOf(clock(12.5, -2), false)).toBe('Copy blueprint (12.5/s, below target)');
        expect(copyBlueprintLabelOf(clock(0.333333, -0.1), false)).toBe('Copy blueprint (0.33/s, below target)');
        expect(copyBlueprintLabelOf(clock(240, -10), false)).toBe('Copy blueprint (240/s, below target)');
    });

    it('says the clock is old ahead of anything else', () => {
        expect(copyBlueprintLabelOf(clock(192, -48), true)).toBe('Copy old clock…');
        expect(copyBlueprintLabelOf(undefined, true)).toBe('Copy old clock…');
    });

    it('says "Copy current best" while a generation is still making clocks', () => {
        expect(copyBlueprintLabelOf(clock(240, 0, true), false, true)).toBe('Copy current best');
        expect(copyBlueprintLabelOf(undefined, false, true)).toBe('Copy current best');
    });

    it('names the rate of a best-so-far clock short of the target', () => {
        expect(copyBlueprintLabelOf(clock(192, -48), false, true)).toBe('Copy current best (192/s, below target)');
    });

    it('says the clock is old ahead of the running label', () => {
        expect(copyBlueprintLabelOf(clock(192, -48), true, true)).toBe('Copy old clock…');
    });

    it('is plain for no clock, and for a clock that is not short of the target', () => {
        expect(copyBlueprintLabelOf(undefined, false)).toBe('Copy blueprint');
        expect(copyBlueprintLabelOf(clock(240, 0, true), false)).toBe('Copy blueprint');
        // above the target
        expect(copyBlueprintLabelOf(clock(252, 12, false), false)).toBe('Copy blueprint');
        // unstable at the target rate
        expect(copyBlueprintLabelOf(clock(240, 0, false), false)).toBe('Copy blueprint');
    });

    it('leaves out a shortfall too small to print', () => {
        expect(copyBlueprintLabelOf(clock(239.996, -0.004), false)).toBe('Copy blueprint');
        expect(copyBlueprintLabelOf(clock(239.99, -0.01), false)).toBe('Copy blueprint (239.99/s, below target)');
        expect(isBelowTarget(clock(239.996, -0.004))).toBe(false);
        expect(isBelowTarget(clock(239.99, -0.01))).toBe(true);
        expect(isBelowTarget(undefined)).toBe(false);
    });

    it('agrees with the warning said when the blueprint is copied', () => {
        const short = clock(192, -48);
        expect(rateWarningOf(short)).not.toBeNull();
        expect(copyBlueprintLabelOf(short, false)).toContain('below target');
        const holds = clock(240, 0, true);
        expect(rateWarningOf(holds)).toBeNull();
        expect(copyBlueprintLabelOf(holds, false)).toBe('Copy blueprint');
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
