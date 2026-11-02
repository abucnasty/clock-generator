import assert from "../../common/assert";
import { OpenRange } from "../../data-types";
import { Entity } from "../../entities";
import { BlueprintGenerationResult, GenerateClockOptions, PlanRun, checkedClock, clockOfPlan, withRoomForRandomAmounts } from "../plan/plan-run";
import { resultWindowRanges, takesResultOf } from "../result-windows";
import { evenWindows } from "./even-hands";

/**
 * The clock of a plan whose results come too rarely for whole hands in a period (result-windows.ts): the inserters that
 * bring the item destroyed get one window for each hand, spread evenly over the period, as even hands gives them; the
 * inserters that take each result out of the container get the result's one window a period, opened in turn
 * ("staggered"). Nothing is read off the planning run: the windows are the arithmetic's, the simulator runs them for
 * several periods (checkedClock), and the clock holds where both hold.
 */
export function resultWindowsClockOfPlan(plan: PlanRun, options: GenerateClockOptions = {}): BlueprintGenerationResult {
    const { simulation_context, swing_counts, crafting_cycle_plan, duration } = plan.run;
    assert(crafting_cycle_plan.result_windows !== undefined, "the plan has no windows of results");
    const plans = [...crafting_cycle_plan.result_windows];
    const registry = simulation_context.entity_registry;
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
