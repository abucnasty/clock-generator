import { EnableControlRange } from "../config/schema";
import { OpenRange } from "../data-types";
import { Entity, handSizeFor, ReadableEntityRegistry } from "../entities";
import { SubtickClock } from "./blueprint";
import { withFuelHandRoomWhereNeeded } from "./alternatives";

/**
 * Ticks between the clock reaching a value and an inserter acting on its decider (combinator output, then the
 * inserter reading it). An inserter acts in every tick of its window this much later, the first one included.
 */
export const CIRCUIT_LATENCY_TICKS = 2;


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
        room.set(entity.entity_id.id, Math.ceil(handSizeFor(entity, fuel_item) / lane.stack_size));
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
        const ticks = Math.ceil(entity.metadata.stack_size / lane_stack_size);
        slack.set(entity.entity_id.id, Math.min(ticks, MAX_BELT_PICKUP_SLACK_TICKS));
    }
    return slack;
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
 * The belt a clock is made for. The simulator's belts are always full and do not move; an inserter changes its tick
 * timing on a moving belt, and more so on one with gaps (see "Wake-ups, the measure for goal 2" in GOALS.md).
 */
export type ClockBelt =
    /** Belt pickup slack lengthened the windows of its belt-fed inserters, by these ticks (each value once, ascending) */
    | { kind: "moving"; slack_ticks: number[] }
    /** Its belt-fed inserters have the windows they need on a belt that does not move */
    | { kind: "non_moving" };

/** "moving (+4 ticks)" or "non-moving"; empty when no inserter with windows picks up from a belt */
export function clockBeltLabel(belt: ClockBelt | null): string {
    if (belt === null) {
        return "";
    }
    if (belt.kind === "non_moving") {
        return "non-moving";
    }
    const [first, last] = [belt.slack_ticks[0], belt.slack_ticks[belt.slack_ticks.length - 1]];
    return `moving (+${first === last ? first : `${first}–${last}`} tick${last === 1 ? "" : "s"})`;
}
