import { formatNumberText } from './numberText';

/** The engine's message when the machines cannot make the target rate (`plan-run.ts`), with its two numbers */
const CANNOT_MEET_RATE = /The current configuration cannot meet the target production rate\. Total output capacity is ([-\d.eE+]+) items\/second, but target production rate is ([-\d.eE+]+) items\/second\./;

/** What the page says instead of the engine's words, with what to do next */
const CHECK_ERROR_COPY = {
    cannotMeetRate: (capacity: string, target: string) =>
        `The build's machines can make at most ${capacity}/s, but the target is ${target}/s. Lower the target, `
        + 'raise Copies, or add machines or crafting speed (modules, beacons or a faster machine).',
};

/**
 * A failed check's message as the page shows it: the engine's text, except for the messages the page words itself
 * (the numbers rounded to two decimals, in the glossary's words, and with a next step). The engine's text is not edited.
 */
export function checkErrorText(message: string): string {
    // replaced where it stands, should the message ever come with something around it
    return message.replace(CANNOT_MEET_RATE, (_, capacity: string, target: string) =>
        CHECK_ERROR_COPY.cannotMeetRate(formatNumberText(Number(capacity)), formatNumberText(Number(target))));
}
