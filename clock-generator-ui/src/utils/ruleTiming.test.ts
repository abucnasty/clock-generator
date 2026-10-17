import { describe, expect, it } from 'vitest';
import { entityKey, NO_TIMING, plannedWindowsOf, ruleTimingOf, ticksText, type RuleTiming } from './ruleTiming';

const windows = { 'inserter:1': [{ start: 12, end: 20 }, { start: 80, end: 95 }], 'inserter:2': [] };
const results = { cycleTicks: 132, periodTicks: 264, windows };
const check = { cycleTicks: 130, periodTicks: 260 };

describe('ruleTimingOf', () => {
    it('takes the clock on Results before the check', () => {
        expect(ruleTimingOf({ results, check })).toEqual({ cycleTicks: 132, periodTicks: 264, from: 'results', windows });
    });

    it('takes the check alone, with no windows', () => {
        expect(ruleTimingOf({ results: null, check })).toEqual({ cycleTicks: 130, periodTicks: 260, from: 'check', windows: null });
    });

    it('knows nothing with neither', () => {
        expect(ruleTimingOf({ results: null, check: null })).toEqual(NO_TIMING);
    });
});

describe('entityKey', () => {
    it('keys inserters and drills as the engine does', () => {
        expect(entityKey('inserter', 3)).toBe('inserter:3');
        expect(entityKey('drill', 1)).toBe('drill:1');
    });
});

describe('plannedWindowsOf', () => {
    const timing = ruleTimingOf({ results, check: null });

    it('gives the entity\'s windows from Results', () => {
        expect(plannedWindowsOf(timing, 'inserter:1')).toEqual([{ start: 12, end: 20 }, { start: 80, end: 95 }]);
    });

    it('keeps a window that wraps past the end of the period as two ranges', () => {
        const wrapped: RuleTiming = { ...timing, windows: { 'inserter:1': [{ start: 250, end: 263 }, { start: 0, end: 5 }] } };
        expect(plannedWindowsOf(wrapped, 'inserter:1')).toEqual([{ start: 0, end: 5 }, { start: 250, end: 263 }]);
    });

    it('widens a part that ends at tick 0 to ticks 0–1, which a rule can hold', () => {
        const atZero: RuleTiming = { ...timing, windows: { 'inserter:1': [{ start: 250, end: 263 }, { start: 0, end: 0 }] } };
        expect(plannedWindowsOf(atZero, 'inserter:1')).toEqual([{ start: 0, end: 1 }, { start: 250, end: 263 }]);
        const single: RuleTiming = { ...timing, windows: { 'inserter:1': [{ start: 0, end: 0 }] } };
        expect(plannedWindowsOf(single, 'inserter:1')).toEqual([{ start: 0, end: 1 }]);
    });

    it('is null for a missing key, an entity with no window, a fractional period, or a check', () => {
        expect(plannedWindowsOf(timing, 'inserter:9')).toBeNull();
        expect(plannedWindowsOf(timing, 'inserter:2')).toBeNull();
        expect(plannedWindowsOf({ ...timing, periodTicks: 550.957 }, 'inserter:1')).toBeNull();
        expect(plannedWindowsOf({ ...timing, from: 'check' }, 'inserter:1')).toBeNull();
        expect(plannedWindowsOf(NO_TIMING, 'inserter:1')).toBeNull();
    });
});

describe('ticksText', () => {
    it('prints whole ticks as they are and others with 3 decimals', () => {
        expect(ticksText(264)).toBe('264');
        expect(ticksText(264.5)).toBe('264.500');
    });
});
