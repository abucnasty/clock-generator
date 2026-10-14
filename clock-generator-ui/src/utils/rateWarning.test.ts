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
