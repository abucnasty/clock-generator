import { fraction } from 'clock-generator/light';
import { copiesProblem } from './copiesProblem';
import type { SerializableMachineFacts } from 'clock-generator/browser';
import { entityLabel } from './entityLabel';
import { formatNumberText } from './numberText';
import type { TargetCounts } from './targetCounts';
import type { InserterFormData, MachineFormData } from './configForm/formData';

/** The machines that make the target (or, for a target that counts the item destroyed, destroy it), and the most they make or destroy together in one copy of the build */
export interface MachinesMax {
    machineIds: number[];
    /** The sum of their Machine Facts' max rates, in items per second; for a destroyed target, the most they destroy */
    perCopy: number;
    /** Present when every machine supplied its exact capacity. */
    perCopyRatio?: { numerator: number; denominator: number };
    /**
     * Set when something other than the machines' speed stops the target (a hand, an inserter, a belt): the engine's
     * words for it, empty while they are not yet known for the rate typed in. The most is then the engine's.
     */
    otherLimit?: string;
}

/** What the engine's feasibility pass says of the build (`targetRateMaxOf`), as the page needs it */
interface FeasibleMax {
    max: { per_copy: { numerator: number; denominator: number }; per_copy_per_second: number; limit: string | null } | null;
    /** Whether `max.limit` is for the rate typed in */
    current: boolean;
}

/**
 * The most the target can be: the engine's feasibility pass's, which counts the machines' speed with the inserters, belts
 * and hands, the same pass that refuses a target above it. Where that is not known (the pass cannot be run on the build,
 * or has not answered yet) it is the machines' alone. Where the machines are what stops the target, the machines'
 * clause stays; otherwise `otherLimit` says what does.
 */
export function rateMaxOf(machines: MachinesMax | null, feasible: FeasibleMax): MachinesMax | null {
    const found = feasible.max;
    if (found === null) return machines;
    // the same to within the float noise of the facts' yields, which the pass leaves unrefused too (a billionth)
    const same = machines !== null && Math.abs(machines.perCopy - found.per_copy_per_second) <= 1e-9 * found.per_copy_per_second;
    if (same) return machines;
    return {
        machineIds: machines?.machineIds ?? [],
        perCopy: found.per_copy_per_second,
        perCopyRatio: found.per_copy,
        otherLimit: feasible.current && found.limit ? found.limit : '',
    };
}

/** What a machine's facts say of its output; null when they could not be worked out, undefined until they are */
type OutputFacts = (Pick<SerializableMachineFacts, 'output_item' | 'output_rate_per_second' | 'output_rate_ratio'>
    & Partial<Pick<SerializableMachineFacts, 'output_per_craft' | 'inputs'>>) | null | undefined;

/** A machine of the build with its facts; `comesBack` says that what it gives back of the item is taken back into it */
interface MachineWithFacts {
    id: number;
    facts: OutputFacts;
    comesBack?: boolean;
}

/**
 * What one machine can destroy of the target item a second: its crafts a second times what a craft uses of the item,
 * less what a craft gives back of it when its own output is that item and the build takes that back into it (the engine's
 * `targetCapacityPerSecond`). A craft gives back its output per craft, so the crafts times it are the output rate: exact
 * where the facts have the exact output rate. Null when the facts do not say what the machine uses.
 */
function destroyedCapacity(item: string, facts: NonNullable<OutputFacts>, comesBack: boolean): { value: number; exact: ReturnType<typeof fraction> | null } | null {
    const used = facts.inputs?.find((input) => input.item_name === item)?.amount_per_craft;
    const per_craft = facts.output_per_craft;
    if (used === undefined || per_craft === undefined || !(per_craft > 0) || !Number.isFinite(facts.output_rate_per_second)) return null;
    const gives_back = comesBack && facts.output_item === item;
    const value = facts.output_rate_per_second / per_craft * used - (gives_back ? facts.output_rate_per_second : 0);
    try {
        const rate = facts.output_rate_ratio ? fraction(facts.output_rate_ratio.numerator, facts.output_rate_ratio.denominator) : null;
        const exact = rate && rate.divide(fraction(per_craft)).multiply(fraction(used));
        return { value, exact: exact && gives_back ? exact.subtract(rate) : exact };
    } catch {
        return { value, exact: null };
    }
}

/**
 * Whether what a machine puts into its result target is taken back into it by an inserter that carries the item (an
 * inserter without filters carries what its source holds): the engine counts that as given back, not destroyed
 */
export function resultComesBack(machine: Pick<MachineFormData, 'id' | 'result_target'>, inserters: readonly InserterFormData[], item: string): boolean {
    const target = machine.result_target;
    return target !== undefined && inserters.some(inserter => inserter.source.type === 'chest' && inserter.source.id === target.id
        && inserter.sink.type === 'machine' && inserter.sink.id === machine.id
        && (!inserter.filters?.length || inserter.filters.includes(item)));
}

/**
 * The most the machines making the target can make together, from each one's max rate. They are picked as the engine's
 * check picks them (`planCraftingCycle`): the machines whose output item is named as the target recipe. Null when none
 * makes it, or while a machine's facts are not known yet: it might make the target, and a sum without it would be too
 * low, and find a problem where there is none.
 *
 * For a target that counts the item destroyed, the machines that count are those that take the item as an ingredient,
 * and the most each destroys is its crafts a second times what a craft uses of the item, less what it gives back of the
 * item into itself (`comesBack`).
 */
export function machinesMaxOf(targetRecipe: string, machines: MachineWithFacts[], counts: TargetCounts = 'made'): MachinesMax | null {
    if (!targetRecipe || machines.some((machine) => machine.facts === undefined)) {
        return null;
    }
    if (counts === 'destroyed') {
        const destroying = machines.filter((machine) => machine.facts?.inputs?.some((input) => input.item_name === targetRecipe));
        const capacities = destroying.map((machine) => destroyedCapacity(targetRecipe, machine.facts!, machine.comesBack === true));
        if (destroying.length === 0 || capacities.some((capacity) => capacity === null)) return null;
        const perCopy = capacities.reduce((sum, capacity) => sum + capacity!.value, 0);
        if (!Number.isFinite(perCopy)) return null;
        const exact = capacities.every((capacity) => capacity!.exact !== null)
            ? capacities.reduce((sum, capacity) => sum.add(capacity!.exact!), fraction(0)) : null;
        return {
            ...(exact && Number.isFinite(exact.toDecimal()) && { perCopyRatio: { numerator: exact.getNumerator, denominator: exact.getDenominator } }),
            machineIds: destroying.map((machine) => machine.id),
            perCopy,
        };
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
 * or add machines." Null when the target is not more. A target that counts the item destroyed says "destroys".
 */
export function targetRateLineOf(
    { itemsPerSecond, copies, max, counts = 'made', locale }: {
        itemsPerSecond: number;
        copies: number;
        max: MachinesMax | null;
        /** What the rate counts: a target that counts the item destroyed says what the machines destroy */
        counts?: TargetCounts;
        locale?: Intl.LocalesArgument;
    },
): string | null {
    if (!max || !isTargetAboveMax(itemsPerSecond, copies, max)) {
        return null;
    }
    const capacity = totalMachineCapacity(max, copies);
    if (capacity === null) return null;
    if (max.otherLimit !== undefined) {
        const total = maxRateText(capacity, locale);
        if (max.otherLimit === '') return `At most ${total}. Lower the rate or raise Copies. Describe one unit in the build.`;
        return copies !== 1 ? `At most ${total}. For one copy: ${max.otherLimit}` : `At most ${total}: ${max.otherLimit}`;
    }
    const one = max.machineIds.length === 1;
    const verb = counts === 'destroyed' ? (one ? 'destroys' : 'destroy') : (one ? 'makes' : 'make');
    const machines = `${machinesText(max.machineIds)} ${verb} ${maxRateText(max.perCopy, locale)}${one ? '' : ' together'}`;
    const total = maxRateText(capacity, locale);
    return copies !== 1
        ? `At most ${total}: ${machines}, times ${copies} copies. Lower the rate or raise Copies. Describe one unit in the build.`
        : `At most ${total}: ${machines}. Lower the rate or raise Copies. Describe one unit in the build.`;
}
