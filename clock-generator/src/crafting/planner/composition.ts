/**
 * The composition of a build's group periods into its one main period, as today makes it: the cycle's ticks times the
 * lcm of the denominators of every hand a cycle (`EntityTransferCountMap.lcm`), or the config's own lcm. A group's
 * period is the cycle's ticks times the lcm of its own edges' denominators, so the main period is the lcm of the group
 * periods. Over MAX_SIMULATION_TICKS today's swing backoff picks a lower count where it may.
 */
import type { Config } from "../../config";
import type { OverLimitAction, PlanComposition } from "../../data-types/build-plan";
import Fraction from "../../data-types/fraction";
import { MAX_SIMULATION_TICKS } from "../plan/clock-period-limit";
import { carriedItemsOf } from "../result-windows";
import type { CraftingCyclePlan } from "../sequence/cycle/crafting-cycle";
import { EntityTransferCountMap } from "../sequence/cycle/swing-counts";
import type { GroupShape } from "./groups";
import { MAX_OBSERVED_WINDOWS_PERIOD_TICKS, type PlannedPeriods } from "./periods";

/**
 * The items whose hands are left out of a cycle's lcm: the config's (`overrides.ignored_lcm_ingredients`), and the
 * results whose hands their windows carry from one period to the next, which are whole in no period (result-windows.ts)
 */
export function ignoredLcmItemsOf(config: Config, cycle: CraftingCyclePlan): string[] {
    const carried = cycle.result_windows === undefined ? [] : carriedItemsOf(cycle.result_windows);
    return [...(config.overrides?.ignored_lcm_ingredients ?? []), ...carried];
}

/** The key of an edge by its entity and item, as the cycle plan's transfers name them */
export const transferKeyOf = (entity: string, item: string): string => `${entity}\n${item}`;

/** What a cycle plan measures: its ticks, each group's cycles, the lcm and the main period */
export interface CycleMeasure {
    readonly cycle_ticks: Fraction;
    /** The cycles of each group's period, in the order of the groups */
    readonly group_cycles: readonly number[];
    readonly ignored_items: readonly string[];
    readonly computed_lcm: number;
    readonly override_lcm: number | null;
    readonly effective_lcm: number;
    readonly main_period: Fraction;
}

const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
const lcm = (a: number, b: number): number => a / gcd(a, b) * b;

/**
 * The measure of a cycle plan over the groups; `group_of` gives the group (by its index) of an edge by its transfer key
 * (transferKeyOf). A hand of an edge in no group counts in the build's lcm only.
 */
export function cycleMeasureOf(config: Config, cycle: CraftingCyclePlan, groups: readonly GroupShape[], group_of: ReadonlyMap<string, number>): CycleMeasure {
    const ignored = ignoredLcmItemsOf(config, cycle);
    const computed_lcm = EntityTransferCountMap.lcm(cycle.entity_transfer_map, ignored.length > 0 ? ignored : undefined);
    const group_cycles = groups.map(() => 1);
    cycle.entity_transfer_map.forEach((transfer, entity_id) => {
        for (const item of transfer.item_transfers) {
            if (ignored.includes(item.item_name)) continue;
            const group = group_of.get(transferKeyOf(entity_id.id, item.item_name));
            if (group !== undefined) group_cycles[group] = lcm(group_cycles[group], item.transfer_count.getDenominator);
        }
    });
    const override_lcm = config.overrides?.lcm ?? null;
    const effective_lcm = override_lcm ?? computed_lcm;
    return {
        cycle_ticks: cycle.total_duration_ticks,
        group_cycles,
        ignored_items: ignored,
        computed_lcm,
        override_lcm,
        effective_lcm,
        main_period: cycle.total_duration_ticks.multiply(effective_lcm),
    };
}

const ratioOf = (value: Fraction) => ({ numerator: value.getNumerator, denominator: value.getDenominator });

/** The composition at the main clock's count, and what is done where the planned period is over the limit */
export function compositionOf(periods: PlannedPeriods, groups: readonly GroupShape[]): PlanComposition {
    const { main, tried } = periods;
    const measure = main.measure;
    const first = tried[0];
    const over = first.measure.main_period.toDecimal() >= MAX_SIMULATION_TICKS;
    const terms = {
        requested_swings: first.swings,
        limit_ticks: MAX_SIMULATION_TICKS,
        tried: tried.map(count => ({ swings: count.swings, period_ticks: count.measure.main_period.toDecimal() })),
    };
    const over_limit_action: OverLimitAction = !over ? { action: "none" }
        : periods.can_back_off && measure.main_period.toDecimal() < MAX_SIMULATION_TICKS
            ? { action: "swing-backoff", rule: "P-limit", terms }
            : { action: "refused", rule: "P-limit", terms };
    return {
        swings: main.swings,
        fractional: main.fractional,
        ...(periods.listed_from === null ? {} : { listed_from: { ...periods.listed_from, higher_up_to_ticks: MAX_OBSERVED_WINDOWS_PERIOD_TICKS } }),
        main_period: { ticks: measure.main_period.toDecimal(), exact: ratioOf(measure.main_period) },
        lcm_terms: {
            cycle_ticks: ratioOf(measure.cycle_ticks),
            group_cycles: groups.map((group, at) => ({ group: group.key, cycles: measure.group_cycles[at] })),
            ignored_items: measure.ignored_items,
            computed_lcm: measure.computed_lcm,
            override_lcm: measure.override_lcm,
            effective_lcm: measure.effective_lcm,
        },
        over_limit_action,
    };
}
