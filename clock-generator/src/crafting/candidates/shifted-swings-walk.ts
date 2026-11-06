import { OpenRange } from "../../data-types";
import { Entity, handSizeFor, Inserter, Machine, ReadableEntityRegistry } from "../../entities";
import { FactorioDataService } from "../../data/factorio-data-service";
import { machineFactsOfEntity } from "../../entities/traits/machine-facts-of";
import { rotateRanges } from "../clock";
import { CraftingCyclePlan } from "../sequence/cycle/crafting-cycle";
import { alwaysEnabledInserters, byProductOnlyInserters, fuelOnlyInserters } from "../sequence/unplanned-inserter-clock";
import { StockWalk, WalkHand, WalkSwing, walkMachineStock } from "../plan/stock-walk";

/**
 * Shifted swings by arithmetic: whether a clock of shifted windows holds, from the stock walk of each machine
 * (plan/stock-walk.ts) and no run of the build. A shift moves one crafting cycle's swings; whether the machines still
 * get their hands in time is a set of stock inequalities (an input hand dropped before the stock it tops up runs out,
 * picked up under the insertion limit, an output hand taken full before the output reaches its block), and their values
 * come from the stock the shifted clock settles into, not from the planned clock's. So each shift is walked to its
 * fixed point, from each start phase the clock-only check starts the clock at (the state it reaches from there), and it
 * holds where every inserter moves its planned hands a period in every one of those walks.
 *
 * The walk is of one machine with its sources ready. Only builds where that is the build are walked: every inserter
 * that fills a machine takes from a belt or a chest the build does not fill, every machine's results go out through
 * inserters of the plan, and nothing else is clocked or left always enabled. Any other build is refused
 * (`ShiftWalkNotApplicable`) and the search decides.
 */

/** Why the stock walk does not decide shifts on a build: the search does */
export class ShiftWalkNotApplicable extends Error { }

function refuse(reason: string): never {
    throw new ShiftWalkNotApplicable(reason);
}

/** One machine with the inserters at it, as the walk takes them, and the hands of the plan */
interface WalkedMachine {
    id: string;
    facts: ReturnType<typeof machineFactsOfEntity>;
    fillers: WalkHand[];
    takers: WalkHand[];
}

/** A build that the stock walk decides shifts on (see `shiftWalkModelOf`) */
export interface ShiftWalkModel {
    period: number;
    machines: WalkedMachine[];
    /** Hands each inserter moves a period in the plan, by entity id */
    hands_per_period: ReadonlyMap<string, number>;
}

/** The swing of an inserter in the stock walk: the pickup off a belt takes a lane stack a tick (as batched-arithmetic.ts) */
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

/**
 * The machines of a build as the walk takes them, with the hands of the plan; throws `ShiftWalkNotApplicable` for a
 * build the walk of one machine with its sources ready is not (see the module comment).
 */
export function shiftWalkModelOf(registry: ReadableEntityRegistry, plan: CraftingCyclePlan, period: number, cycles: number,
    /** MEASURE ONLY: walk machines fed by machines apart, each source taken as ready */
    apart = false): ShiftWalkModel {
    if (!Number.isInteger(period)) refuse(`a period of ${period} ticks is not whole`);
    if (plan.fractional_swings_enabled) refuse("fractional swings");
    if (plan.result_windows !== undefined) refuse("results that come by chance");
    if (plan.production_rate.counts !== "made") refuse("a target that counts an item destroyed");
    const entities = registry.getAll();
    if (entities.some(Entity.isDrill)) refuse("a build with drills");
    if (alwaysEnabledInserters(registry).length > 0) refuse("a build with inserters left always enabled");
    if (fuelOnlyInserters(registry).length > 0 || byProductOnlyInserters(registry).length > 0) refuse("a build with inserters outside the plan");
    const transfers = new Map(Array.from(plan.entity_transfer_map.entries(), ([id, transfer]) => [id.id, transfer] as const));
    const inserters = entities.filter(Entity.isInserter);
    const hands_per_period = new Map<string, number>();
    for (const inserter of inserters) {
        const id = inserter.entity_id.id;
        const transfer = transfers.get(id);
        if (transfer === undefined) refuse(`${id} has no hands in the plan`);
        const hands = transfer.total_transfer_count.getNumerator * cycles / transfer.total_transfer_count.getDenominator;
        if (!Number.isInteger(hands)) refuse(`${id} moves ${hands} hands a period`);
        hands_per_period.set(id, hands);
        const source = registry.getEntityByIdOrThrow(inserter.source.entity_id);
        const sink = registry.getEntityByIdOrThrow(inserter.sink.entity_id);
        if (!apart && !Entity.isMachine(source) && !Entity.isMachine(sink)) refuse(`${id} moves between no machines`);
        // the walk of a machine takes its fillers' sources to have a hand ready: only a belt or a chest nothing fills
        if (!apart && Entity.isMachine(sink) && Entity.isMachine(source)) refuse(`${id} takes from a machine into a machine`);
        if (!apart && Entity.isChest(source) && entities.some(it => Entity.isInserter(it) && it.sink.entity_id.id === source.entity_id.id)) {
            refuse(`${id} takes from a chest the build fills`);
        }
    }
    const machines = entities.filter(Entity.isMachine).map((machine: Machine): WalkedMachine => {
        if (machine.outputs.length > 1) refuse(`${machine.entity_id.id} makes more than one result`);
        if (machine.result_target !== undefined) refuse(`${machine.entity_id.id} places its results itself`);
        if (machine.fuel_slot !== undefined) refuse(`${machine.entity_id.id} burns fuel`);
        const facts = machineFactsOfEntity(machine);
        const takers = inserters.filter(it => it.source.entity_id.id === machine.entity_id.id).map((taker): WalkHand => ({
            id: taker.entity_id.id, items: [facts.output_item], hand: handSizeFor(taker, facts.output_item), swing: swingOf(taker, registry),
        }));
        if (takers.length === 0) refuse(`nothing takes from ${machine.entity_id.id}`);
        const fillers = inserters.filter(it => it.sink.entity_id.id === machine.entity_id.id).map((filler): WalkHand => {
            const source = registry.getEntityByIdOrThrow(filler.source.entity_id);
            const items = Array.from(filler.filtered_items).filter(item => facts.inputs.some(input => input.item_name === item));
            if (items.length === 0) refuse(`${filler.entity_id.id} brings nothing ${machine.entity_id.id} takes`);
            const ordered = Entity.isChest(source)
                ? [...items].sort((a, b) => FactorioDataService.itemInventoryRankOrThrow(b) - FactorioDataService.itemInventoryRankOrThrow(a))
                : items;
            return { id: filler.entity_id.id, items: ordered, pick: Entity.isChest(source) ? "in-order" : "least-cover",
                hand: filler.metadata.stack_size, swing: swingOf(filler, registry) };
        });
        return { id: machine.entity_id.id, facts, fillers, takers };
    });
    return { period, machines, hands_per_period };
}

/** Why a walk of a clock does not hold: the machine, the start shift of the clock and what fell short */
export interface ShiftWalkShortfall {
    machine_id: string;
    start_shift: number;
    reason: string;
}

/** Periods a walk may take before it repeats */
const MAX_WALK_PERIODS = 128;

/** The windows of the hands at a machine, with the clock started `start_shift` ticks into its period, over `periods` periods */
function handsWithWindows(hands: readonly WalkHand[], windows: ReadonlyMap<string, OpenRange[]>, period: number, start_shift: number, periods: number): WalkHand[] {
    return hands.map(hand => {
        const ranges = windows.get(hand.id);
        if (ranges === undefined || ranges.length === 0) return hand;
        const rotated = start_shift === 0 ? ranges : rotateRanges(ranges, start_shift, period);
        return { ...hand, windows: Array.from({ length: periods }, (_, copy) => rotated.map(range =>
            OpenRange.from(range.start_inclusive + copy * period, range.end_inclusive + copy * period))).flat() };
    });
}

/** The walk of a machine on a clock, over as many periods as its fixed point repeats in */
function walkOnClock(machine: WalkedMachine, windows: ReadonlyMap<string, OpenRange[]>, period: number, start_shift: number): { walk: StockWalk; periods: number } {
    let periods = 1;
    for (; ;) {
        const walk = walkMachineStock({
            machine: machine.facts, period_ticks: period * periods, max_periods: MAX_WALK_PERIODS,
            fillers: handsWithWindows(machine.fillers, windows, period, start_shift, periods),
            takers: handsWithWindows(machine.takers, windows, period, start_shift, periods),
        });
        if (!walk.converged || walk.repeat_periods === 1) return { walk, periods };
        periods *= walk.repeat_periods;
    }
}

/**
 * Whether a clock holds by the stock walk: every machine walked to its fixed point from each start shift, every inserter
 * moving its planned hands a period there. The first shortfall found, or null where it holds.
 */
export function shiftWalkShortfall(model: ShiftWalkModel, windows: ReadonlyMap<string, OpenRange[]>, start_shifts: readonly number[]): ShiftWalkShortfall | null {
    for (const start_shift of start_shifts) {
        for (const machine of model.machines) {
            const { walk, periods } = walkOnClock(machine, windows, model.period, start_shift);
            if (!walk.converged) return { machine_id: machine.id, start_shift, reason: "its stock does not repeat" };
            // the check counts what the takers carry out of the machine: a period's items as planned, within an item
            for (const hand of process.env.WALK_ALL_HANDS === "1" ? [...machine.fillers, ...machine.takers] : machine.takers) {
                const moved = walk.hands.filter(it => it.id === hand.id).reduce((sum, it) => sum + it.amount, 0);
                const planned = model.hands_per_period.get(hand.id)! * hand.hand * periods;
                if (Math.abs(moved - planned) > periods) {
                    return { machine_id: machine.id, start_shift, reason: `${hand.id} moves ${moved} items in ${periods} period(s), not ${planned}` };
                }
            }
        }
    }
    return null;
}
