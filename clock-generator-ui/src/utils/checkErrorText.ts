import type { TargetCounts } from './targetCounts';

/** The engine's message when the machines cannot make the setpoint (`unclocked-run.ts`) */
const CANNOT_MEET_RATE = /The current configuration cannot meet the setpoint\./;

/** What the page says instead of the engine's words, with what to do next */
const CHECK_ERROR_COPY = {
    cannotMeetRate: (counts: TargetCounts) =>
        `The build's machines cannot ${counts === 'destroyed' ? 'destroy' : 'make'} the setpoint. Lower the setpoint, `
        + 'raise Copies, or add machines or crafting speed (modules, beacons or a faster machine).',
};

/**
 * A failed check's message as the page shows it: the engine's text, except for the messages the page words itself
 * (the numbers rounded to two decimals, in the glossary's words, and with a next step). The engine's text is not edited.
 */
export function checkErrorText(message: string, counts: TargetCounts = 'made'): string {
    // replaced where it stands, should the message ever come with something around it
    return message.replace(CANNOT_MEET_RATE, () => CHECK_ERROR_COPY.cannotMeetRate(counts));
}
