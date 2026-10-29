import { EnableControlRange } from "../config/schema";
import { OpenRange } from "../data-types";
import { Entity, handSizeFor, ReadableEntityRegistry } from "../entities";
import { SubtickClock } from "./blueprint";
import { pickupLaneLength } from "../common/belt-pickup-layout";
import { backedUpHandGrabTicks } from "../state/backed-up-pickup-lane";
import { CIRCUIT_LATENCY_TICKS } from "../common/rule-constants";
import { stacksOf } from "../entities/traits/timing";



export type SerializableClockWindows = Record<string, { start: number; end: number }[]>;


export function rotateRanges(ranges: OpenRange[], offset: number, period: number): OpenRange[] {
    // the simulated clock position (tick % period) is fractional for a fractional period
    const last_position = Number.isInteger(period) ? period - 1 : period;
    const rotated: OpenRange[] = [];
    for (const range of ranges) {
        const start = (range.start_inclusive + offset) % period;
        const end = start + (range.end_inclusive - range.start_inclusive);
        if (end >= period) {
            rotated.push(OpenRange.from(start, last_position));
            rotated.push(OpenRange.from(0, end - period));
        } else {
            rotated.push(OpenRange.from(start, end));
        }
    }
    return rotated;
}


const MAX_SUBTICK_SCALE = 1000;

/** A fractional period as p/q ticks with small integers (e.g. 550.9565... = 12672/23), or null */
export function subtickClockForPeriod(period: number): SubtickClock | null {
    if (Number.isInteger(period)) {
        return null;
    }
    for (let q = 2; q <= MAX_SUBTICK_SCALE; q++) {
        const p = Math.round(period * q);
        // the multiply combinator outputs up to p * q, which must fit a 32-bit signal
        if (Math.abs(p / q - period) < 1e-6 && p * q < 2 ** 31) {
            return { period_ticks: p, scale: q };
        }
    }
    return null;
}

/**
 * Ticks added to the end of each window of an inserter that takes fuel for its machine off a belt as well as an
 * ingredient: the ticks a hand of fuel takes to fill, at one belt stack a tick.
 *
 * When the fuel slot takes a hand does not repeat with the clock: it falls below its limit at any tick of any window,
 * and the inserter takes fuel before it takes what the window is planned for. A window ends where the last planned
 * hand is back from its drop. A hand of fuel ahead of it takes its fill, its swing, its drop and its swing back, so the
 * last planned hand is full that much later: later than the window ends by the fill of the fuel hand. Without the
 * room the window closes on a partly filled hand, and an inserter that holds an ingredient takes no fuel
 * (agricultural science in the game: 377 of 400 a period).
 *
 * It is not given to every such inserter: the ticks can also let a hand in that the plan does not have. A clock gets
 * it when it does not hold the expected output without (see withFuelHandRoomWhereNeeded). Belt pickup slack is as long.
 */
export function fuelHandRoomTicks(entity_registry: ReadableEntityRegistry): Map<string, number> {
    const room = new Map<string, number>();
    for (const entity of entity_registry.getAll()) {
        if (!Entity.isInserter(entity)) {
            continue;
        }
        const source = entity_registry.getEntityByIdOrThrow(entity.source.entity_id);
        const sink = entity_registry.getEntityById(entity.sink.entity_id);
        if (!Entity.isBelt(source) || sink === null || !Entity.isMachine(sink)) {
            continue;
        }
        const fuel_item = sink.fuel_slot?.fuel.item_name;
        const lane = source.lanes.find(it => it.ingredient_name === fuel_item);
        if (fuel_item === undefined || lane === undefined || !entity.filtered_items.has(fuel_item) || sink.isFuelOnly(entity.filtered_items)) {
            continue;
        }
        // the timing floor's count (one belt stack a tick) of its hand of the fuel, on the first lane that carries it
        room.set(entity.entity_id.id, stacksOf(handSizeFor(entity, fuel_item), lane.stack_size));
    }
    return room;
}

/**
 * Ticks added to the end of each belt-fed inserter's window. In game, a grab from a full belt can stall while a
 * gap left by an upstream inserter passes the pickup point, so the window must outlast a late pickup or the
 * inserter is disabled holding a partial hand. Sized as one more full-hand pickup (one lane stack per tick).
 */
const MAX_BELT_PICKUP_SLACK_TICKS = 16;


export function beltPickupSlackTicks(entity_registry: ReadableEntityRegistry): Map<string, number> {
    const slack = new Map<string, number>();
    for (const entity of entity_registry.getAll()) {
        if (!Entity.isInserter(entity)) {
            continue;
        }
        const source = entity_registry.getEntityByIdOrThrow(entity.source.entity_id);
        if (!Entity.isBelt(source)) {
            continue;
        }
        const lanes = source.lanes.filter(lane => entity.filtered_items.has(lane.ingredient_name));
        const lane_stack_size = Math.min(...(lanes.length > 0 ? lanes : source.lanes).map(lane => lane.stack_size));
        // the timing floor's count (one belt stack a tick) of its nominal hand (P3 2.3: each count keeps the hand it reads)
        const ticks = stacksOf(entity.metadata.stack_size, lane_stack_size);
        slack.set(entity.entity_id.id, Math.min(ticks, MAX_BELT_PICKUP_SLACK_TICKS));
    }
    return slack;
}


/**
 * The ticks a hand off a backed-up belt takes to fill from the lanes at rest, by belt-fed inserter id, where the belt
 * refills its pickup slower than a lane stack a tick: the pickup exposes fewer stacks than a hand takes, and the belt
 * brings the rest into reach at its speed (`backedUpHandGrabTicks`). A window read off the planning run is as long as
 * the hand took there, which is shorter where that hand had started before the window or had waited for its machine
 * while the belt refilled. Absent for moving supply and where the belt gives a stack a tick (turbo and express on an
 * underground end, every tier on a straight belt with four-item stacks).
 */
export function backedUpHandTicks(entity_registry: ReadableEntityRegistry): Map<string, number> {
    const hand_ticks = new Map<string, number>();
    for (const entity of entity_registry.getAll()) {
        if (!Entity.isInserter(entity) || entity.belt_supply !== "backed_up") {
            continue;
        }
        const source = entity_registry.getEntityByIdOrThrow(entity.source.entity_id);
        if (!Entity.isBelt(source)) {
            continue;
        }
        const order = entity.near_lane === 2 ? [1, 0] : [0, 1];
        const layout = entity.pickup_layout ?? "side-straight";
        let ticks = 0;
        for (const item of entity.filtered_items) {
            const lanes = order.filter(index => source.lanes[index]?.ingredient_name === item).map(index => ({
                length_tiles: pickupLaneLength(layout, index + 1, entity.pickup_length ?? 1),
                stack_size: source.lanes[index].stack_size,
            }));
            const grabs = backedUpHandGrabTicks(source.belt_speed, lanes, handSizeFor(entity, item));
            const fill_ticks = grabs.length === 0 ? 0 : grabs[grabs.length - 1] + 1;
            if (fill_ticks > grabs.length) {
                ticks = Math.max(ticks, fill_ticks);
            }
        }
        if (ticks > 0) {
            hand_ticks.set(entity.entity_id.id, ticks);
        }
    }
    return hand_ticks;
}

/** Windows that last at least the ticks given, by key: a shorter window is lengthened at its end (whole-tick periods only) */
export function withWindowsAtLeast(
    windows: Map<string, OpenRange[]>,
    least_ticks: ReadonlyMap<string, number>,
    period: number,
): Map<string, OpenRange[]> {
    const result = new Map<string, OpenRange[]>();
    for (const [key, ranges] of windows) {
        const ticks = least_ticks.get(key) ?? 0;
        if (ticks === 0 || !Number.isInteger(period) || ranges.every(r => r.end_inclusive - r.start_inclusive + 1 >= ticks)) {
            result.set(key, ranges);
            continue;
        }
        const lengthened = ranges.flatMap(r => {
            const length = Math.min(Math.max(r.end_inclusive - r.start_inclusive, ticks - 1), period - 1);
            return rotateRanges([OpenRange.from(0, length)], r.start_inclusive, period);
        });
        result.set(key, OpenRange.reduceRanges(lengthened));
    }
    return result;
}

export function withBeltPickupSlack(
    windows: Map<string, OpenRange[]>,
    slack: Map<string, number>,
    period: number,
): Map<string, OpenRange[]> {
    const result = new Map<string, OpenRange[]>();
    for (const [key, ranges] of windows) {
        const ticks = slack.get(key) ?? 0;
        if (ticks === 0 || !Number.isInteger(period)) {
            result.set(key, ranges);
            continue;
        }
        const extended = ranges.flatMap(r => {
            const length = Math.min(r.end_inclusive - r.start_inclusive + ticks, period - 1);
            return rotateRanges([OpenRange.from(0, length)], r.start_inclusive, period);
        });
        result.set(key, OpenRange.reduceRanges(extended));
    }
    return result;
}


export function shiftRangesForCircuitLatency(ranges: OpenRange[], period: number): EnableControlRange[] {
    const shifted: EnableControlRange[] = [];
    for (const range of ranges) {
        let start = range.start_inclusive + CIRCUIT_LATENCY_TICKS;
        let end = range.end_inclusive + CIRCUIT_LATENCY_TICKS;
        if (start >= period) {
            start -= period;
            end -= period;
        }
        if (end >= period) {
            shifted.push({ start, end: Number.isInteger(period) ? period - 1 : period });
            shifted.push({ start: 0, end: end - period });
        } else {
            shifted.push({ start, end });
        }
    }
    return shifted;
}

/**
 * The belt supply a clock is designed for. Moving pickups time reachable stacks; backed-up supply refills reachable
 * stacks at belt speed, and its windows last as long as a hand takes from the lanes at rest (see backedUpHandTicks).
 * Moving clocks add slack for late pickups (see "Wake-ups, the measure for goal 2" in GOALS.md).
 */
export type ClockBelt =
    /** Belt pickup slack lengthened the windows of its belt-fed inserters, by these ticks (each value once, ascending) */
    | { kind: "moving"; slack_ticks: number[] }
    /** Its belt-fed inserters have the windows they need on a backed-up belt */
    | { kind: "backed_up" };

/** "moving (+4 ticks)" or "backed-up"; empty when no inserter with windows picks up from a belt */
export function clockBeltLabel(belt: ClockBelt | null): string {
    if (belt === null) {
        return "";
    }
    if (belt.kind === "backed_up") {
        return "backed-up";
    }
    const [first, last] = [belt.slack_ticks[0], belt.slack_ticks[belt.slack_ticks.length - 1]];
    return `moving (+${first === last ? first : `${first}–${last}`} tick${last === 1 ? "" : "s"})`;
}
