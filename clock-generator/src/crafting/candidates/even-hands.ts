import assert from "../../common/assert";
import { Config } from "../../config";
import { OpenRange } from "../../data-types";
import { Entity, EntityId, ReadableEntityRegistry } from "../../entities";
import { BlueprintGenerationResult, GenerateClockOptions, checkedClock, clockOfPlan, planRun, withRoomForRandomAmounts } from "../plan/plan-run";
import { EntityTransferCountMap } from "../sequence/cycle/swing-counts";
import { alwaysEnabledInserters } from "../sequence/unplanned-inserter-clock";

/**
 * Even hands: every inserter gets one window for each hand the plan has it move in the period, the windows spread
 * evenly over the period, each one tick shorter than the inserter's hand cycle. Made from the plan's hand counts and
 * these rules of the game (Factorio 2.1.21, factorio-benchmarks docs/mechanics):
 *
 * - a hand from a machine or a chest fills in one tick, and a hand cycle between machines and chests is 8 ticks
 *   (inserters.md section 1, row 10 of the index);
 * - an inserter acts in as many ticks as its window has (rows 17 and 18), so a window of W ticks starts
 *   floor((W - 1) / cycle) + 1 hands (inserters.md section 9): one hand for any W up to the cycle;
 * - a machine takes an ingredient only while its output is under the output block and the ingredient under its
 *   insertion limit, and a hand that cannot be taken at the first tick of its window can still be taken at a later
 *   one (rows 3 and 7).
 *
 * So each window moves at most one hand, whenever in the window its source has it and its sink takes it, and no
 * inserter moves more than the plan asks. Two inserters that do the same thing for two machines of a build (the two
 * halves of a mirrored build) move the same hands a period and get the same windows, so they share one window decider,
 * and two inserters that take from one machine at the same rate take from it in the same ticks.
 *
 * Only for a build whose inserters all take from machines or chests, and all move a whole number of hands a period:
 * belt pickups fill over several ticks, and these windows are only derived for machine and chest sources.
 * Not for a build with inserters outside the plan (fuel, by-products, loops).
 */
export function evenHandsWindows(
    entity_registry: ReadableEntityRegistry,
    swing_counts: EntityTransferCountMap,
    recipe_lcm: number,
    period: number,
): Map<string, OpenRange[]> {
    assert(Number.isInteger(period), `even hands need a period of whole ticks, not ${period}`);
    const inserters = entity_registry.getAll().filter(Entity.isInserter);
    assert(entity_registry.getAll().every(entity => !Entity.isDrill(entity)), "even hands are not made for a build with mining drills");
    const transfers = new Map(Array.from(swing_counts.entries(), ([entity_id, transfer]) => [entity_id.id, transfer] as const));
    const windows = new Map<string, OpenRange[]>();
    for (const inserter of inserters) {
        assert(EntityId.isMachine(inserter.source.entity_id) || EntityId.isChest(inserter.source.entity_id),
            `even hands are only made where every inserter takes from a machine or a chest; ${inserter.entity_id.id} does not`);
        const transfer = transfers.get(inserter.entity_id.id);
        assert(transfer !== undefined, `${inserter.entity_id.id} is not in the plan's hand counts`);
        const exact = transfer.total_transfer_count.toDecimal() * recipe_lcm;
        const hands = Math.round(exact);
        assert(hands > 0 && Math.abs(exact - hands) < 1e-9, `${inserter.entity_id.id} moves ${exact} hands a period, not a whole number`);
        const width = inserter.animation.total.ticks - 1;
        assert(width >= 1 && hands * inserter.animation.total.ticks <= period, `${hands} hands of ${inserter.entity_id.id} do not fit in ${period} ticks`);
        const ranges: OpenRange[] = [];
        for (let k = 0; k < hands; k++) {
            const start = Math.round(k * period / hands);
            const end = start + width - 1;
            if (end < period) {
                ranges.push(OpenRange.from(start, end));
            } else {
                ranges.push(OpenRange.from(start, period - 1), OpenRange.from(0, end - period));
            }
        }
        windows.set(inserter.entity_id.id, ranges.sort((a, b) => a.start_inclusive - b.start_inclusive));
    }
    return windows;
}

/**
 * The even hands clock of a config (see evenHandsWindows), checked as a clock with windows of its own is: by the
 * clock-only runs from the start phases and the long run, not by the planning run, whose windows it does not use.
 */
export function evenHandsClock(config: Config, options: GenerateClockOptions = {}): BlueprintGenerationResult {
    const plan = planRun(config, options);
    const { simulation_context, swing_counts, recipe_lcm, duration, always_enabled_by_config, inserter_clocks } = plan.run;
    assert(always_enabled_by_config.size === 0 && inserter_clocks.size === 0 && alwaysEnabledInserters(simulation_context.entity_registry).length === 0,
        "even hands are not made for a build with inserters outside the plan");
    // a window that carries a result that comes by chance gets room for its spread, as the plan's do
    const room = withRoomForRandomAmounts(plan, evenHandsWindows(simulation_context.entity_registry, swing_counts, recipe_lcm, duration.ticks));
    const windows = room.windows;
    const planned = clockOfPlan(plan, { ...options, belt_pickup_slack: "never" });
    const clock = { ...planned, random_margins: room.random_margins };
    const result = checkedClock(plan, clock, windows, { ...options, verify_as_built: true });
    // the planning run's windows are not this clock's: it holds when its own windows hold
    result.stability_check.holds = result.stability_check.as_built?.holds ?? false;
    return result;
}
