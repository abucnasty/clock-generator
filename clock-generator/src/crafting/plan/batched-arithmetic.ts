import { OpenRange } from "../../data-types";
import { Entity, handSizeFor, Inserter, Machine, ReadableEntityRegistry } from "../../entities";
import { FactorioDataService } from "../../data/factorio-data-service";
import { machineFactsOfEntity } from "../../entities/traits/machine-facts-of";
import { OutputCyclePlan } from "../sequence/cycle/output-cycle";
import { targetMachinesOf } from "../sequence/cycle/target-ends";
import { alwaysEnabledInserters, byProductOnlyInserters, fuelOnlyInserters } from "../sequence/unplanned-inserter-clock";
import { StockWalk, WalkHand, WalkSwing, WINDOW_LATENCY_TICKS, walkMachineStock } from "./stock-walk";

/**
 * The windows of the batched-swings clock made by arithmetic, beside the planning run (which reads them off a run of the
 * build): from the hands of the plan, the crafting cycle and the craft phase, with the stock walk (stock-walk.ts) of each
 * machine and no run of the build.
 *
 * - The output: the inserters that take the target from a machine take each cycle's hands in one batch, from the cycle's
 *   start (the tick after it, as the planning run's windows open), each hand as the machine has it. Their window runs from
 *   the batch's first pickup to the tick after its last hand is full.
 * - Every other inserter that takes from a machine (to another machine, a belt or a chest) and every inserter that fills
 *   one brings its hands of a cycle as soon as the machine has them, or has room for them (under the insertion limit, the
 *   output under the output block): its window runs from the cycle's first hand to the tick after its last one starts.
 * - The machines are walked from the output machines back along the build: a machine is walked once every inserter that
 *   takes from it has its windows, those windows being its takes; the inserters that fill it get theirs from that walk.
 *
 * A build it has no rule for is refused (`ArithmeticWindowsNotApplicable`), and the planning run's windows stay.
 */

/** Why the arithmetic has no windows for a build: the clock keeps the windows of the planning run */
export class ArithmeticWindowsNotApplicable extends Error { }

/**
 * The refusal of a build whose output machine does not make a cycle's hands in the batch the arithmetic gives them, its
 * window lengthened to the hands the stock walk saw come late `MAX_BATCH_PASSES` times: the output swing estimate
 * (output-swing-estimate.ts) reads it as a count the batched windows fall behind at
 */
export class ArithmeticBatchesFallBehind extends ArithmeticWindowsNotApplicable { }

function refuse(reason: string): never {
    throw new ArithmeticWindowsNotApplicable(reason);
}

export interface ArithmeticWindowsInput {
    entity_registry: ReadableEntityRegistry;
    output_cycle_plan: OutputCyclePlan;
    /** The clock's period, whole ticks */
    window_cycle_ticks: number;
    /** Cycles in the period */
    recipe_lcm: number;
    /** Inserters the config leaves always enabled, which the arithmetic has no rule for */
    always_enabled_by_config: ReadonlySet<string>;
}

export interface ArithmeticWindows {
    /** The windows of every inserter, by entity id, in clock positions of the period */
    windows: Map<string, OpenRange[]>;
    /** The stock walk of every machine the windows were made from, by entity id */
    walks: Map<string, StockWalk>;
}

/** Hands an inserter moves in each cycle of the period: a fraction of hands a cycle is spread as evenly as whole hands go */
function handsPerCycle(hands: { getNumerator: number; getDenominator: number }, cycles: number, id: string): number[] {
    const numerator = hands.getNumerator, denominator = hands.getDenominator;
    if (cycles % denominator !== 0) refuse(`${id} moves ${numerator}/${denominator} hands a cycle, not whole in ${cycles} cycles`);
    return Array.from({ length: cycles }, (_, cycle) => {
        const at = cycle % denominator;
        return Math.floor((at + 1) * numerator / denominator) - Math.floor(at * numerator / denominator);
    });
}

/** The swing of an inserter in the stock walk: the pickup off a belt takes a lane stack a tick */
function swingOf(inserter: Inserter, registry: ReadableEntityRegistry): WalkSwing {
    const animation = inserter.animation;
    let pickup = animation.pickup.ticks;
    const source = registry.getEntityByIdOrThrow(inserter.source.entity_id);
    if (Entity.isBelt(source)) {
        const lanes = source.lanes.filter(lane => inserter.filtered_items.has(lane.ingredient_name));
        const lane_stack = Math.min(...(lanes.length > 0 ? lanes : source.lanes).map(lane => lane.stack_size));
        pickup = Math.max(pickup, Math.ceil(inserter.metadata.stack_size / lane_stack));
    }
    return { pickup, rotation: animation.rotation.ticks, drop: animation.drop.ticks };
}

/** Windows in clock positions from walk ticks: each range the ticks the inserter acts in, less the latency */
function positions(first: number, last: number, window_cycle_ticks: number): OpenRange[] {
    const start = ((first - WINDOW_LATENCY_TICKS) % window_cycle_ticks + window_cycle_ticks) % window_cycle_ticks;
    const length = last - first + 1;
    if (length >= window_cycle_ticks) return [OpenRange.from(0, window_cycle_ticks - 1)];
    const end = start + length - 1;
    return end < window_cycle_ticks ? [OpenRange.from(start, end)] : [OpenRange.from(start, window_cycle_ticks - 1), OpenRange.from(0, end - window_cycle_ticks)];
}

/** Times a batch of output windows is lengthened to the hands the stock walk saw come late, before it is given up */
const MAX_BATCH_PASSES = 6;

/**
 * The stock walk of a machine whose output inserters take the target in batches (`batch`, by inserter id, changed in
 * place): a batch whose last hand the walk sees full after its window, or that misses a hand, is lengthened to the tick
 * after the hand is full and the machine walked again
 */
function walkWithBatches(
    facts: ReturnType<typeof machineFactsOfEntity>,
    window_cycle_ticks: number,
    takers: WalkHand[],
    fillers: readonly WalkHand[],
    batch: Map<string, OpenRange[]>,
    cycle_starts: readonly number[],
    quotas: ReadonlyMap<string, number[]>,
    machine_id: string,
): StockWalk {
    for (let pass = 0; ; pass++) {
        const walk = walkMachineStock({ machine: facts, window_cycle_ticks, takers, fillers, max_window_cycles: 128 });
        if (!walk.converged) refuse(`the stock walk of ${machine_id} does not repeat`);
        let lengthened = false;
        for (const [id, ranges] of batch) {
            const hands = walk.hands.filter(hand => hand.id === id);
            const expected = quotas.get(id)!.reduce((sum, it) => sum + it, 0);
            const late = hands.filter(hand => !ranges.some(range => {
                const position = ((hand.machine_tick - WINDOW_LATENCY_TICKS) % window_cycle_ticks + window_cycle_ticks) % window_cycle_ticks;
                return position >= range.start_inclusive && position + 1 <= range.end_inclusive;
            }));
            if (late.length === 0 && hands.length === expected) continue;
            // the window of the cycle the batch starts in runs on to the tick after its last hand is full, or a swing longer
            const longer = ranges.map(range => {
                const ends = late.map(hand => ((hand.machine_tick - WINDOW_LATENCY_TICKS) % window_cycle_ticks + window_cycle_ticks) % window_cycle_ticks)
                    .filter(position => position >= range.start_inclusive && position < range.start_inclusive + window_cycle_ticks / cycle_starts.length);
                const end = ends.length > 0 ? Math.max(...ends) + 1 : range.end_inclusive + (hands.length < expected ? 4 : 0);
                return OpenRange.from(range.start_inclusive, Math.min(end, window_cycle_ticks - 1));
            });
            batch.set(id, OpenRange.reduceRanges(longer));
            const taker = takers.find(it => it.id === id)!;
            takers[takers.indexOf(taker)] = { ...taker, windows: batch.get(id)! };
            lengthened = true;
        }
        if (!lengthened) return walk;
        if (pass + 1 >= MAX_BATCH_PASSES) throw new ArithmeticBatchesFallBehind(`the output of ${machine_id} does not keep up with its batches`);
    }
}

/** The part of the period (cycle) a walk tick falls in */
function cycleOf(tick: number, cycle_starts: readonly number[]): number {
    let cycle = 0;
    for (let index = 0; index < cycle_starts.length; index++) if (cycle_starts[index] <= tick) cycle = index;
    return cycle;
}

/**
 * The windows of the batched-swings clock of a build by arithmetic (see the module comment); throws
 * `ArithmeticWindowsNotApplicable` for a build it has no rule for.
 */
export function batchedSwingsWindowsByArithmetic(input: ArithmeticWindowsInput): ArithmeticWindows {
    const { entity_registry: registry, output_cycle_plan: plan, window_cycle_ticks, recipe_lcm: cycles } = input;
    if (!Number.isInteger(window_cycle_ticks)) refuse(`a period of ${window_cycle_ticks} ticks is not whole`);
    if (plan.fractional_swings_enabled) refuse("fractional swings are planned by their own clock");
    if (plan.exhaust !== undefined) refuse("results that come by chance get windows of their own");
    if (plan.production_rate.counts !== "made") refuse("a target that counts an item destroyed is planned by its own arithmetic");
    const cycle_ticks = plan.total_duration_ticks.toDecimal();
    if (Math.abs(cycle_ticks * cycles - window_cycle_ticks) > 1e-6) refuse(`the period ${window_cycle_ticks} is not ${cycles} cycles of ${cycle_ticks} ticks`);
    const entities = registry.getAll();
    if (entities.some(Entity.isDrill)) refuse("a build with drills");
    if (input.always_enabled_by_config.size > 0 || alwaysEnabledInserters(registry).length > 0) refuse("a build with inserters left always enabled");
    if (fuelOnlyInserters(registry).length > 0 || byProductOnlyInserters(registry).length > 0) refuse("a build with inserters outside the plan");
    const machines = entities.filter(Entity.isMachine);
    for (const machine of machines) {
        if (machine.outputs.length > 1) refuse(`${machine.entity_id.id} makes more than one result`);
        if (machine.result_target !== undefined) refuse(`${machine.entity_id.id} places its results itself`);
        if (machine.fuel_slot !== undefined) refuse(`${machine.entity_id.id} burns fuel`);
    }
    const inserters = entities.filter(Entity.isInserter);
    const transfers = new Map(Array.from(plan.entity_transfer_map.entries(), ([id, transfer]) => [id.id, transfer] as const));
    for (const inserter of inserters) {
        if (!transfers.has(inserter.entity_id.id)) refuse(`${inserter.entity_id.id} has no hands in the plan`);
        const source = registry.getEntityByIdOrThrow(inserter.source.entity_id);
        const sink = registry.getEntityByIdOrThrow(inserter.sink.entity_id);
        if (Entity.isChest(source) && entities.some(it => (Entity.isInserter(it) && it.sink.entity_id.id === source.entity_id.id)
            || (Entity.isDrill(it) && it.sink_id.id === source.entity_id.id))) {
            refuse(`${inserter.entity_id.id} takes from a chest the build fills`);
        }
        if (!Entity.isMachine(source) && !Entity.isMachine(sink)) refuse(`${inserter.entity_id.id} moves between no machines`);
    }

    const cycle_starts = Array.from({ length: cycles }, (_, cycle) => Math.floor(cycle * cycle_ticks + 1e-9));
    const target = { item: plan.production_rate.machine_production_rate.item, counts: plan.production_rate.counts };
    const target_machines = new Set(targetMachinesOf(target, registry).map(it => it.entity_id.id));
    const quotas = new Map(inserters.map(inserter => [inserter.entity_id.id,
        handsPerCycle(transfers.get(inserter.entity_id.id)!.total_transfer_count, cycles, inserter.entity_id.id)] as const));

    const windows = new Map<string, OpenRange[]>();
    const walks = new Map<string, StockWalk>();
    const takersOf = (machine: Machine) => inserters.filter(it => it.source.entity_id.id === machine.entity_id.id);
    const fillersOf = (machine: Machine) => inserters.filter(it => it.sink.entity_id.id === machine.entity_id.id);

    // the machines in the order of the build back from its output: a machine once every inserter that takes from it has windows
    const done = new Set<string>();
    while (done.size < machines.length) {
        const next = machines.find(machine => !done.has(machine.entity_id.id) && takersOf(machine).every(taker => {
            const sink = registry.getEntityByIdOrThrow(taker.sink.entity_id);
            return !Entity.isMachine(sink) || windows.has(taker.entity_id.id);
        }));
        if (next === undefined) refuse("the machines take from one another in a loop");
        const facts = machineFactsOfEntity(next);
        const terminal = target_machines.has(next.entity_id.id);
        // the output of the target: each cycle's hands in one batch from the tick after the cycle starts, a swing each and a
        // tick (the length the grouped hands' output windows have), lengthened below where the machine is slower
        const batch = new Map<string, OpenRange[]>();
        const takers: WalkHand[] = takersOf(next).map(taker => {
            const id = taker.entity_id.id;
            const known = windows.get(id);
            const common = { id, items: [facts.output_item], hand: handSizeFor(taker, facts.output_item), swing: swingOf(taker, registry) };
            if (known !== undefined) return { ...common, windows: known };
            if (terminal) {
                const hands = quotas.get(id)!;
                const swing = taker.animation.total.ticks;
                const ranges = OpenRange.reduceRanges(cycle_starts.flatMap((start, cycle) => hands[cycle] === 0 ? []
                    : positions(start + 1 + WINDOW_LATENCY_TICKS, start + 1 + WINDOW_LATENCY_TICKS + hands[cycle] * swing, window_cycle_ticks)));
                batch.set(id, ranges);
                return { ...common, windows: ranges };
            }
            // a taker into a belt or a chest of another item than the target: its hands of a cycle as the machine has them
            return { ...common, quota: quotas.get(id)!, quota_starts: cycle_starts };
        });
        const fillers: WalkHand[] = fillersOf(next).map(filler => {
            const source = registry.getEntityByIdOrThrow(filler.source.entity_id);
            const items = Array.from(filler.filtered_items).filter(item => facts.inputs.some(input => input.item_name === item));
            if (items.length === 0) refuse(`${filler.entity_id.id} brings nothing ${next.entity_id.id} takes`);
            const ordered = Entity.isChest(source)
                ? [...items].sort((a, b) => FactorioDataService.itemInventoryRankOrThrow(b) - FactorioDataService.itemInventoryRankOrThrow(a))
                : items;
            return { id: filler.entity_id.id, items: ordered, pick: Entity.isChest(source) ? "in-order" : "least-cover",
                hand: filler.metadata.stack_size, swing: swingOf(filler, registry), quota: quotas.get(filler.entity_id.id)!, quota_starts: cycle_starts };
        });
        const walk = walkWithBatches(facts, window_cycle_ticks, takers, fillers, batch, cycle_starts, quotas, next.entity_id.id);
        walks.set(next.entity_id.id, walk);
        for (const [id, ranges] of batch) windows.set(id, ranges);
        // each other inserter's hands of a cycle in one window: from its first pickup to the tick after its last (a taker's
        // last hand full)
        for (const hand_owner of [...takers.filter(it => it.windows === undefined), ...fillers]) {
            const hands = walk.hands.filter(hand => hand.id === hand_owner.id);
            const expected = hand_owner.quota!.reduce((sum, it) => sum + it, 0);
            if (hands.length !== expected) {
                refuse(`${hand_owner.id} moves ${hands.length} hands a period in the stock walk of ${next.entity_id.id}, not ${expected}`);
            }
            const by_cycle = new Map<number, { first: number; last: number }>();
            for (const hand of hands) {
                const cycle = cycleOf(hand.pickup_tick, cycle_starts);
                const last = takers.includes(hand_owner) ? hand.pickup_tick + hand.ticks : hand.pickup_tick;
                const known = by_cycle.get(cycle);
                by_cycle.set(cycle, known === undefined ? { first: hand.pickup_tick, last }
                    : { first: Math.min(known.first, hand.pickup_tick), last: Math.max(known.last, last) });
            }
            windows.set(hand_owner.id, OpenRange.reduceRanges(Array.from(by_cycle.values())
                .flatMap(({ first, last }) => positions(first, last + 1, window_cycle_ticks))));
        }
        done.add(next.entity_id.id);
    }
    return { windows, walks };
}
