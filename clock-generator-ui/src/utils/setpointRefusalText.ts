import type { SetpointReason } from 'clock-generator/light';

/**
 * The words for a setpoint the engine refuses: the engine sends the code and its data, the page says it. The engine's own
 * message is a technical string for the command line and the log, never shown as it is.
 */
export function setpointRefusalWords(reason: SetpointReason): string {
    if (reason.code === 'not-counted-yet') {
        return `${reason.item} is not counted yet; choose ${reason.choice ?? 'another recipe'}`;
    }
    return `${reason.recipe} has no output a setpoint can count; choose another recipe`;
}
