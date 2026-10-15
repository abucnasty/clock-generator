import { entityLabel } from './entityLabel';
import { formatNumberText } from './numberText';

/** The machines that make the target recipe, and the most they make together in one copy of the build */
export interface MachinesMax {
    machineIds: number[];
    /** The sum of their Machine Facts' max rates, in items per second */
    perCopy: number;
}

/**
 * The most the machines making the target recipe can make together, from each one's max rate. Null when no machine
 * makes it, or while a machine's max rate is not known (its facts are still being worked out, or could not be): a sum
 * without it would be too low, and warn when nothing is wrong.
 */
export function machinesMaxOf(machines: { id: number; maxRate: number | null | undefined }[]): MachinesMax | null {
    if (machines.length === 0) {
        return null;
    }
    let perCopy = 0;
    for (const { maxRate } of machines) {
        if (typeof maxRate !== 'number' || !Number.isFinite(maxRate)) {
            return null;
        }
        perCopy += maxRate;
    }
    return { machineIds: machines.map((machine) => machine.id), perCopy };
}

/** A rate as the warning prints it, so that two rates are compared as the player reads them */
const shown = (rate: number) => Number(formatNumberText(rate, { locale: 'en-US' }));

/**
 * Whether Items per Second (the total for every copy) is more than all the copies' machines can make, by more than
 * the rounding the warning prints the rates with: a target typed in from the rounded max does not warn.
 */
export function isTargetAboveMax(itemsPerSecond: number, copies: number, max: MachinesMax | null): boolean {
    if (!max || !(itemsPerSecond > 0) || !(copies >= 1) || !Number.isFinite(itemsPerSecond)) {
        return false;
    }
    const total = max.perCopy * copies;
    return itemsPerSecond > total && shown(itemsPerSecond) > shown(total);
}

/** "Machine 1", "Machines 1 and 2", "Machines 1, 2 and 3" */
function machinesText(ids: number[]): string {
    if (ids.length === 1) {
        return entityLabel('machine', ids[0]);
    }
    return `Machines ${ids.slice(0, -1).join(', ')} and ${ids[ids.length - 1]}`;
}

/**
 * The line under Items per Second when the target is more than the machines can make: "Machine 1 makes at most
 * 22.97/s; 11 copies make 252.66/s." Null when it is not.
 */
export function targetRateWarningOf(
    { itemsPerSecond, copies, max, locale }: {
        itemsPerSecond: number;
        copies: number;
        max: MachinesMax | null;
        locale?: Intl.LocalesArgument;
    },
): string | null {
    if (!max || !isTargetAboveMax(itemsPerSecond, copies, max)) {
        return null;
    }
    const rate = (value: number) => `${formatNumberText(value, { locale })}/s`;
    const machines = max.machineIds.length === 1
        ? `${machinesText(max.machineIds)} makes at most ${rate(max.perCopy)}`
        : `${machinesText(max.machineIds)} make at most ${rate(max.perCopy)} together`;
    return copies > 1
        ? `${machines}; ${copies} copies make ${rate(max.perCopy * copies)}.`
        : `${machines}.`;
}
