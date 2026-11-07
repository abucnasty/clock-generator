import { formatNumberText } from './numberText';
import type { TargetCounts } from './targetCounts';

/** The engine's message when the machines cannot make the setpoint (`unclocked-run.ts`), with its two numbers */
const CANNOT_MEET_RATE = /The current configuration cannot meet the setpoint\. Total output capacity is ([-\d.eE+]+) items\/second, but the setpoint is ([-\d.eE+]+) items\/second\./;

/** What the page says instead of the engine's words, with what to do next */
const CHECK_ERROR_COPY = {
    cannotMeetRate: (capacity: string, setpoint: string, counts: TargetCounts) =>
        `The build's machines can ${counts === 'destroyed' ? 'destroy' : 'make'} at most ${capacity}/s, but the setpoint is ${setpoint}/s. Lower the setpoint, `
        + 'raise Copies, or add machines or crafting speed (modules, beacons or a faster machine).',
};

/**
 * A failed check's message as the page shows it: the engine's text, except for the messages the page words itself
 * (the numbers rounded to two decimals, in the glossary's words, and with a next step). The engine's text is not edited.
 */
export function checkErrorText(message: string, counts: TargetCounts = 'made'): string {
    // replaced where it stands, should the message ever come with something around it
    return message.replace(CANNOT_MEET_RATE, (_, capacity: string, setpoint: string) =>
        CHECK_ERROR_COPY.cannotMeetRate(formatNumberText(Number(capacity)), formatNumberText(Number(setpoint)), counts));
}
