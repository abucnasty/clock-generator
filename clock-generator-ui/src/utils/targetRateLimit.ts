import type { SerializableMachineFacts } from 'clock-generator/browser';
import { entityLabel } from './entityLabel';
import { formatNumberText } from './numberText';

/** The machines that make the target, and the most they make together in one copy of the build */
export interface MachinesMax {
    machineIds: number[];
    /** The sum of their Machine Facts' max rates, in items per second */
    perCopy: number;
}

/** What a machine's facts say of its output; null when they could not be worked out, undefined until they are */
type OutputFacts = Pick<SerializableMachineFacts, 'output_item' | 'output_rate_per_second'> | null | undefined;

/**
 * The most the machines making the target can make together, from each one's max rate. They are picked as the engine's
 * check picks them (`planCraftingCycle`): the machines whose output item is named as the target recipe. Null when none
 * makes it, or while a machine's facts are not known yet: it might make the target, and a sum without it would be too
 * low, and find a problem where there is none.
 */
export function machinesMaxOf(targetRecipe: string, machines: { id: number; facts: OutputFacts }[]): MachinesMax | null {
    if (!targetRecipe || machines.some((machine) => machine.facts === undefined)) {
        return null;
    }
    const making = machines.filter((machine) => machine.facts?.output_item === targetRecipe);
    if (making.length === 0 || making.some((machine) => !Number.isFinite(machine.facts?.output_rate_per_second))) {
        return null;
    }
    return {
        machineIds: making.map((machine) => machine.id),
        perCopy: making.reduce((sum, machine) => sum + (machine.facts?.output_rate_per_second ?? 0), 0),
    };
}

/**
 * How far above the most the target may be and still count as at it: only the floating point error of the sum. The
 * engine's check compares exactly, so a target a hundredth above the most is refused, however it prints.
 */
const EPSILON = 1e-9;

/** Whether Items per Second (the total for every copy) is more than all the copies' machines can make, as the engine's check finds */
export function isTargetAboveMax(itemsPerSecond: number, copies: number, max: MachinesMax | null): boolean {
    if (!max || !(itemsPerSecond > 0) || !(copies >= 1) || !Number.isFinite(itemsPerSecond)) {
        return false;
    }
    return itemsPerSecond > max.perCopy * copies + EPSILON;
}

/** `rate` rounded down: to 2 decimals, or under 0.01 to 2 significant digits */
function roundedDown(rate: number): number {
    const decimals = rate >= 0.01 ? 2 : 1 - Math.floor(Math.log10(rate));
    const scale = 10 ** decimals;
    // the nudge keeps 0.29, held as 0.28999…, at 0.29
    return Math.floor(rate * scale + EPSILON) / scale;
}

/**
 * A most as the page prints it: "252.65/s" for 252.656…, rounded down so that a target typed in from it is never more
 * than the machines make
 */
export function maxRateText(rate: number, locale?: Intl.LocalesArgument): string {
    return `${formatNumberText(roundedDown(rate), { locale })}/s`;
}

/** "Machine 1", "Machines 1 and 2", "Machines 1, 2 and 3" */
function machinesText(ids: number[]): string {
    if (ids.length === 1) {
        return entityLabel('machine', ids[0]);
    }
    return `Machines ${ids.slice(0, -1).join(', ')} and ${ids[ids.length - 1]}`;
}

/**
 * The line under Items per Second when the target is more than the machines can make, a problem: the most first, what
 * makes it, then what to do. "At most 252.65/s: Machine 1 makes 22.96/s, times 11 copies. Lower the rate, or raise Copies
 * or add machines." Null when the target is not more.
 */
export function targetRateLineOf(
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
    const one = max.machineIds.length === 1;
    const machines = `${machinesText(max.machineIds)} ${one ? 'makes' : 'make'} ${maxRateText(max.perCopy, locale)}${one ? '' : ' together'}`;
    const total = maxRateText(max.perCopy * copies, locale);
    return copies > 1
        ? `At most ${total}: ${machines}, times ${copies} copies. Lower the rate, or raise Copies or add machines.`
        : `At most ${total}: ${machines}. Lower the rate or add machines.`;
}
