import { describe, expect, it } from 'vitest';
import { nextStepOf, type NextStepInput } from './nextStep';

const fresh: NextStepInput = {
    problemCount: 0,
    isRunning: false,
    hasBlueprint: true,
    stale: false,
    view: 'configure',
    pageHasCopy: false,
};

describe('nextStepOf', () => {
    it('is Generate while a generation runs, while the build has problems, and before any clock', () => {
        expect(nextStepOf({ ...fresh, hasBlueprint: false, isRunning: true })).toBe('generate');
        expect(nextStepOf({ ...fresh, hasBlueprint: false, problemCount: 2 })).toBe('generate');
        expect(nextStepOf({ ...fresh, hasBlueprint: false })).toBe('generate');
    });

    it('is the bar\'s Copy on Configure with fresh clocks', () => {
        expect(nextStepOf(fresh)).toBe('copy-bar');
        // the card is only on Results
        expect(nextStepOf({ ...fresh, pageHasCopy: true })).toBe('copy-bar');
    });

    it('is the card\'s Copy on Results when the card has one, else the bar\'s', () => {
        expect(nextStepOf({ ...fresh, view: 'results', pageHasCopy: true })).toBe('copy-page');
        expect(nextStepOf({ ...fresh, view: 'results', pageHasCopy: false })).toBe('copy-bar');
    });

    it('is Generate once the build has changed since the clocks, on either view and with problems', () => {
        expect(nextStepOf({ ...fresh, stale: true })).toBe('generate');
        expect(nextStepOf({ ...fresh, stale: true, view: 'results', pageHasCopy: true })).toBe('generate');
        expect(nextStepOf({ ...fresh, stale: true, problemCount: 1 })).toBe('generate');
    });

    it('puts a running generation and the build\'s problems before a fresh blueprint', () => {
        expect(nextStepOf({ ...fresh, isRunning: true })).toBe('generate');
        expect(nextStepOf({ ...fresh, problemCount: 1 })).toBe('generate');
        expect(nextStepOf({ ...fresh, isRunning: true, view: 'results', pageHasCopy: true })).toBe('generate');
    });

    it('names exactly one button for every combination, and the card\'s only on Results with the card', () => {
        const flags = [false, true];
        let combinations = 0;
        for (const problemCount of [0, 1]) {
            for (const isRunning of flags) {
                for (const hasBlueprint of flags) {
                    for (const stale of flags) {
                        for (const view of ['configure', 'results'] as const) {
                            for (const pageHasCopy of flags) {
                                const step = nextStepOf({ problemCount, isRunning, hasBlueprint, stale, view, pageHasCopy });
                                combinations += 1;
                                expect(['generate', 'copy-bar', 'copy-page']).toContain(step);
                                if (step === 'copy-page') {
                                    expect(view).toBe('results');
                                    expect(pageHasCopy).toBe(true);
                                }
                            }
                        }
                    }
                }
            }
        }
        expect(combinations).toBe(64);
    });
});
