import { describe, expect, it } from 'vitest';
import { checkErrorText } from './checkErrorText';

const ENGINE = 'The current configuration cannot meet the target production rate. Total output capacity is '
    + '252.65624125798462 items/second, but target production rate is 400 items/second.';

describe('checkErrorText', () => {
    it('rounds the rates, says build, and gives a next step', () => {
        expect(checkErrorText(ENGINE)).toBe("The build's machines can make at most 252.66/s, but the target is 400/s. "
            + 'Lower the target, or add machines or crafting speed (modules, beacons or a faster machine).');
    });

    it('keeps no engine wording', () => {
        expect(checkErrorText(ENGINE)).not.toMatch(/configuration|production rate|items\/second/);
    });

    it('leaves any other message as the engine wrote it', () => {
        expect(checkErrorText('No machine with output item foo found')).toBe('No machine with output item foo found');
        expect(checkErrorText('')).toBe('');
    });
});
