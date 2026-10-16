import { SerializableTransferPlan } from "./sequence/cycle/swing-counts";

/** An item whose inserters set the clock's period: without it the period is shorter */
export interface LeanPeriodItem {
    item: string;
    /** The cycles of the plan's period */
    lcm: number;
    /** The cycles the period would have if the item's hands were left out of it */
    lcm_without: number;
}

const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);

/** The cycles in which every hand of `denominators` comes out whole: their least common multiple */
function lcmOf(denominators: readonly number[]): number {
    return denominators.reduce((lcm, denominator) => lcm / gcd(lcm, denominator) * denominator, 1);
}

/**
 * The items whose hands per cycle set the period of the plan (the denominators of `computed_lcm`): leaving one out of
 * the least common multiple, as `overrides.ignored_lcm_ingredients` does, lowers it. Read off the hands the plan has
 * for each inserter and drill, so nothing in it depends on which build or which item it is.
 *
 * @param plan the transfer plan of a planning run
 * @param already_ignored the items the config already leaves out of the period; they are left out here too, and not offered
 */
export function leanPeriodItems(plan: SerializableTransferPlan, already_ignored: readonly string[] = []): LeanPeriodItem[] {
    const transfers = plan.entities.flatMap(entity => entity.item_transfers)
        .filter(transfer => !already_ignored.includes(transfer.item_name));
    const lcm = lcmOf(transfers.map(transfer => transfer.denominator));
    const items = Array.from(new Set(transfers.map(transfer => transfer.item_name))).sort();
    return items.flatMap(item => {
        const lcm_without = lcmOf(transfers.filter(transfer => transfer.item_name !== item).map(transfer => transfer.denominator));
        return lcm_without < lcm ? [{ item, lcm, lcm_without }] : [];
    });
}
