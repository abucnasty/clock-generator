import { describe, expect, it } from 'vitest';
import { NO_TARGET_NOTE, replacesTargetNote, targetRowCaption, targetRowLabel, targetToFill } from './pasteTarget';

const suggestion = (items_per_second: number, source: 'mod' | 'inferred' = 'inferred') => ({
    target: { recipe: 'logistic-science-pack', items_per_second, copies: 1 },
    source,
});

describe('targetToFill', () => {
    it('floors the rate to 3 decimals, so it never asks for more than the machines make', () => {
        expect(targetToFill(suggestion(22.96875)).items_per_second).toBe(22.968);
        expect(targetToFill(suggestion(22.968749)).items_per_second).toBe(22.968);
    });

    it('drops float noise without flooring a step too low', () => {
        expect(targetToFill(suggestion(1.8000000000000003)).items_per_second).toBe(1.8);
        expect(targetToFill(suggestion(0.29)).items_per_second).toBe(0.29);
        expect(targetToFill(suggestion(240)).items_per_second).toBe(240);
    });

    it('keeps the recipe and the copies', () => {
        expect(targetToFill({ target: { recipe: 'iron-gear-wheel', items_per_second: 2, copies: 3 }, source: 'mod' }))
            .toEqual({ recipe: 'iron-gear-wheel', items_per_second: 2, copies: 3 });
    });
});

describe('the words of the Target Output row', () => {
    it('names the target as a ceiling', () => {
        expect(targetRowLabel({ recipe: 'logistic-science-pack', items_per_second: 22.968, copies: 1 }))
            .toBe('Target Output: logistic-science-pack at up to 22.968/s, 1 copy');
        expect(targetRowLabel({ recipe: 'logistic-science-pack', items_per_second: 240, copies: 11 }))
            .toBe('Target Output: logistic-science-pack at up to 240/s, 11 copies');
    });

    it('says where the target came from, and to lower it to what is needed', () => {
        expect(targetRowCaption('mod')).toMatch(/^From the mod's export\. .*lower it to what you need/);
        expect(targetRowCaption('inferred')).toMatch(/^Worked out from your machines: .*lower it to what you need/);
    });

    it('says which target it replaces', () => {
        expect(replacesTargetNote({ recipe: 'logistic-science-pack', items_per_second: 240, copies: 11 }))
            .toBe('This replaces your current target (logistic-science-pack at 240/s).');
    });

    it('says what to do when it could not tell', () => {
        expect(NO_TARGET_NOTE).toBe('Could not tell what the build makes. Set Target Output after importing.');
    });
});
