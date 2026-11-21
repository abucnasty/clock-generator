import { describe, expect, it } from 'vitest';
import { setpointRefusalWords } from './setpointRefusalText';

describe('the words of a setpoint the engine refuses', () => {
    it('names the pick and the output to choose', () => {
        expect(setpointRefusalWords({ code: 'not-counted-yet', item: 'jellynut-seed', choice: 'jelly' })).toBe('jellynut-seed is not counted yet; choose jelly');
    });

    it('asks for another recipe where there is no output to choose', () => {
        expect(setpointRefusalWords({ code: 'not-counted-yet', item: 'jellynut-seed' })).toBe('jellynut-seed is not counted yet; choose another recipe');
    });

    it('says a recipe with no output has none a setpoint can count', () => {
        expect(setpointRefusalWords({ code: 'no-countable-output', recipe: 'sulfuric-acid' })).toBe('sulfuric-acid has no output a setpoint can count; choose another recipe');
    });
});
