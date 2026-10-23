import { OpenRange } from "../../data-types";
import { Entity, EntityId, handSizeFor, Inserter, Machine, ReadableEntityRegistry } from "../../entities";
import { EntityTransferCountMap } from "../sequence/cycle/swing-counts";
import { SwingDistribution } from "../sequence/cycle/swing-distribution";
import { BlueprintGenerationResult, GenerateClockOptions, PlanRun, checkedClock, clockOfPlan } from "../plan/plan-run";
import { alwaysEnabledInserters } from "../sequence/unplanned-inserter-clock";

/**
 * Ticks past the swings a window has room for: a window of `hands x cycle + 1` ticks is the shortest that starts the last
 * hand, and the clock gets one more for the tick a combinator takes
 */
const WINDOW_MARGIN_TICKS = 2;
/** Ticks after the start of its group at which an input window opens: the output swing is under way */
const INPUT_OFFSET_TICKS = 2;
/** A drill drops what it mined in the tick after it mined it, so a window of one tick drops nothing */
const MIN_DRILL_WINDOW_TICKS = 2;

/** Why the grouped hands rule does not apply to a build; the clock then keeps the windows it was planned with */
export class GroupedHandsNotApplicable extends Error { }

function refuse(reason: string): never {
    throw new GroupedHandsNotApplicable(reason);
}

/** The ticks of `ticks` long from `start` in a period, as ranges that end inside it */
function windowFrom(start: number, ticks: number, period: number): OpenRange[] {
    const first = ((start % period) + period) % period;
    const last = first + ticks - 1;
    return last < period ? [OpenRange.from(first, last)] : [OpenRange.from(first, period - 1), OpenRange.from(0, last - period)];
}

interface Taker {
    inserter: Inserter;
    source: EntityId;
    sink: EntityId;
    /** Items the taker moves a period */
    items: number;
    window_ticks: number;
}

/**
 * Hands in one run, in groups: the windows of a build whose machines all get their ingredients from sources that are
 * only read (a machine nothing is inserted into, a chest, a mining drill into the machine). Made from the plan's hand
 * counts and these rules of the game (Factorio 2.1.21):
 *
 * - a stack inserter swings once every `cycle` ticks while it is enabled and the sink takes its hand, and a machine
 *   takes a hand while it holds less than its insertion limit, so an inserter whose `h` hands a period follow each
 *   other without reaching the limit (`computeMaxSwingsPerSubCycle`) moves them all in one window of `h x cycle + 1`
 *   ticks, which opens at the tick its first hand starts. It gets that and one tick more;
 * - a machine makes a source's output at a rate and holds up to its output block, so the takers of one source cannot
 *   all draw their hands together: more than the block plus what the source makes in the window is not there. The
 *   machines taking from one source are split into the fewest groups for which each group's draw fits, and the groups
 *   open their windows evenly over the period;
 * - an output inserter swings once a period, in a window of one tick at the start of its machine's group, and its
 *   machine's input windows open at or after it, never before: a machine is refilled after its hand has left;
 * - a mining drill drops the whole of what it mined in a tick it is enabled, up to the machine's limit, and the machine
 *   holds the rest for the next window, so it needs a window of the planned length at least two ticks, anywhere in
 *   its machine's group.
 *
 * Only for a build whose inserters take from machines or chests that nothing inserts into, put into machines, and
 * whose machines pass their products on to belts or chests with one hand a period; whose inserters all move a whole
 * number of hands a period that fit the limit in one run. Throws GroupedHandsNotApplicable otherwise.
 */
export function groupedHandsWindows(
    entity_registry: ReadableEntityRegistry,
    swing_counts: EntityTransferCountMap,
    recipe_lcm: number,
    period: number,
    planned_windows: ReadonlyMap<string, OpenRange[]>,
): Map<string, OpenRange[]> {
    if (!Number.isInteger(period)) refuse(`the period is ${period} ticks, not a whole number`);
    const entities = entity_registry.getAll();
    const inserters = entities.filter(Entity.isInserter);
    const transfers = new Map(Array.from(swing_counts.entries(), ([entity_id, transfer]) => [entity_id.id, transfer] as const));

    const hands = (inserter: Inserter): number => {
        const transfer = transfers.get(inserter.entity_id.id);
        if (transfer === undefined) refuse(`${inserter.entity_id.id} is not in the plan's hand counts`);
        const exact = transfer.total_transfer_count.toDecimal() * recipe_lcm;
        const whole = Math.round(exact);
        if (whole <= 0 || Math.abs(exact - whole) > 1e-9) refuse(`${inserter.entity_id.id} moves ${exact} hands a period, not a whole number`);
        return whole;
    };

    // the machines something is put into by an inserter or a drill
    const sinks = new Set<string>();
    for (const inserter of inserters) {
        if (EntityId.isMachine(inserter.sink.entity_id)) sinks.add(inserter.sink.entity_id.id);
    }
    const drills = entities.filter(Entity.isDrill);
    for (const drill of drills) {
        if (!EntityId.isMachine(drill.sink_id)) refuse(`${drill.entity_id.id} drops into something that is not a machine`);
        sinks.add(drill.sink_id.id);
    }
    if (sinks.size === 0) refuse("nothing is put into a machine");

    const takers: Taker[] = [];
    const outputs: Inserter[] = [];
    for (const inserter of inserters) {
        const { source, sink } = inserter;
        if (EntityId.isMachine(sink.entity_id)) {
            if (!EntityId.isMachine(source.entity_id) && !EntityId.isChest(source.entity_id)) {
                refuse(`${inserter.entity_id.id} takes from ${source.entity_id.id}, not from a machine or a chest`);
            }
            if (sinks.has(source.entity_id.id)) refuse(`${inserter.entity_id.id} takes from ${source.entity_id.id}, which is put into itself`);
            const carried = transfers.get(inserter.entity_id.id)?.item_transfers ?? [];
            if (carried.length !== 1) refuse(`${inserter.entity_id.id} carries ${carried.length} items`);
            const primary = carried[0].item_name;
            const machine = entity_registry.getEntityByIdOrThrow(sink.entity_id) as Machine;
            const input = machine.getInsertableInput(primary);
            if (input === undefined) refuse(`${sink.entity_id.id} has no input for ${primary}`);
            const count = hands(inserter);
            const cycle = inserter.animation.total.ticks;
            const hand = Math.min(handSizeFor(inserter, primary), input.automated_insertion_limit.quantity);
            const room = SwingDistribution.computeMaxSwingsPerSubCycle({
                automated_insertion_limit: input.automated_insertion_limit.quantity,
                consumption_rate_per_tick: input.consumption_rate.rate_per_tick,
                stack_size: inserter.metadata.stack_size,
                animation_total_ticks: cycle,
            });
            if (count > room) refuse(`${count} hands of ${inserter.entity_id.id} do not follow each other under the limit of ${sink.entity_id.id} (${room} do)`);
            takers.push({ inserter, source: source.entity_id, sink: sink.entity_id, items: count * hand, window_ticks: count * cycle + WINDOW_MARGIN_TICKS });
        } else {
            if (!sinks.has(source.entity_id.id)) refuse(`${inserter.entity_id.id} takes ${source.entity_id.id}, which nothing is put into, to ${sink.entity_id.id}`);
            if (!EntityId.isBelt(sink.entity_id) && !EntityId.isChest(sink.entity_id)) refuse(`${inserter.entity_id.id} puts into ${sink.entity_id.id}`);
            if (hands(inserter) !== 1) refuse(`${inserter.entity_id.id} moves ${hands(inserter)} hands a period, not one`);
            outputs.push(inserter);
        }
    }
    if (takers.length === 0 || outputs.length === 0) refuse("the build has no input hands or no output hands");
    const longest = Math.max(...takers.map(it => it.window_ticks));
    if (longest + INPUT_OFFSET_TICKS >= period) refuse(`a window of ${longest} ticks does not fit a period of ${period}`);

    // the machines, in the order of their ids, and the fewest groups every source can serve
    const machines = Array.from(sinks).sort((a, b) => Number(a.split(":")[1]) - Number(b.split(":")[1]));
    const sources = new Map<string, { machine: Machine | null; draws: Map<string, number> }>();
    for (const taker of takers) {
        const known = sources.get(taker.source.id) ?? { machine: EntityId.isMachine(taker.source)
            ? entity_registry.getEntityByIdOrThrow(taker.source) as Machine : null, draws: new Map<string, number>() };
        known.draws.set(taker.sink.id, (known.draws.get(taker.sink.id) ?? 0) + taker.items);
        sources.set(taker.source.id, known);
    }
    const fits = (groups: number): boolean => Array.from(sources.values()).every(source => {
        if (source.machine === null) return true;
        const available = source.machine.output.outputBlock.held_limit + source.machine.output.production_rate.amount_per_tick.toDecimal() * longest;
        const drawn = new Array<number>(groups).fill(0);
        machines.forEach((machine, index) => { drawn[index % groups] += source.draws.get(machine) ?? 0; });
        return drawn.every(it => it <= available);
    });
    let groups = 1;
    while (groups <= machines.length && !fits(groups)) groups++;
    if (groups > machines.length) refuse("a source cannot serve even one machine at a time");
    const start_of = (machine: string): number => Math.round((machines.indexOf(machine) % groups) * period / groups);

    const windows = new Map<string, OpenRange[]>();
    for (const taker of takers) {
        windows.set(taker.inserter.entity_id.id, windowFrom(start_of(taker.sink.id) + INPUT_OFFSET_TICKS, taker.window_ticks, period));
    }
    for (const output of outputs) {
        windows.set(output.entity_id.id, windowFrom(start_of(output.source.entity_id.id), 1, period));
    }
    for (const drill of drills) {
        const planned = planned_windows.get(drill.entity_id.id) ?? [];
        const ticks = Math.max(MIN_DRILL_WINDOW_TICKS, ...planned.map(range => range.end_inclusive - range.start_inclusive + 1));
        windows.set(drill.entity_id.id, windowFrom(start_of(drill.sink_id.id) + INPUT_OFFSET_TICKS, ticks, period));
    }
    return windows;
}

/**
 * The clock of a plan with the windows of groupedHandsWindows, checked as a clock with windows of its own is: by the
 * clock-only runs from the start phases and the long run. Null where the rule does not apply to the build. It holds
 * when its own windows hold, not when the planning run of the plan does.
 */
export function groupedHandsClock(
    plan: PlanRun,
    planned: ReturnType<typeof clockOfPlan>,
    options: GenerateClockOptions = {},
): BlueprintGenerationResult | null {
    const { simulation_context, swing_counts, recipe_lcm, duration, always_enabled_by_config, inserter_clocks } = plan.run;
    let windows: Map<string, OpenRange[]>;
    try {
        if (always_enabled_by_config.size > 0 || inserter_clocks.size > 0 || alwaysEnabledInserters(simulation_context.entity_registry).length > 0) {
            refuse("the build has inserters outside the plan");
        }
        windows = groupedHandsWindows(simulation_context.entity_registry, swing_counts, recipe_lcm, duration.ticks, planned.windows);
    } catch (error) {
        if (error instanceof GroupedHandsNotApplicable) {
            plan.logger.log(`Grouped hands do not apply: ${error.message}`);
            return null;
        }
        throw error;
    }
    const result = checkedClock(plan, clockOfPlan(plan, { ...options, belt_pickup_slack: "never" }), windows, { ...options, verify_as_built: true });
    result.stability_check.holds = result.stability_check.as_built?.holds ?? false;
    return result;
}
