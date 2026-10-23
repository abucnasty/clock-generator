import { describe, expect, it } from 'vitest';
import { assumptionsText, freeLaneDropText, phaseChecksText } from './modelAssumptions';

describe('assumptionsText', () => {
    const none = { count: 4, missingType: 0, missingQuality: 0, automatic: 0, unavailable: 0 };

    it('says nothing was assumed when the build sets every type, quality and hand size', () => {
        expect(assumptionsText(none)).toBe('Inserter types, qualities and hand sizes are all set in your build; none were assumed.');
    });

    it('says what was assumed, and how many inserters it is for', () => {
        expect(assumptionsText({ ...none, missingType: 2, missingQuality: 1, automatic: 3, unavailable: 1 }))
            .toBe('2 inserters have no type set, so stack inserter timing is assumed. 1 inserter has no quality set, so legendary timing is assumed. '
                + 'Hand sizes: 1 are set in your build and 3 follow your research (1 unavailable: supported types assume full research).');
    });
});

describe('the model texts', () => {
    it('names the belt whose drop positions were not given', () => {
        expect(freeLaneDropText('Belt 1')).toBe('Where the output inserters drop onto Belt 1 was not given, so each is treated as dropping onto its own '
            + 'stretch of empty belt; two that share a belt in the game could get in each other\'s way.');
    });

    it('says how many other places in its period the clock was tried from', () => {
        expect(phaseChecksText(12)).toBe('The clock was also tried from 12 other places in its period. More starting states can be sampled separately.');
        expect(phaseChecksText(undefined)).toBe('How many other places in its period the clock was tried from is unavailable.');
    });
});
