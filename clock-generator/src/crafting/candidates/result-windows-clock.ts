import assert from "../../common/assert";
import { Config } from "../../config";
import { OpenRange } from "../../data-types";
import { Entity, Machine } from "../../entities";
import { BlueprintGenerationResult, GenerateClockOptions, PlanRun, checkedClock, clockOfPlan, planRun, withRoomForRandomAmounts } from "../plan/plan-run";
import { ResultWindowsKind, ResultWindowsPlan, resultWindowRanges, resultWindowsPlan, takesResultOf } from "../result-windows";
import { evenWindows } from "./even-hands";

/**
 * The clock of a plan whose results come too rarely for whole hands in a period (result-windows.ts): the inserters that
 * bring the item destroyed get one window for each hand, spread evenly over the period, as even hands gives them; the
 * inserters that take each result out of the container get the result's one window a period, opened in turn
 * ("staggered") or all together ("shared"). Nothing is read off the planning run: the windows are the arithmetic's, the
 * simulator runs them for several periods (checkedClock), and the clock holds where both hold.
 */
export function resultWindowsClockOfPlan(plan: PlanRun, options: GenerateClockOptions = {}, kind: ResultWindowsKind = "staggered"): BlueprintGenerationResult {
    const { simulation_context, swing_counts, crafting_cycle_plan, duration } = plan.run;
    const planned = crafting_cycle_plan.result_windows;
    assert(planned !== undefined, "the plan has no windows of results");
    const registry = simulation_context.entity_registry;
    const plans = planned.map(it => it.kind === kind ? it : resultWindowsPlanOfKind(it, registry, kind));
    const period = duration.ticks;
    const windows = new Map<string, OpenRange[]>();
    for (const inserter of registry.getAll().filter(Entity.isInserter)) {
        if (takesResultOf(plans, inserter.entity_id)) {
            continue;
        }
        const transfer = swing_counts.get(inserter.entity_id);
        assert(transfer !== undefined, `${inserter.entity_id.id} is not in the plan's hand counts`);
        const hands = transfer.total_transfer_count.toDecimal();
        assert(Number.isInteger(hands) && hands > 0, `${inserter.entity_id.id} moves ${hands} hands a period, not a whole number`);
        windows.set(inserter.entity_id.id, evenWindows(hands, inserter.animation.total.ticks, period));
    }
    for (const result_plan of plans) {
        for (const [inserter_id, ranges] of resultWindowRanges(result_plan)) {
            windows.set(inserter_id, ranges);
        }
    }
    // the windows' room for the spread of each result, as every destroyed target's clock reports it (it adds none here:
    // each window is made for the result's count at that share)
    const room = withRoomForRandomAmounts(plan, windows);
    const clock = { ...clockOfPlan(plan, { ...options, belt_pickup_slack: "never" }), random_margins: room.random_margins };
    const result = checkedClock(plan, clock, room.windows, { ...options, verify_as_built: true });
    const holds = plans.every(it => it.container.headroom !== null && it.container.headroom >= 0);
    // the planning run's windows are not this clock's: it holds where its own windows hold in the simulator and the arithmetic holds
    result.stability_check.holds = (result.stability_check.as_built?.holds ?? false) && holds;
    return { ...result, result_windows: { plans, holds } };
}

/** A plan of the same period with the other kind of openings, its container's margin worked out for them */
function resultWindowsPlanOfKind(plan: ResultWindowsPlan, registry: Parameters<typeof resultWindowsPlan>[0]["registry"], kind: ResultWindowsKind): ResultWindowsPlan {
    const machine = registry.getAll().filter(Entity.isMachine).find(it => it.entity_id.number === plan.machine_id) as Machine;
    return resultWindowsPlan({ machine, registry, cycle_ticks: plan.period / plan.cycles, crafts_per_cycle: plan.crafts / plan.cycles, kind, cycles: plan.cycles });
}

/** The feed cycles of the period on which one shared window for all results is planned: the longest the containers hold */
function sharedCycles(plan: PlanRun): number {
    const { simulation_context, crafting_cycle_plan } = plan.run;
    const registry = simulation_context.entity_registry;
    return Math.min(...crafting_cycle_plan.result_windows!.map(it => {
        const machine = registry.getAll().filter(Entity.isMachine).find(machine => machine.entity_id.number === it.machine_id) as Machine;
        return resultWindowsPlan({ machine, registry, cycle_ticks: it.period / it.cycles, crafts_per_cycle: it.crafts / it.cycles, kind: "shared" }).cycles;
    }));
}

/**
 * One window for all results: every taker opens at the start of the period and stays on for the longest window, on the
 * longest period whose results the containers hold all at once. Planned on the config with that period's hands forced
 * (`terminal_swing_count`), unless the config forces its own.
 */
export function sharedResultWindowClock(config: Config, options: GenerateClockOptions = {}): BlueprintGenerationResult {
    const plan = planRun(config, options);
    if (plan.run.crafting_cycle_plan.result_windows === undefined || config.overrides?.terminal_swing_count !== undefined) {
        return resultWindowsClockOfPlan(plan, options, "shared");
    }
    const [first] = plan.run.crafting_cycle_plan.result_windows;
    const hands_per_cycle = plan.run.used_terminal_swing_count / first.cycles;
    const cycles = sharedCycles(plan);
    if (cycles === first.cycles) {
        return resultWindowsClockOfPlan(plan, options, "shared");
    }
    const shared_config: Config = { ...config, overrides: { ...config.overrides, terminal_swing_count: hands_per_cycle * cycles } };
    return resultWindowsClockOfPlan(planRun(shared_config, options), options, "shared");
}
