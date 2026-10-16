import { fraction } from 'clock-generator/light';
import { copiesProblem } from './copiesProblem';
import type { SerializableMachineFacts } from 'clock-generator/browser';
import { entityLabel } from './entityLabel';
import { formatNumberText } from './numberText';

/** The machines that make the target, and the most they make together in one copy of the build */
export interface MachinesMax {
    machineIds: number[];
    /** The sum of their Machine Facts' max rates, in items per second */
    perCopy: number;
    /** Present when every machine supplied its exact capacity. */
    perCopyRatio?: { numerator: number; denominator: number };
}

/** What a machine's facts say of its output; null when they could not be worked out, undefined until they are */
type OutputFacts = Pick<SerializableMachineFacts, 'output_item' | 'output_rate_per_second' | 'output_rate_ratio'> | null | undefined;

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
    const perCopy = making.reduce((sum, machine) => sum + (machine.facts?.output_rate_per_second ?? 0), 0);
    if (!Number.isFinite(perCopy)) return null;
    try {
        const exact = making.every(machine => machine.facts?.output_rate_ratio)
            ? making.reduce((sum, machine) => {
                const ratio = machine.facts!.output_rate_ratio!;
                return sum.add(fraction(ratio.numerator, ratio.denominator));
            }, fraction(0)) : null;
        if (exact && !Number.isFinite(exact.toDecimal())) return null;
        return {
            ...(exact && { perCopyRatio: { numerator: exact.getNumerator, denominator: exact.getDenominator } }),
            machineIds: making.map((machine) => machine.id),
            perCopy,
        };
    } catch {
        // Unsupported precision/overflow leaves capacity unknown. The worker still validates the retained build.
        return null;
    }
}

/** Exact current-worker capacity; legacy numeric-only facts use their approximate sum/product. Null defers unsupported arithmetic to worker validation. */
export function totalMachineCapacity(max: MachinesMax, copies: number): number | null {
    try {
        const capacity = max.perCopyRatio
            ? fraction(max.perCopyRatio.numerator, max.perCopyRatio.denominator).multiply(copies).toDecimal()
            : max.perCopy * copies;
        return Number.isFinite(capacity) ? capacity : null;
    } catch {
        return null;
    }
}

/** Same comparison as planCraftingCycle for supported values; unsupported arithmetic must not crash the editable form. */
export function isTargetAboveMax(itemsPerSecond: number, copies: number, max: MachinesMax | null): boolean {
    if (!max || !(itemsPerSecond > 0) || copiesProblem(copies) || !Number.isFinite(itemsPerSecond)) return false;
    const capacity = totalMachineCapacity(max, copies);
    if (capacity === null) return false;
    try {
        const target = fraction(itemsPerSecond).divide(60).multiply(60).toDecimal();
        return Number.isFinite(target) && target > capacity;
    } catch {
        // The existing Check/Generate worker reports its validation error without losing the imported or saved form.
        return false;
    }
}

/** Display-only nudge prevents a binary representation of 0.29 rounding down to 0.28. */
const EPSILON = 1e-9;

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
    const capacity = totalMachineCapacity(max, copies);
    if (capacity === null) return null;
    const one = max.machineIds.length === 1;
    const machines = `${machinesText(max.machineIds)} ${one ? 'makes' : 'make'} ${maxRateText(max.perCopy, locale)}${one ? '' : ' together'}`;
    const total = maxRateText(capacity, locale);
    return copies !== 1
        ? `At most ${total}: ${machines}, times ${copies} copies. Lower the rate or raise Copies. Describe one unit in the build.`
        : `At most ${total}: ${machines}. Lower the rate or raise Copies. Describe one unit in the build.`;
}
