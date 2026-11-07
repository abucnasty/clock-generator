import { describe, expect, it } from 'vitest';
import { checkErrorText } from './checkErrorText';

const ENGINE = 'The current configuration cannot meet the setpoint.';

describe('checkErrorText', () => {
    it('says build, and gives a next step', () => {
        expect(checkErrorText(ENGINE)).toBe("The build's machines cannot make the setpoint. "
            + 'Lower the setpoint, raise Copies, or add machines or crafting speed (modules, beacons or a faster machine).');
    });

    it('says destroy for a target that counts the item destroyed', () => {
        expect(checkErrorText(ENGINE, 'destroyed')).toBe("The build's machines cannot destroy the setpoint. "
            + 'Lower the setpoint, raise Copies, or add machines or crafting speed (modules, beacons or a faster machine).');
        expect(checkErrorText(ENGINE, 'made')).toBe(checkErrorText(ENGINE));
    });

    it('leaves any other message as the engine wrote it', () => {
        expect(checkErrorText('No machine with output item foo found')).toBe('No machine with output item foo found');
        expect(checkErrorText('')).toBe('');
    });
});
