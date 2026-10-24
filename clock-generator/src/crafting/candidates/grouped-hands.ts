import { OpenRange } from "../../data-types";
import { Entity, EntityId, handSizeFor, Inserter, Machine, MiningDrill, miningDrillMaxInsertion, ReadableEntityRegistry } from "../../entities";
import { DRILL_ITEMS_PER_SWING, EntityTransferCountMap } from "../sequence/cycle/swing-counts";
import { SwingDistribution } from "../sequence/cycle/swing-distribution";
import { BlueprintGenerationResult, GenerateClockOptions, PlanRun, checkedClock, clockOfPlan, planRun } from "../plan/plan-run";
import { alwaysEnabledInserters } from "../sequence/unplanned-inserter-clock";
import { ClockBelt, beltPickupSlackTicks } from "../clock";
import { backpressureLossVerdictOf, runClockOnBuild } from "../trial";
import { DropTieBreak, dropTieBreak } from "../../config/drop-spacing";
import { TurnGroup } from "../turn-groups";
import type { AlwaysOnReason } from "../always-on-reasons";
import { sharedItemDeadlockRisks } from "../deadlock-risk";
import { rankingWindowCount } from "../rank";

/** Ticks added to the shortest window that starts the last hand: one for the tick a combinator takes, one of margin */
const WINDOW_MARGIN_TICKS = 2;
/** Ticks after the start of its group at which an input window opens: the output swing is under way */
const INPUT_OFFSET_TICKS = 2;
/** A drill drops what it mined in the tick after it mined it, so a window of one tick drops nothing */
const MIN_DRILL_WINDOW_TICKS = 2;
/** Ticks a stage opens after the one before it, for the inserters that fill the machine a taker takes from: staged, then compact */
const FEEDER_OFFSETS_TICKS = [16, 1];
/** Ticks every group of windows is moved either way to see that the clock does not hold at one placement only */
const MARGIN_SHIFT_TICKS = 1;

/** How the windows of one way are made: see groupedHandsClock, which makes them in every way and ranks the clocks */
export interface GroupedHandsOptions {
    /**
     * An inserter whose machine would take more than one hand over the hands it moves (a surplus hand it keeps) gets a window
     * for its hands and no more; without this every window has the extra start that the limit of a machine refuses
     */
    surplus_guard: boolean;
    /** Ticks after a taker's window opens that the window of an inserter filling the machine it takes from opens */
    feeder_offset: number;
    /** The takers whose windows open on the same tick share one window: the longest any of them needs */
    share_windows: boolean;
}

const DEFAULT_OPTIONS: GroupedHandsOptions = { surplus_guard: false, feeder_offset: 1, share_windows: false };

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

/**
 * The windows of the takers that open on the same tick made one: the earliest start and the latest end any of them needs,
 * which is the longest window from that tick. The takers that are left open all period have none to share.
 */
function sharedWindows(windows: Map<string, OpenRange[]>, takers: Taker[], period: number): void {
    const open = new Map<string, { ticks: number; ids: string[] }>();
    for (const taker of takers) {
        const ranges = windows.get(taker.inserter.entity_id.id);
        if (ranges === undefined) continue;
        const key = `${ranges[0].start_inclusive}`;
        const known = open.get(key) ?? { ticks: 0, ids: [] };
        known.ticks = Math.max(known.ticks, taker.window_ticks);
        known.ids.push(taker.inserter.entity_id.id);
        open.set(key, known);
    }
    for (const [key, { ticks, ids }] of open) {
        for (const id of ids) windows.set(id, windowFrom(Number(key), ticks, period));
    }
}

/** The windows moved `ticks` later in the period (earlier when negative) */
function shiftedWindows(ranges: OpenRange[], ticks: number, period: number): OpenRange[] {
    return OpenRange.reduceRanges(ranges.flatMap(range =>
        windowFrom(range.start_inclusive + ticks, range.end_inclusive - range.start_inclusive + 1, period)));
}

/**
 * The ticks a drill is enabled in a period to bring `items` to its machine: the items over what it mines in an enabled tick,
 * that is at most what the machine takes at once (the drill stops dropping at its limit and keeps the rest), rounded up, and
 * at least MIN_DRILL_WINDOW_TICKS. The drill's bars keep what a tick mines beyond a whole item, so over the periods it mines
 * its rate in every tick it is enabled.
 */
export function drillWindowTicks(drill: MiningDrill, machine: Machine, items: number): number {
    const per_tick = Math.min(drill.production_rate.amount_per_tick.toDecimal(), miningDrillMaxInsertion(drill, machine));
    return Math.max(MIN_DRILL_WINDOW_TICKS, Math.ceil(items / per_tick - 1e-9));
}

interface Taker {
    inserter: Inserter;
    source: EntityId;
    sink: EntityId;
    /** Items the taker moves a period */
    items: number;
    window_ticks: number;
    /** Takes a machine's product into a chest that others take from: a taker of that machine, whose hand the machine does not hold ready */
    drain?: boolean;
}

/** Whole hands a period of an item moved `count` hands a cycle over `cycles` cycles: the next whole number (rule F) */
function wholeHands(count: number, cycles: number): number {
    return Math.ceil(count * cycles - 1e-9);
}

const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);

/**
 * The cycles of a clock made of grouped hands: what every inserter that takes an output out of the build needs to move
 * whole hands. The hands of the inserters that fill a machine, or a chest a machine is filled from, are made whole by
 * rounding them up (rule F, below), so they set nothing. Null where the plan has no such inserter.
 */
export function groupedHandsCycles(entity_registry: ReadableEntityRegistry, swing_counts: EntityTransferCountMap): number | null {
    let lcm = 1;
    let found = false;
    const transfers = new Map(Array.from(swing_counts.entries(), ([entity_id, transfer]) => [entity_id.id, transfer] as const));
    const inserters = entity_registry.getAll().filter(Entity.isInserter);
    const chests_taken_from = new Set(inserters.filter(it => EntityId.isMachine(it.sink.entity_id) && EntityId.isChest(it.source.entity_id)).map(it => it.source.entity_id.id));
    for (const inserter of inserters) {
        // an inserter that fills a machine, or a chest that machines are filled from, has its hands rounded up
        if (EntityId.isMachine(inserter.sink.entity_id) || chests_taken_from.has(inserter.sink.entity_id.id)) continue;
        const transfer = transfers.get(inserter.entity_id.id);
        if (transfer === undefined) continue;
        found = true;
        // the hands of the inserter in all, not each lane's or item's part: an export onto two lanes at 1/2 + 1/2 is one hand
        const denominator = transfer.total_transfer_count.getDenominator;
        lcm = lcm / gcd(lcm, denominator) * denominator;
    }
    return found ? lcm : null;
}

/**
 * Hands in one run, in groups: the windows of a build whose machines get their ingredients from sources that are
 * read (a machine, a chest, a belt, a mining drill into the machine) and hand their products on to a belt or a chest.
 * Made from the plan's hand counts and these rules of the game (Factorio 2.1.21):
 *
 * - a stack inserter swings once every `cycle` ticks while it is enabled and the sink takes its hand, and a machine
 *   takes a hand while it holds less than its insertion limit, so an inserter whose `h` hands a period follow each
 *   other without reaching the limit (`computeMaxSwingsPerSubCycle`) moves them all in one window that opens at the tick
 *   its first hand starts. The window is long enough to start every hand the machine can take, `S` of them, and no
 *   longer: `(S - 1) x cycle + 2` ticks (the last hand starts inside it, and a combinator takes a tick), and the belt
 *   pickup slack more where it picks up from a belt. `S` is `h + 1` where the machine's limit refuses another hand after
 *   `h` (room for at most `h + 1`), and `h` where it would take it (more room than that: another hand is a surplus);
 * - rule F: an inserter that fills a machine and moves a fraction of a hand per cycle (15/8) is planned at the next whole
 *   number of hands, which makes its count whole in one cycle. The machine's limit refuses the surplus, so it moves the
 *   fraction on average. The period is the cycles in which the inserters that take the output out move whole hands
 *   (`groupedHandsCycles`);
 * - a machine makes a source's output at a rate and holds up to its output block, so the takers of one source cannot
 *   all draw their hands together: more than the block plus what the source makes in the window is not there. The
 *   machines taking from one source are split into the fewest groups for which each group's draw fits, and the groups
 *   open their windows evenly over the period;
 * - an output inserter swings once a period, in a window of one tick at the start of its machine's group (an output of
 *   more hands in a window of `h x cycle + 1` ticks), and its machine's input windows open at or after it, never before:
 *   a machine is refilled after its hand has left;
 * - an inserter whose hands, rounded up, take the period (a window of its hands and the offset reaches it) is busy all the time:
 *   a window would only make gaps between hands that follow each other, so it has none and stays enabled;
 * - a mining drill drops the whole of what it mined in a tick it is enabled, up to the machine's limit, and the machine
 *   holds the rest for the next window, so its window is as many ticks as it takes to mine what its machine takes of it
 *   in a period (`drillWindowTicks`), at least two; the drills of one group of machines share one window, the longest any of
 *   them needs, which opens with the group's inputs;
 * - where a source machine is itself filled by other inserters (a chain of machines), the windows go in the order of the
 *   chain, from the output: the output machines' inputs from belts and chests, then those from machines, each stage
 *   when the previous one's window ends, and the inserters that fill a source machine a tick after the one that takes
 *   from it, so the machine is emptied before it is filled. One group serves such a chain (the draw against a source's
 *   block and rate is not the test there; the clock-only runs are).
 *
 * Throws GroupedHandsNotApplicable where the build does not fit this, or the hands do not follow each other under the limit.
 */
export function groupedHandsWindows(
    entity_registry: ReadableEntityRegistry,
    swing_counts: EntityTransferCountMap,
    recipe_lcm: number,
    period: number,
    /** Whether a window that picks up from a belt has the belt pickup slack (a clock for a moving belt); not on backed-up belts */
    with_belt_slack: boolean = true,
    options: GroupedHandsOptions = DEFAULT_OPTIONS,
    /** Where the output inserters stand on a shared belt: among groupings that serve the sources equally, the one whose hands fit on the belt */
    drop_tie_break: DropTieBreak | null = null,
): Map<string, OpenRange[]> {
    return groupedHandsPlan(entity_registry, swing_counts, recipe_lcm, period, with_belt_slack, options, drop_tie_break).windows;
}

/** The windows of `groupedHandsWindows` and the groups that take turns in them */
export interface GroupedHandsPlan {
    windows: Map<string, OpenRange[]>;
    /**
     * The groups of machines that take turns, in the order of their turns, with the inserters and drills of each in the order of
     * the turn: what lays the clock's combinators out by group. Empty where the build is one group (one turn, or a chain of
     * machines, which one group serves).
     */
    turns: TurnGroup[];
    /** The ids of the takers busy all the time, whose hands take the whole period: they have no window */
    busy: string[];
}

/** The windows of `groupedHandsWindows`, with the groups whose turns they are */
export function groupedHandsPlan(
    entity_registry: ReadableEntityRegistry,
    swing_counts: EntityTransferCountMap,
    recipe_lcm: number,
    period: number,
    with_belt_slack: boolean = true,
    options: GroupedHandsOptions = DEFAULT_OPTIONS,
    drop_tie_break: DropTieBreak | null = null,
): GroupedHandsPlan {
    if (!Number.isInteger(period)) refuse(`the period is ${period} ticks, not a whole number`);
    const entities = entity_registry.getAll();
    const inserters = entities.filter(Entity.isInserter);
    const transfers = new Map(Array.from(swing_counts.entries(), ([entity_id, transfer]) => [entity_id.id, transfer] as const));
    const belt_slack = with_belt_slack ? beltPickupSlackTicks(entity_registry) : new Map<string, number>();

    const outputHands = (inserter: Inserter): number => {
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
    // the chests something takes from to fill a machine: an inserter that fills one from a machine is a taker of that machine
    const chests_taken_from = new Set(inserters.filter(it => EntityId.isMachine(it.sink.entity_id) && EntityId.isChest(it.source.entity_id)).map(it => it.source.entity_id.id));
    for (const inserter of inserters) {
        if (EntityId.isMachine(inserter.source.entity_id) && chests_taken_from.has(inserter.sink.entity_id.id)) sinks.add(inserter.sink.entity_id.id);
    }
    // a chain: a machine or a chest that something takes from is itself filled
    const chained = inserters.some(it => EntityId.isMachine(it.sink.entity_id) && sinks.has(it.source.entity_id.id));
    for (const inserter of inserters) {
        const { source, sink } = inserter;
        if (EntityId.isMachine(sink.entity_id)) {
            if (!EntityId.isMachine(source.entity_id) && !EntityId.isChest(source.entity_id) && !(chained && EntityId.isBelt(source.entity_id))) {
                refuse(`${inserter.entity_id.id} takes from ${source.entity_id.id}, not from a machine${chained ? ", a chest or a belt" : " or a chest"}`);
            }
            const carried = transfers.get(inserter.entity_id.id)?.item_transfers ?? [];
            if (carried.length === 0 || (!chained && carried.length !== 1)) refuse(`${inserter.entity_id.id} carries ${carried.length} items`);
            const machine = entity_registry.getEntityByIdOrThrow(sink.entity_id) as Machine;
            const cycle = inserter.animation.total.ticks;
            let count = 0;
            let items = 0;
            let more_room_than_a_hand_over = false;
            for (const item of carried) {
                const input = machine.getInsertableInput(item.item_name);
                if (input === undefined) refuse(`${sink.entity_id.id} has no input for ${item.item_name}`);
                const hands = wholeHands(item.transfer_count.toDecimal(), recipe_lcm);
                // outside a chain the hands must be whole as planned; a chain rounds them up (rule F)
                if (!chained && Math.abs(item.transfer_count.toDecimal() * recipe_lcm - hands) > 1e-9) {
                    refuse(`${inserter.entity_id.id} moves ${item.transfer_count.toDecimal() * recipe_lcm} hands a period, not a whole number`);
                }
                const hand = Math.min(handSizeFor(inserter, item.item_name), input.automated_insertion_limit.quantity);
                const room = SwingDistribution.computeMaxSwingsPerSubCycle({
                    automated_insertion_limit: input.automated_insertion_limit.quantity,
                    consumption_rate_per_tick: input.consumption_rate.rate_per_tick,
                    stack_size: inserter.metadata.stack_size,
                    animation_total_ticks: cycle,
                });
                if (hands > room) refuse(`${hands} hands of ${inserter.entity_id.id} do not follow each other under the limit of ${sink.entity_id.id} (${room} do)`);
                if (room > hands + 1) more_room_than_a_hand_over = true;
                count += hands;
                items += hands * hand;
            }
            const starts = options.surplus_guard && more_room_than_a_hand_over && !EntityId.isBelt(source.entity_id) ? count : count + 1;
            const slack = EntityId.isBelt(source.entity_id) ? belt_slack.get(inserter.entity_id.id) ?? 0 : 0;
            takers.push({ inserter, source: source.entity_id, sink: sink.entity_id, items, window_ticks: (starts - 1) * cycle + WINDOW_MARGIN_TICKS + slack });
        } else if (EntityId.isMachine(source.entity_id) && EntityId.isChest(sink.entity_id) && chests_taken_from.has(sink.entity_id.id)) {
            // it takes what the machine made, and the chest takes every hand: one swing more than the hands, and the draw is not tested
            const carried = transfers.get(inserter.entity_id.id)?.item_transfers ?? [];
            if (carried.length === 0) refuse(`${inserter.entity_id.id} carries nothing in the plan`);
            const hands = carried.reduce((sum, item) => sum + wholeHands(item.transfer_count.toDecimal(), recipe_lcm), 0);
            takers.push({ inserter, source: source.entity_id, sink: sink.entity_id, items: 0, drain: true,
                window_ticks: hands * inserter.animation.total.ticks + WINDOW_MARGIN_TICKS });
        } else {
            if (!sinks.has(source.entity_id.id)) refuse(`${inserter.entity_id.id} takes ${source.entity_id.id}, which nothing is put into, to ${sink.entity_id.id}`);
            if (!EntityId.isBelt(sink.entity_id) && !EntityId.isChest(sink.entity_id)) refuse(`${inserter.entity_id.id} puts into ${sink.entity_id.id}`);
            if (outputHands(inserter) !== 1 && !chained) refuse(`${inserter.entity_id.id} moves ${outputHands(inserter)} hands a period, not one`);
            outputs.push(inserter);
        }
    }
    if (takers.length === 0 || outputs.length === 0) refuse("the build has no input hands or no output hands");
    const output_ticks = (output: Inserter): number => {
        const hands = outputHands(output);
        return hands === 1 ? 1 : hands * output.animation.total.ticks + 1;
    };
    // an inserter whose hands (rounded up) take the whole period, or all but the offset of its window, is busy all the time: a window
    // would only put gaps between hands that follow each other, so it is left enabled
    const open_all_period = (taker: Taker): boolean => taker.window_ticks + INPUT_OFFSET_TICKS >= period;
    const gated = takers.filter(it => !open_all_period(it));
    if (gated.length === 0) refuse(`every taker is busy the whole period of ${period} ticks`);
    const longest = Math.max(...gated.map(it => it.window_ticks));
    const leaveOpen = (made: Map<string, OpenRange[]>): Pick<GroupedHandsPlan, "windows" | "busy"> => {
        const busy = takers.filter(open_all_period).map(taker => taker.inserter.entity_id.id);
        for (const id of busy) made.delete(id);
        return { windows: made, busy };
    };

    // the machines, in the order of their ids, and the fewest groups every source can serve
    const machines = Array.from(sinks).sort((a, b) => Number(a.split(":")[1]) - Number(b.split(":")[1]));
    const sources = new Map<string, { machine: Machine | null; draws: Map<string, number> }>();
    for (const taker of takers.filter(it => it.drain !== true)) {
        const known = sources.get(taker.source.id) ?? { machine: EntityId.isMachine(taker.source)
            ? entity_registry.getEntityByIdOrThrow(taker.source) as Machine : null, draws: new Map<string, number>() };
        known.draws.set(taker.sink.id, (known.draws.get(taker.sink.id) ?? 0) + taker.items);
        sources.set(taker.source.id, known);
    }
    /** Which group a machine is in, by the order the machines are dealt out in (round robin, or in blocks of neighbours) */
    const assignment = (order: string[], groups: number, blocks: boolean): Map<string, number> =>
        new Map(order.map((machine, index) => [machine, blocks ? Math.floor(index * groups / order.length) : index % groups] as const));
    const fits = (groups: number, group_of: ReadonlyMap<string, number> = assignment(machines, groups, false)): boolean =>
        Array.from(sources.values()).every(source => {
            if (source.machine === null) return true;
            const available = source.machine.output.outputBlock.held_limit + source.machine.output.production_rate.amount_per_tick.toDecimal() * longest;
            const drawn = new Array<number>(groups).fill(0);
            machines.forEach(machine => { drawn[group_of.get(machine)!] += source.draws.get(machine) ?? 0; });
            return drawn.every(it => it <= available);
        });
    // the draw against what a source holds and makes in a window is the rule for sources that only give; a source that is
    // filled in turn (a chain) is placed in one group, and the clock-only check and the shifted runs judge it
    let groups = 1;
    while (!chained && groups <= machines.length && !fits(groups)) groups++;
    if (groups > machines.length) refuse("a source cannot serve even one machine at a time");

    // Machines dealt out round robin in the order of their ids serve the sources as well as machines dealt out in the order
    // of the belt they drop on, so where the output inserters stand on a shared belt the grouping is chosen by what lands
    // on what: the dealings that serve every source are compared by the pairs of hands that land on each other, and the
    // first with the fewest wins (the round robin by ids on a tie). This is arithmetic on the places, no run of the build.
    let group_of = assignment(machines, groups, false);
    if (groups > 1 && !chained && drop_tie_break !== null) {
        const place_of = (machine: string): { line: number; along: number } => {
            const places = outputs.filter(it => it.source.entity_id.id === machine).map(it => drop_tie_break.places.get(it.entity_id.number));
            return places.find(it => it !== undefined) ?? { line: Infinity, along: 0 };
        };
        const on_the_belt = [...machines].sort((a, b) => {
            const [left, right] = [place_of(a), place_of(b)];
            return left.line - right.line || left.along - right.along || machines.indexOf(a) - machines.indexOf(b);
        });
        const collisions = (dealt: ReadonlyMap<string, number>): number => {
            const starts = new Map<number, number[]>();
            for (const output of outputs) {
                const start = Math.round(dealt.get(output.source.entity_id.id)! * period / groups);
                starts.set(output.entity_id.number, [...(starts.get(output.entity_id.number) ?? []), start]);
            }
            return drop_tie_break.collisions(starts);
        };
        let fewest = collisions(group_of);
        for (const blocks of [false, true]) {
            const dealt = assignment(on_the_belt, groups, blocks);
            if (fewest === 0 || !fits(groups, dealt)) continue;
            const pairs = collisions(dealt);
            if (pairs < fewest) { fewest = pairs; group_of = dealt; }
        }
    }

    const windows = new Map<string, OpenRange[]>();
    if (chained) {
        if (drills.length > 0) refuse("a chain of machines with drills");
        // from the output: the output windows, the inputs of the output machines from belts, chests and the machines that
        // nothing fills, then those from machines that are filled, each stage when the one before ends
        const output_machines = new Set(outputs.map(it => it.source.entity_id.id));
        for (const output of outputs) windows.set(output.entity_id.id, windowFrom(0, output_ticks(output), period));
        const top = takers.filter(it => output_machines.has(it.sink.id));
        const filled = (taker: Taker): boolean => sinks.has(taker.source.id);
        // the first inputs open as the output's last hand starts, as in a build of one hand
        let next = Math.max(...outputs.map(it => (outputHands(it) - 1) * it.animation.total.ticks)) + INPUT_OFFSET_TICKS;
        for (const stage of [top.filter(it => !filled(it)), top.filter(filled)]) {
            if (stage.length === 0) continue;
            for (const taker of stage) windows.set(taker.inserter.entity_id.id, windowFrom(next, taker.window_ticks, period));
            next += Math.max(...stage.map(it => it.window_ticks));
        }
        const placed = (taker: Taker): boolean => windows.has(taker.inserter.entity_id.id);
        const startOf = (taker: Taker): number => windows.get(taker.inserter.entity_id.id)![0].start_inclusive;
        // the inserters that fill a machine a tick after the one that takes from it, and so on down the chain
        const feed = (taker: Taker, depth: number): void => {
            if (depth > takers.length) refuse("the chain of machines loops");
            for (const feeder of takers.filter(it => it.sink.id === taker.source.id)) {
                windows.set(feeder.inserter.entity_id.id, windowFrom(startOf(taker) + options.feeder_offset, feeder.window_ticks, period));
                feed(feeder, depth + 1);
            }
        };
        for (const taker of top.filter(filled)) feed(taker, 0);
        const unplaced = takers.find(it => !placed(it));
        if (unplaced !== undefined) refuse(`${unplaced.inserter.entity_id.id} fills ${unplaced.sink.id}, which is neither an output machine nor taken from`);
        if (options.share_windows) sharedWindows(windows, gated, period);
        return { ...leaveOpen(windows), turns: [] };
    }
    const start_of = (machine: string): number => Math.round(group_of.get(machine)! * period / groups);
    for (const taker of takers) {
        windows.set(taker.inserter.entity_id.id, windowFrom(start_of(taker.sink.id) + INPUT_OFFSET_TICKS, taker.window_ticks, period));
    }
    for (const output of outputs) {
        windows.set(output.entity_id.id, windowFrom(start_of(output.source.entity_id.id), output_ticks(output), period));
    }
    if (options.share_windows) sharedWindows(windows, gated, period);
    // a drill's window is computed from what its machine takes of it, and the drills of one group have one window: the longest
    const drill_ticks = new Map<number, number>();
    for (const drill of drills) {
        const transfer = transfers.get(drill.entity_id.id);
        if (transfer === undefined) refuse(`${drill.entity_id.id} is not in the plan's hand counts`);
        const sink = entity_registry.getEntityByIdOrThrow(drill.sink_id) as Machine;
        const mined = transfer.item_transfers.reduce((sum, item) => sum + item.transfer_count.toDecimal(), 0) * recipe_lcm * DRILL_ITEMS_PER_SWING;
        const group = group_of.get(drill.sink_id.id)!;
        drill_ticks.set(group, Math.max(drill_ticks.get(group) ?? 0, drillWindowTicks(drill, sink, mined)));
    }
    for (const drill of drills) {
        windows.set(drill.entity_id.id, windowFrom(start_of(drill.sink_id.id) + INPUT_OFFSET_TICKS, drill_ticks.get(group_of.get(drill.sink_id.id)!)!, period));
    }
    // each group's turn begins with its output swings; then its inputs, then its drills, each by entity number. The inserters left
    // enabled all the time are named as well: a window that one of them is given later stands in its group
    const byNumber = (a: { entity_id: EntityId }, b: { entity_id: EntityId }) => a.entity_id.number - b.entity_id.number;
    const turns: TurnGroup[] = groups === 1 ? [] : Array.from({ length: groups }, (_, group) => ({
        start: Math.round(group * period / groups),
        entity_ids: [
            ...outputs.filter(it => group_of.get(it.source.entity_id.id) === group).sort(byNumber),
            ...takers.map(it => it.inserter).filter(it => group_of.get(it.sink.entity_id.id) === group).sort(byNumber),
            ...drills.filter(it => group_of.get(it.sink_id.id) === group).sort(byNumber),
        ].map(it => it.entity_id.id),
    }));
    return { ...leaveOpen(windows), turns };
}

/**
 * Whether the clock holds, and still holds when every group of windows (the inserters and drills that have the same
 * windows) is moved a tick either way with the others where they are: one run of the build on each, from the cold start.
 * A clock that holds at one placement and not next to it is not offered (working rule 3). The reason it is not, or null.
 */
function holdsWithMargin(plan: PlanRun, windows: Map<string, OpenRange[]>, period: number): string | null {
    if (!runClockOnBuild(plan.config, windows, period, plan.logger).stability_check.holds) return "the windows do not hold";
    const groups = new Map<string, string[]>();
    for (const [id, ranges] of windows) {
        const key = ranges.map(range => `${range.start_inclusive}-${range.end_inclusive}`).join(",");
        groups.set(key, [...(groups.get(key) ?? []), id]);
    }
    for (const [key, ids] of groups) {
        for (const ticks of [-MARGIN_SHIFT_TICKS, MARGIN_SHIFT_TICKS]) {
            const moved = new Map(windows);
            for (const id of ids) moved.set(id, shiftedWindows(windows.get(id)!, ticks, period));
            if (!runClockOnBuild(plan.config, moved, period, plan.logger).stability_check.holds) {
                return `the windows ${key} (${ids.join(", ")}) do not hold ${ticks > 0 ? "+" : ""}${ticks} tick`;
            }
        }
    }
    return null;
}

/**
 * The ways the windows are placed: a window for every start the limit refuses, or for the hands only where a surplus hand
 * would be kept; each with the feeders of a chain staged or compact. Each is the only one that holds on some build. A tie
 * in the ranking of their clocks goes to the first in this order.
 */
const SEPARATE_TRIES: GroupedHandsOptions[] = FEEDER_OFFSETS_TICKS.flatMap(feeder_offset =>
    [false, true].map(surplus_guard => ({ surplus_guard, feeder_offset, share_windows: false })));

/** The same ways with the windows of the takers that open together made one */
const SHARED_TRIES: GroupedHandsOptions[] = SEPARATE_TRIES.map(way => ({ ...way, share_windows: true }));

/** A way of placing the windows whose clock holds with its margin and from every start phase */
interface HoldingWay {
    way: GroupedHandsOptions;
    clock: BlueprintGenerationResult;
}

/**
 * Of the clocks of the ways that hold, the one the selection ranks first (`combineClockAlternativeRuns`): one that gets
 * back from every backpressure loss, then one whose losses could not be tried, then the others; among those the fewest
 * wake-ups a minute, then the fewest windows, then the first tried. The losses are tried in that order, and only until
 * one gets back. On a build with a deadlock risk they do not decide (`rankingOf`) and are not tried. Shared windows are
 * kept only where they get back or could not be tried: null where none is.
 */
function bestHolding(made: PlanRun, holding: HoldingWay[], shared: boolean): HoldingWay | null {
    const entity_registry = made.run.simulation_context.entity_registry;
    const inserters = entity_registry.getAll().filter(Entity.isInserter);
    const rank = ({ clock }: HoldingWay): [number, number] => {
        const wake_ups = clock.stability_check.as_built?.wake_ups?.wake_ups_per_minute;
        const windows = inserters.reduce((sum, inserter) => sum + (clock.clock_windows[inserter.entity_id.id]?.length ?? 0), 0);
        // to a thousandth, as the selection counts them
        return [wake_ups === undefined ? Number.MAX_SAFE_INTEGER : Math.round(wake_ups * 1000), rankingWindowCount(windows, clock.clock_windows, clock.loop_windows)];
    };
    const ranked = holding.map((held, index) => ({ held, index, rank: rank(held) }))
        .sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1] || a.index - b.index)
        .map(it => it.held);
    if (!shared && sharedItemDeadlockRisks(entity_registry).length > 0) return ranked[0] ?? null;
    let untried: HoldingWay | null = null;
    for (const held of ranked) {
        const { backpressure_loss } = backpressureLossVerdictOf(made.config, held.clock, made.logger);
        if (backpressure_loss?.survives === true) return held;
        if (backpressure_loss === null) untried ??= held;
    }
    return untried ?? (shared ? null : ranked[0] ?? null);
}

/** How a way is named in the planning log */
function wayName(way: GroupedHandsOptions): string {
    return `${way.feeder_offset === FEEDER_OFFSETS_TICKS[0] ? "staged" : "compact"}${way.surplus_guard ? " with the surplus guard" : ""}`;
}

/**
 * The clock of the windows as the generator exports it, checked as a clock with windows of its own is (the clock-only runs
 * from the start phases and the long run): it holds when that check does
 */
function finishedClock(
    made: PlanRun,
    windows: Map<string, OpenRange[]>,
    turns: TurnGroup[],
    options: GenerateClockOptions,
    /** The takers busy the whole period, which the windows leave out */
    left_open: ReadonlyMap<string, AlwaysOnReason>,
): BlueprintGenerationResult {
    // the windows carry the belt pickup slack themselves (on a moving belt); the clock names the belt they are made for
    const exported = clockOfPlan(made, { ...options, belt_pickup_slack: "always" });
    const slack = beltPickupSlackTicks(made.run.simulation_context.entity_registry);
    const belt_fed = Array.from(windows.keys()).filter(id => slack.has(id));
    const moving = made.config.overrides?.backed_up_belts !== true;
    const belt: ClockBelt | null = belt_fed.length === 0 ? null
        : moving ? { kind: "moving", slack_ticks: Array.from(new Set(belt_fed.map(id => slack.get(id)!))).sort((a, b) => a - b) } : { kind: "backed_up" };
    const named = { ...exported, belt, belt_pickup_slack_left_out: false, turns,
        applied_belt_pickup_slack: moving ? Object.fromEntries(belt_fed.map(id => [id, slack.get(id)!])) : {} };
    const result = checkedClock(made, named, windows, { ...options, verify_as_built: true }, { left_open });
    // the check of the plan's run is the same object for every clock made from the plan, and the next clock's check
    // overwrites it: this clock keeps a copy of its own
    return { ...result, stability_check: { ...result.stability_check, holds: result.stability_check.as_built?.holds ?? false } };
}

/**
 * The clock of a plan with the windows of groupedHandsWindows, checked as a clock with windows of its own is: by the
 * clock-only runs from the start phases and the long run, and by the margin of `holdsWithMargin`. The plan is made again
 * for the cycles of `groupedHandsCycles` where those are not its own and the config does not set them. The windows are
 * made in every way of SEPARATE_TRIES, or of SHARED_TRIES where `options.shared_windows` asks for the windows to be
 * shared (those that make the same windows are one), and of those that hold with their margin and from every start
 * phase the clock is the one `bestHolding` ranks first; where none holds from every start, the first that holds with its
 * margin. Null where the rule does not apply to the build. It holds when its own windows hold, not when the planning run
 * of the plan does.
 */
export function groupedHandsClock(
    plan: PlanRun,
    options: GenerateClockOptions = {},
): BlueprintGenerationResult | null {
    let made = plan;
    let finished: BlueprintGenerationResult | null = null;
    const holding: HoldingWay[] = [];
    const reasons: string[] = [];
    try {
        if (plan.run.always_enabled_by_config.size > 0 || plan.run.inserter_clocks.size > 0 || alwaysEnabledInserters(plan.run.simulation_context.entity_registry).length > 0) {
            refuse("the build has inserters outside the plan");
        }
        const cycles = groupedHandsCycles(plan.run.simulation_context.entity_registry, plan.run.swing_counts);
        if (cycles !== null && plan.config.overrides?.lcm === undefined && cycles !== plan.run.recipe_lcm) {
            made = planRun({ ...plan.config, overrides: { ...plan.config.overrides, lcm: cycles } }, options);
        }
        const { simulation_context, swing_counts, recipe_lcm, duration } = made.run;
        const tried = new Set<string>();
        const drops = dropTieBreak(made.config, duration.ticks);
        for (const way of options.shared_windows === true ? SHARED_TRIES : SEPARATE_TRIES) {
            const { windows, turns, busy } = groupedHandsPlan(simulation_context.entity_registry, swing_counts, recipe_lcm, duration.ticks,
                made.config.overrides?.backed_up_belts !== true, way, drops);
            const left_open = new Map<string, AlwaysOnReason>(busy.map(id => [id, { kind: "busy", period_ticks: duration.ticks }]));
            const key = JSON.stringify(Array.from(windows, ([id, ranges]) => [id, ranges.map(range => [range.start_inclusive, range.end_inclusive])]));
            if (tried.has(key)) continue;
            tried.add(key);
            const unmoved = holdsWithMargin(made, windows, duration.ticks);
            if (unmoved !== null) { reasons.push(unmoved); continue; }
            // the margin runs start from the cold start only: the clock has to hold from the other start phases too
            const clock_of_windows = finishedClock(made, windows, turns, options, left_open);
            if (clock_of_windows.stability_check.holds) { holding.push({ way, clock: clock_of_windows }); continue; }
            reasons.push(`the ${way.share_windows ? "shared " : ""}windows ${key} do not hold from every start`);
            // shared windows are kept only if they hold
            if (!way.share_windows) finished ??= clock_of_windows;
        }
        if (holding.length > 0) {
            const best = bestHolding(made, holding, options.shared_windows === true);
            plan.logger.log(`Grouped hands: ${holding.map(it => `${wayName(it.way)} holds at ${it.clock.stability_check.as_built?.wake_ups?.wake_ups_per_minute ?? "?"} wake-ups a minute`).join(", ")}; `
                + (best === null ? "none gets back from every loss" : `kept ${wayName(best.way)}`));
            finished = best?.clock ?? finished;
            if (finished === null) reasons.push("no shared windows that hold get back from every loss");
        }
        if (finished === null) refuse(reasons.join("; "));
    } catch (error) {
        if (error instanceof GroupedHandsNotApplicable) {
            plan.logger.log(`Grouped hands do not apply: ${error.message}`);
            return null;
        }
        throw error;
    }
    return { ...finished!, grouped_hands: { shared_windows: options.shared_windows === true } };
}
