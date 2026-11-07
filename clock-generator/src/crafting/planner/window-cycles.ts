/**
 * The main-period choices of a build: the output swing counts today's alternatives are listed for (the planned count,
 * the counts above and below the main one, and fractional swings), each with its period, kept or
 * pruned by arithmetic before any simulation. The one rule that prunes is P-limit: a period of SIMULATION_BUDGET_TICKS or
 * more cannot be simulated, nor, under whole-counter checks, a fractional period whose whole counter
 * is that long (`counterOverLimitOf`). Each count's hands come from today's cycle plan (`OutputCyclePlan.create`), never
 * worked out again here; an alternative's count that the cycle plan refuses is listed as refused, with the plan's reason,
 * as its run fails. Fractional swings an inserter cannot make within its insertion limits are listed, as their run makes
 * them, at the first whole count below that the cycle plan accepts, unless the config forces a count; refused where none is,
 * or where every inserter's swings are whole at it.
 */
import assert from "../../common/assert";
import type { Config } from "../../config";
import type { WindowCycleChoice, WindowCycleListing, ExhaustDecision } from "../../data-types/build-plan";
import Fraction, { fraction } from "../../data-types/fraction";
import { Entity, type ReadableEntityRegistry } from "../../entities";
import { targetInsertersOf, targetMachinesOf, type TargetItem } from "../sequence/cycle/target-ends";
import { SIMULATION_BUDGET_TICKS, counterOverLimitOf } from "../plan/clock-window-cycle-limit";
import { OutputCyclePlan, plannedTerminalSwingCount } from "../sequence/cycle/output-cycle";
import { FractionalSwingsRefusedError, fractionalSwingsWholeAt } from "../sequence/cycle/swing-distribution";
import { TargetProductionRate } from "../target-production-rate";
import { CycleMeasure, cycleMeasureOf } from "./composition";
import type { GroupShape } from "./groups";

/** Observed windows re-simulate the build hundreds of times; above this period (a high LCM) that takes minutes */
export const MAX_OBSERVED_WINDOWS_WINDOW_CYCLE_TICKS = 2400;

/**
 * Output swing counts above the planned one offered as alternatives, also when the plan backed off to a lower count.
 * A cost skip, kept until the pricing release, not a proof: no fixed number says a longer cycle cannot work. Measured
 * on all 86 record jobs, listing up to 3 counts further (416 counts) found 10 alternatives that met the rate, in 3 jobs.
 */
const EXTENDED_SWING_COUNTS = 3;

/**
 * The output swing counts offered as alternatives beside the main clock's `swings`: every lower count, and the higher
 * ones up to `planned` + EXTENDED_SWING_COUNTS where the main period is at most MAX_OBSERVED_WINDOWS_PERIOD_TICKS. The
 * planned count only covers what a machine crafts before its output blocks; it keeps crafting while the output inserter
 * takes hands, so longer cycles can work too, but the machine holds the planned count when a cycle's swings start: the
 * farthest count is only tried as a multiple of it (the planned cycle repeated). A forced count is the only one.
 */
export function swingCountsListed(swings: number, planned: number, forced: boolean, window_cycle_ticks: number): { lower: number[]; higher: number[] } {
    const lower = forced ? [] : Array.from({ length: Math.max(0, swings - 1) }, (_, i) => swings - 1 - i);
    const higher = forced || window_cycle_ticks > MAX_OBSERVED_WINDOWS_WINDOW_CYCLE_TICKS ? []
        : Array.from({ length: planned + EXTENDED_SWING_COUNTS - swings }, (_, i) => swings + 1 + i)
            .filter(count => count < planned + EXTENDED_SWING_COUNTS || (planned > 1 && count % planned === 0));
    return { lower, higher };
}

/** What the periods of a build are planned from: today's cycle arithmetic */
export interface CycleArithmetic {
    readonly config: Config;
    readonly registry: ReadableEntityRegistry;
    /**
     * For a target that counts an item made: the output swings a cycle the output machines can make before they block,
     * as the planning run's prepare step finds them on the config with fractional swings on or off (planOutputCycle's
     * `max_swings_possible`); null for a target that counts an item destroyed
     */
    readonly max_swings: ((fractional: boolean) => Fraction) | null;
}

/** A count planned: its cycle and what it measures */
interface PlannedCount {
    readonly swings: number;
    /** The swings as the exact fraction a fractional plan is made on */
    readonly swings_exact?: Fraction;
    readonly fractional: boolean;
    readonly listed_as: WindowCycleListing;
    readonly cycle: OutputCyclePlan;
    readonly measure: CycleMeasure;
}

/** The periods of a build: each group's choices and the counts the composition reads */
export interface PlannedWindowCycles {
    /** The choices of each group, in the order of the groups */
    readonly per_group: readonly (readonly WindowCycleChoice[])[];
    /** The counts tried from the planned one down until one is under the limit, the planned one first */
    readonly tried: readonly PlannedCount[];
    /** The main clock's count: the last of `tried` */
    readonly main: PlannedCount;
    /** Whether a count over the limit may be backed off from (today's swing backoff) */
    readonly can_back_off: boolean;
    /** The main and the planned count the lists of other counts start from; null where none is listed */
    readonly listed_from: { readonly swings: number; readonly planned: number } | null;
}

const ratioOf = (value: Fraction) => ({ numerator: value.getNumerator, denominator: value.getDenominator });

/** An alternative's count whose cycle the cycle plan refuses */
interface RefusedCount {
    /** The count asked for; null where the plan refused it before it had one (fractional swings) */
    readonly swings: number | null;
    readonly fractional: boolean;
    readonly listed_as: WindowCycleListing;
    readonly refused: string;
}

type ListedCount = PlannedCount | RefusedCount;

/** A choice of a group: its period at the count, kept or pruned by P-limit, or refused by the cycle plan */
function choiceOf(count: ListedCount, group: number): WindowCycleChoice {
    if ("refused" in count) {
        return { swings: count.swings, fractional: count.fractional, listed_as: count.listed_as,
            pruned: { rule: "cycle-refused", terms: { reason: count.refused } } };
    }
    const exact = count.swings_exact;
    const head = {
        swings: count.swings,
        ...(exact === undefined || exact.getDenominator === 1 ? {} : { swings_exact: ratioOf(exact) }),
        fractional: count.fractional,
        listed_as: count.listed_as,
    };
    const cycles = count.measure.override_lcm ?? count.measure.group_cycles[group];
    const window_cycle_ticks = count.measure.cycle_ticks.multiply(cycles).toDecimal();
    const base = { ...head, cycle_ticks: ratioOf(count.measure.cycle_ticks), cycles, window_cycle_ticks };
    if (window_cycle_ticks >= SIMULATION_BUDGET_TICKS) {
        return { ...base, pruned: { rule: "P-limit", terms: { window_cycle_ticks, limit_ticks: SIMULATION_BUDGET_TICKS } } };
    }
    const counter_ticks = counterOverLimitOf(window_cycle_ticks);
    return counter_ticks !== null
        ? { ...base, pruned: { rule: "P-limit", terms: { window_cycle_ticks, limit_ticks: SIMULATION_BUDGET_TICKS, counter_ticks } } }
        : { ...base, kept: true };
}

/**
 * The output swings a cycle of the first output machine, over every inserter that takes the target from it, rounded and
 * at least 1: the count a planning run reports it used (`used_terminal_swing_count`), which the alternatives' lists of
 * counts start from. It is the planned count but for fractional swings and takers that share a machine's output.
 */
function outputSwingsOf(cycle: OutputCyclePlan, registry: ReadableEntityRegistry, target: TargetItem): number {
    const machines = targetMachinesOf(target, registry);
    const takers_of = machines.map(machine => new Set(targetInsertersOf(machine, target, registry).map(inserter => inserter.entity_id.id)));
    const inserters = registry.getAll().filter(Entity.isInserter);
    const takers = new Set(takers_of.flatMap(ids => inserters.filter(inserter => ids.has(inserter.entity_id.id)).map(inserter => inserter.entity_id.id)));
    const first = inserters.find(inserter => takers_of[0].has(inserter.entity_id.id));
    assert(first !== undefined, "the first output machine has no inserter taking the target from it");
    let swings = 0;
    for (const [entity_id, planned] of cycle.entity_transfer_map.entries()) {
        if (takers.has(entity_id.id) && Entity.isInserter(planned.entity) && planned.entity.source.entity_id.id === first.source.entity_id.id) {
            swings += planned.total_transfer_count.toDecimal();
        }
    }
    return Math.max(1, Math.round(swings));
}

/**
 * The periods of a build's groups at every count today's alternatives are listed for. `exhaust` is the decision of
 * a destroyed target's results (planner/exhaust.ts), which its cycle is made with.
 */
export function plannedWindowCyclesOf(
    input: CycleArithmetic,
    groups: readonly GroupShape[],
    group_of: ReadonlyMap<string, number>,
    exhaust: ExhaustDecision | null,
): PlannedWindowCycles {
    const { config, registry } = input;
    const overrides = config.overrides ?? {};
    const target = TargetProductionRate.fromConfig(config.setpoint);
    const forced = overrides.terminal_swing_count !== undefined;
    const planned = (cycle: OutputCyclePlan, listed_as: WindowCycleListing, is_fractional = false, swings_exact?: Fraction): PlannedCount => {
        const swings = target.counts === "destroyed" ? exhaust!.hands : plannedTerminalSwingCount(cycle);
        assert(swings !== undefined, "the cycle plan has no output swing count");
        return { swings, ...(is_fractional && swings_exact !== undefined ? { swings_exact } : {}), fractional: is_fractional, listed_as, cycle,
            measure: cycleMeasureOf(config, cycle, groups, group_of) };
    };

    if (target.counts === "destroyed") {
        assert(exhaust !== null, "a destroyed target is planned with the decision of its results' windows");
        // planned by arithmetic: one count, no backoff, no other count offered (even hands moves the same hands)
        const main = planned(OutputCyclePlan.create(target, registry, config, fraction(1), overrides, exhaust), "main");
        return { per_group: groups.map((_, at) => [choiceOf(main, at)]), tried: [main], main, can_back_off: false, listed_from: null };
    }

    assert(input.max_swings !== null, "a target that counts an item made is planned on the swings its prepare step found");
    const max_swings = input.max_swings;
    const atCount = (count: number, listed_as: WindowCycleListing) => planned(OutputCyclePlan.create(target, registry, config, fraction(count),
        { ...overrides, terminal_swing_count: count }), listed_as);
    const under = (count: PlannedCount) => count.measure.main_window_cycle.toDecimal() < SIMULATION_BUDGET_TICKS;

    // the planning run's count, then today's swing backoff while the period is over the limit; the main clock's count
    // is the first under it, or the planned one where there is none
    const can_back_off = !forced;
    const first = planned(OutputCyclePlan.create(target, registry, config, max_swings(false), overrides), "planned", false, max_swings(false));
    const tried: PlannedCount[] = [first];
    if (!under(first) && can_back_off) {
        for (let count = first.swings - 1; count >= 1 && !under(tried[tried.length - 1]); count--) {
            tried.push(atCount(count, "backed-off"));
        }
    }
    const main_at = Math.max(0, tried.findIndex(under));
    const main: PlannedCount = { ...tried[main_at], listed_as: "main" };
    tried[main_at] = main;

    // an alternative's count whose cycle the cycle plan refuses is listed with the reason: today its run fails the same way
    const alternative = (swings: number | null, listed_as: WindowCycleListing, is_fractional: boolean, make: () => PlannedCount): ListedCount => {
        try {
            return make();
        } catch (error) {
            return { swings, fractional: is_fractional, listed_as, refused: error instanceof Error ? error.message : String(error) };
        }
    };
    // the lists start from the counts the main run reports: its own where it planned at the first count, the counts of
    // the backoff where it backed off (generateClockWithSwingBackoff, terminalCountForAlternativePlanning)
    const item = { item: target.machine_production_rate.item, counts: target.counts };
    const listed_from = main_at === 0 ? outputSwingsOf(main.cycle, registry, item) : main.swings;
    const planned_from = main_at === 0 ? listed_from : first.swings;
    const { lower, higher } = swingCountsListed(listed_from, planned_from, forced, main.measure.main_window_cycle.toDecimal());
    const fractionalAt = (swings: Fraction, count_overrides: typeof overrides) => OutputCyclePlan.create(target, registry, config, swings,
        count_overrides, undefined, true);
    const toggled = alternative(null, "fractional", true, () => {
        const exact = max_swings(true);
        try {
            return planned(fractionalAt(exact, overrides), "fractional", true, exact);
        } catch (error) {
            if (forced || !(error instanceof FractionalSwingsRefusedError) || error.swings_per_cycle === undefined) throw error;
            // as the run backs off (generateClockWithSwingBackoff): the first whole count below that the cycle plan accepts
            const refused = error.swings_per_cycle;
            for (let count = Math.ceil(refused.getNumerator / refused.getDenominator) - 1; count >= 1; count--) {
                let cycle: OutputCyclePlan;
                try {
                    cycle = fractionalAt(fraction(count), { ...overrides, terminal_swing_count: count });
                } catch (lower) {
                    if (lower instanceof FractionalSwingsRefusedError) continue;
                    throw lower;
                }
                if (!cycle.fractional_swings_enabled) throw fractionalSwingsWholeAt(error, count);
                return planned(cycle, "fractional", true, fraction(count));
            }
            throw error;
        }
    });
    const counts: ListedCount[] = [
        ...tried,
        ...higher.map(count => alternative(count, "higher", false, () => atCount(count, "higher"))),
        ...lower.map(count => alternative(count, "lower", false, () => atCount(count, "lower"))),
        toggled,
    ];
    return { per_group: groups.map((_, at) => counts.map(count => choiceOf(count, at))), tried, main, can_back_off,
        listed_from: { swings: listed_from, planned: planned_from } };
}
