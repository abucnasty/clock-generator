/**
 * The composition of a build's group window cycles into its one main window cycle, as today makes it: the cycle's ticks times the
 * lcm of the denominators of every hand a cycle (`EntityTransferCountMap.lcm`), or the config's own lcm. A group's
 * window cycle is the cycle's ticks times the lcm of its own edges' denominators, so the main window cycle is the lcm of the group
 * window cycles. Over SIMULATION_BUDGET_TICKS today's swing backoff picks a lower count where it may.
 */
import type { Config } from "../../config";
import type { OverLimitAction, PlanComposition } from "../../data-types/build-plan";
import Fraction from "../../data-types/fraction";
import { SIMULATION_BUDGET_TICKS } from "../plan/clock-window-cycle-limit";
import { carriedItemsOf } from "../exhaust";
import type { OutputCyclePlan } from "../sequence/cycle/output-cycle";
import { EntityTransferCountMap } from "../sequence/cycle/swing-counts";
import type { GroupShape } from "./groups";
import { MAX_OBSERVED_WINDOWS_WINDOW_CYCLE_TICKS, type PlannedWindowCycles } from "./window-cycles";

/**
 * The items whose hands are left out of a cycle's lcm: the config's (`overrides.ignored_lcm_ingredients`), and the
 * results whose hands their windows carry from one window cycle to the next, which are whole in no window cycle (exhaust.ts)
 */
export function ignoredLcmItemsOf(config: Config, cycle: OutputCyclePlan): string[] {
    const carried = cycle.exhaust === undefined ? [] : carriedItemsOf(cycle.exhaust);
    return [...(config.overrides?.ignored_lcm_ingredients ?? []), ...carried];
}

/** The key of an edge by its entity and item, as the cycle plan's transfers name them */
export const transferKeyOf = (entity: string, item: string): string => `${entity}\n${item}`;

/** What a cycle plan measures: its ticks, each group's cycles, the lcm and the main window cycle */
export interface CycleMeasure {
    readonly cycle_ticks: Fraction;
    /** The cycles of each group's window cycle, in the order of the groups */
    readonly group_cycles: readonly number[];
    readonly ignored_items: readonly string[];
    readonly computed_lcm: number;
    readonly override_lcm: number | null;
    readonly effective_lcm: number;
    readonly main_window_cycle: Fraction;
}

const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
const lcm = (a: number, b: number): number => a / gcd(a, b) * b;

/**
 * The measure of a cycle plan over the groups; `group_of` gives the group (by its index) of an edge by its transfer key
 * (transferKeyOf). A hand of an edge in no group counts in the build's lcm only.
 */
export function cycleMeasureOf(config: Config, cycle: OutputCyclePlan, groups: readonly GroupShape[], group_of: ReadonlyMap<string, number>): CycleMeasure {
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
        main_window_cycle: cycle.total_duration_ticks.multiply(effective_lcm),
    };
}

const ratioOf = (value: Fraction) => ({ numerator: value.getNumerator, denominator: value.getDenominator });

/** The composition at the main clock's count, and what is done where the planned window cycle is over the limit */
export function compositionOf(window_cycles: PlannedWindowCycles, groups: readonly GroupShape[]): PlanComposition {
    const { main, tried } = window_cycles;
    const measure = main.measure;
    const first = tried[0];
    const over = first.measure.main_window_cycle.toDecimal() >= SIMULATION_BUDGET_TICKS;
    const terms = {
        requested_swings: first.swings,
        limit_ticks: SIMULATION_BUDGET_TICKS,
        tried: tried.map(count => ({ swings: count.swings, window_cycle_ticks: count.measure.main_window_cycle.toDecimal() })),
    };
    const over_limit_action: OverLimitAction = !over ? { action: "none" }
        : window_cycles.can_back_off && measure.main_window_cycle.toDecimal() < SIMULATION_BUDGET_TICKS
            ? { action: "swing-backoff", rule: "P-limit", terms }
            : { action: "refused", rule: "P-limit", terms };
    return {
        swings: main.swings,
        fractional: main.fractional,
        ...(window_cycles.listed_from === null ? {} : { listed_from: { ...window_cycles.listed_from, higher_up_to_ticks: MAX_OBSERVED_WINDOWS_WINDOW_CYCLE_TICKS } }),
        main_window_cycle: { ticks: measure.main_window_cycle.toDecimal(), exact: ratioOf(measure.main_window_cycle) },
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
