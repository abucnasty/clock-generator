import { subtickClockForWindowCycle, windowCycleTicks, type WindowCycle } from "../common/subtick-window-cycle";
import { EnableControlRange } from "../config/schema";
import { OpenRange } from "../data-types";
import { Entity, handSizeFor, ReadableEntityRegistry } from "../entities";
import { pickupLaneLength } from "../common/belt-pickup-layout";
import { backpressureHandGrabTicks } from "../state/backpressure-pickup-lane";
import { CIRCUIT_LATENCY_TICKS } from "../common/rule-constants";
import { stacksOf } from "../entities/traits/timing";
import { isDeadEnd } from "../entities/traits/lane-facts";



export type SerializableClockWindows = Record<string, { start: number; end: number }[]>;


export function rotateRanges(ranges: OpenRange[], offset: number, window_cycle_ticks: number): OpenRange[] {
    // the simulated clock position (tick % window cycle) is fractional for a fractional window cycle
    const last_position = Number.isInteger(window_cycle_ticks) ? window_cycle_ticks - 1 : window_cycle_ticks;
    const rotated: OpenRange[] = [];
    for (const range of ranges) {
        const start = (range.start_inclusive + offset) % window_cycle_ticks;
        const end = start + (range.end_inclusive - range.start_inclusive);
        if (end >= window_cycle_ticks) {
            rotated.push(OpenRange.from(start, last_position));
            rotated.push(OpenRange.from(0, end - window_cycle_ticks));
        } else {
            rotated.push(OpenRange.from(start, end));
        }
    }
    return rotated;
}


export { subtickClockForWindowCycle as subtickClockForWindowCycle } from "../common/subtick-window-cycle";

/**
 * Ticks added to the end of each window of an inserter that takes fuel for its machine off a belt as well as an
 * ingredient: the ticks a hand of fuel takes to fill, at one belt stack a tick.
 *
 * When the fuel slot takes a hand does not repeat with the clock: it falls below its limit at any tick of any window,
 * and the inserter takes fuel before it takes what the window is planned for. A window ends where the last planned
 * hand is back from its drop. A hand of fuel ahead of it takes its fill, its swing, its drop and its swing back, so the
 * last planned hand is full that much later: later than the window ends by the fill of the fuel hand. Without the
 * room the window closes on a partly filled hand, and an inserter that holds an ingredient takes no fuel
 * (agricultural science in the game: 377 of 400 a window cycle).
 *
 * It is not given to every such inserter: the ticks can also let a hand in that the plan does not have. A clock gets
 * it when it does not hold the expected output without (see withFuelHandRoomWhereNeeded).
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
 * Ticks added to the end of each window of an inserter that takes fuel for its machine off a belt as well as an
 * ingredient, with the fuel on the lane nearest to it, on top of its room for one more hand (laneHandRoomTicks): room for
 * the hand that a hand of fuel delays. Its hand cycle, less the tick a window stays open after its last planned hand is
 * full, less the room for one more hand: 6 for a hand cycle of 11 and a room of 4.
 *
 * An empty hand takes the near lane's item whenever the machine takes it, so with the fuel there a hand of fuel comes
 * whenever the fuel slot has room, and the planned hand comes a whole hand cycle later. A window that ends 1 tick after
 * the planned last hand is full, plus the room for one more hand, closes on that hand before it fills. With this room
 * such a window ends where the delayed hand is full, a hand cycle after the planned last hand, and closes before the
 * arm is back for a hand after it. The ticks are the same on every window of the inserter, whatever its end already
 * holds. Absent where the room for one more hand already fills the hand cycle, and for an inserter whose near
 * lane carries the ingredient: its hand of fuel waits behind the planned hands.
 */
export function delayedHandRoomTicks(entity_registry: ReadableEntityRegistry): Map<string, number> {
    const lane_hand_room = laneHandRoomTicks(entity_registry);
    const room = new Map<string, number>();
    for (const id of fuelHandRoomTicks(entity_registry).keys()) {
        const lane_room = lane_hand_room.get(id);
        const inserter = entity_registry.getAll().find(entity => entity.entity_id.id === id);
        if (lane_room === undefined || inserter === undefined || !Entity.isInserter(inserter) || inserter.near_lane === undefined) {
            continue;
        }
        const source = entity_registry.getEntityByIdOrThrow(inserter.source.entity_id);
        const sink = entity_registry.getEntityByIdOrThrow(inserter.sink.entity_id);
        if (!Entity.isBelt(source) || !Entity.isMachine(sink) || source.lanes[inserter.near_lane - 1]?.ingredient_name !== sink.fuel_slot?.fuel.item_name) {
            continue;
        }
        const ticks = inserter.animation.total.ticks - 1 - lane_room;
        if (ticks > 0) {
            room.set(id, ticks);
        }
    }
    return room;
}

/**
 * The ticks added to each window of an inserter that takes fuel for its machine off a belt as well as an ingredient,
 * where a clock is made again for its fuel (see withFuelHandRoomWhereNeeded): room for a hand of fuel where its windows
 * get no room for one more hand (fuelHandRoomTicks), which holds the fuel's hand already where they do; and where they
 * do and the fuel is on its near lane, room for the hand the fuel delays (delayedHandRoomTicks). Empty for a build with
 * neither.
 */
export function fuelRoomTicks(entity_registry: ReadableEntityRegistry): Map<string, number> {
    const lane_hand_room = laneHandRoomTicks(entity_registry);
    return new Map([
        ...Array.from(fuelHandRoomTicks(entity_registry)).filter(([id]) => !lane_hand_room.has(id)),
        ...delayedHandRoomTicks(entity_registry),
    ]);
}

/**
 * Ticks added to the end of each window of an inserter that picks up from a belt: room for one more hand, the ticks that
 * hand takes to fill at one lane stack a tick (4 for a hand of 16 from stacks of 4). A takeover upstream or a gap passing
 * the pickup can start a hand later than in the planning run, and a window without the room closes on a partly filled
 * hand. The hand is the one it moves of each item it takes, and the lane whose fill takes longest sets the ticks. The
 * end of the lane changes nothing: a dead end gets the room as a lane that flows on does (on a lane with backpressure it
 * comes after the ticks a hand takes from the lanes at rest, see backpressureHandTicks). Absent for an inserter that
 * does not take from a belt.
 *
 * Absent as well for a side pickup (a pickup with no layout named is one, on a straight belt) that takes an item both
 * lanes of its belt carry: its hand takes from the lane nearest it first and from the far lane when the near one gives
 * nothing (BeltHandPickup), so the far lane gives the hand what a gap on the near lane withholds. A pickup of any other
 * layout, and a side pickup of an item on one lane only, keeps the room.
 */
export function laneHandRoomTicks(entity_registry: ReadableEntityRegistry): Map<string, number> {
    const room = new Map<string, number>();
    for (const entity of entity_registry.getAll()) {
        if (!Entity.isInserter(entity) || entity.belt_lane_facts === undefined) {
            continue;
        }
        const source = entity_registry.getEntityByIdOrThrow(entity.source.entity_id);
        if (!Entity.isBelt(source)) {
            continue;
        }
        const taken = source.lanes.filter(lane => entity.filtered_items.has(lane.ingredient_name));
        const side_pickup = (entity.pickup_layout ?? "side-straight").startsWith("side-");
        if (side_pickup && taken.length === 2 && taken[0].ingredient_name === taken[1].ingredient_name) {
            continue;
        }
        // the lanes of the items it takes; of a belt none of whose items it takes, every lane (its nominal hand)
        const lanes = taken.length > 0 ? taken : source.lanes;
        room.set(entity.entity_id.id, Math.max(...lanes.map(lane => stacksOf(handSizeFor(entity, lane.ingredient_name), lane.stack_size))));
    }
    return room;
}

/**
 * The ticks a hand off a lane with backpressure takes to fill from the lanes at rest, by belt-fed inserter id, where the belt
 * refills its pickup slower than a lane stack a tick: the pickup exposes fewer stacks than a hand takes, and the belt
 * brings the rest into reach at its speed (`backpressureHandGrabTicks`). A window read off the planning run is as long as
 * the hand took there, which is shorter where that hand had started before the window or had waited for its machine
 * while the belt refilled. Absent for a moving supply and where the belt gives a stack a tick (turbo and express on an
 * underground end, every tier on a straight belt with four-item stacks).
 */
export function backpressureHandTicks(entity_registry: ReadableEntityRegistry): Map<string, number> {
    const hand_ticks = new Map<string, number>();
    for (const entity of entity_registry.getAll()) {
        // a hand waits at rest only where every lane it may take from ends in a dead end
        if (!Entity.isInserter(entity) || entity.belt_lane_facts?.every(isDeadEnd) !== true) {
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
            const grabs = backpressureHandGrabTicks(source.belt_speed, lanes, handSizeFor(entity, item));
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

/**
 * The step between two positions of a window cycle's clock: a tick, or 1/q tick on a p/q-tick window cycle with a subtick
 * clock. Null for a fractional window cycle with no subtick clock, whose windows are left as they are.
 */
export function positionStep(window_cycle: WindowCycle): number | null {
    const window_cycle_ticks = windowCycleTicks(window_cycle);
    if (typeof window_cycle === "number" ? Number.isInteger(window_cycle) : window_cycle.denominator === 1) {
        return 1;
    }
    const subtick = subtickClockForWindowCycle(window_cycle_ticks, typeof window_cycle === "number" ? undefined : window_cycle);
    return subtick === null ? null : 1 / subtick.scale;
}

/** The last position a window can end on without running past the end of the window cycle */
export function lastPosition(window_cycle: WindowCycle): number {
    const window_cycle_ticks = windowCycleTicks(window_cycle);
    const step = positionStep(window_cycle);
    return step === null ? window_cycle_ticks : window_cycle_ticks - step;
}

/**
 * The ticks a window covers. On a p/q-tick window cycle a window [s, e] is open in the whole ticks whose position, in steps
 * of 1/q, is in it (enable-control.ts, SubtickPositions): its (e - s) q + 1 positions cover the same number of ticks in
 * every window cycle only when it is a whole number of ticks long, and one tick fewer otherwise in every window cycle
 * but the one that starts on a whole tick. This is the most it covers: e - s + 1 for a window read off whole ticks, and
 * the ticks of a window made in positions (`windowOfTicks`), so reading a window again gives the same.
 */
export function windowTicks(range: OpenRange, window_cycle: WindowCycle): number {
    const step = positionStep(window_cycle);
    if (step === null || step === 1) {
        return range.end_inclusive - range.start_inclusive + 1;
    }
    const positions = Math.round((range.end_inclusive - range.start_inclusive) / step) + 1;
    return Math.ceil(positions * step - 1e-9);
}

/**
 * A window of `ticks` ticks from `start`, open for that many ticks in every window cycle: on a p/q-tick window cycle its
 * q * ticks positions, the last 1/q tick before start + ticks. Not carried over the end of the window cycle.
 */
export function windowOfTicks(start: number, ticks: number, window_cycle: WindowCycle): OpenRange {
    const step = positionStep(window_cycle) ?? 1;
    return OpenRange.from(start, start + ticks - step);
}

/**
 * A p/q-tick window cycle's windows as whole windows: the start of each and the ticks it covers (`windowTicks`), where a
 * window carried over the end of the window cycle (one to its last position and one from 0) is one window
 */
function windowsOf(ranges: readonly OpenRange[], window_cycle: WindowCycle, step: number): { start: number; ticks: number; wraps: boolean }[] {
    const window_cycle_ticks = windowCycleTicks(window_cycle);
    const sorted = [...ranges].sort((a, b) => a.start_inclusive - b.start_inclusive);
    const last = sorted[sorted.length - 1];
    const wraps = sorted.length > 1 && sorted[0].start_inclusive === 0 && last.end_inclusive >= window_cycle_ticks - step - 1e-9;
    const windows = (wraps ? sorted.slice(1, -1) : sorted)
        .map(range => ({ start: range.start_inclusive, ticks: windowTicks(range, window_cycle), wraps: false }));
    if (wraps) {
        // the positions from the last window's start to the end of the window cycle, then from 0 to the first's end
        const positions = Math.round((window_cycle_ticks - last.start_inclusive) / step) + Math.round(sorted[0].end_inclusive / step) + 1;
        windows.push({ start: last.start_inclusive, ticks: Math.ceil(positions * step - 1e-9), wraps: true });
    }
    return windows;
}

/**
 * The windows, by key, each made again with the ticks `ticksOf` gives it (from the ticks it covers), so that it covers
 * them in every window cycle of a p/q-tick window cycle. A window up to the end of the window cycle stops at its last
 * position unless `carry_over`; the end carries it over to the start otherwise, and a window that was carried over
 * already stays so.
 */
function withWindowTicks(
    ranges: readonly OpenRange[],
    window_cycle: WindowCycle,
    step: number,
    ticksOf: (ticks: number) => number,
    carry_over: boolean,
): OpenRange[] {
    const window_cycle_ticks = windowCycleTicks(window_cycle);
    const most = Math.floor(window_cycle_ticks + 1e-9);
    const made = windowsOf(ranges, window_cycle, step).flatMap(window => {
        const ticks = Math.min(ticksOf(window.ticks), most);
        const range = windowOfTicks(0, ticks, window_cycle);
        if (carry_over || window.wraps) {
            return rotateRanges([range], window.start, window_cycle_ticks);
        }
        return [OpenRange.from(window.start, Math.min(window.start + range.end_inclusive, window_cycle_ticks - step))];
    });
    return OpenRange.reduceRanges(made, step);
}

/**
 * A p/q-tick window cycle's windows each made again with the ticks `ticksOf` gives it, covering them in every window
 * cycle, a window up to the end of the window cycle stopping at its last position (a padding). The windows as they are
 * on any other window cycle.
 */
export function withWindowTicksUpToTheEnd(ranges: OpenRange[], window_cycle: WindowCycle, ticksOf: (ticks: number) => number): OpenRange[] {
    const step = positionStep(window_cycle);
    return step === null || step === 1 || ranges.length === 0 ? ranges : withWindowTicks(ranges, window_cycle, step, ticksOf, false);
}

/**
 * The windows with each one made in the positions of its window cycle's clock, as long as it is (`windowTicks`), so that
 * on a p/q-tick window cycle a window read off whole ticks covers that many in every window cycle. The windows as they
 * are on a whole-tick window cycle, and on a fractional one with no subtick clock.
 */
export function withWindowsKeepingLength(windows: Map<string, OpenRange[]>, window_cycle: WindowCycle): Map<string, OpenRange[]> {
    const step = positionStep(window_cycle);
    if (step === null || step === 1) {
        return windows;
    }
    return new Map(Array.from(windows, ([key, ranges]) => [key, ranges.length === 0 ? ranges
        : withWindowTicks(ranges, window_cycle, step, ticks => ticks, false)]));
}

/**
 * Windows that last at least the ticks given, by key: a shorter window is lengthened at its end. On a p/q-tick window
 * cycle every window of such a key covers its ticks in every window cycle (`windowTicks`); a fractional window cycle with
 * no subtick clock keeps its windows.
 */
export function withWindowsAtLeast(
    windows: Map<string, OpenRange[]>,
    least_ticks: ReadonlyMap<string, number>,
    window_cycle: WindowCycle,
): Map<string, OpenRange[]> {
    const window_cycle_ticks = windowCycleTicks(window_cycle);
    const result = new Map<string, OpenRange[]>();
    const step = positionStep(window_cycle);
    for (const [key, ranges] of windows) {
        const ticks = least_ticks.get(key) ?? 0;
        if (ticks === 0 || step === null || ranges.every(r => windowTicks(r, window_cycle) >= ticks)) {
            result.set(key, ranges);
            continue;
        }
        if (step !== 1) {
            result.set(key, withWindowTicks(ranges, window_cycle, step, length => Math.max(length, ticks), true));
            continue;
        }
        const lengthened = ranges.flatMap(r => {
            const length = Math.min(Math.max(r.end_inclusive - r.start_inclusive, ticks - 1), window_cycle_ticks - 1);
            return rotateRanges([OpenRange.from(0, length)], r.start_inclusive, window_cycle_ticks);
        });
        result.set(key, OpenRange.reduceRanges(lengthened));
    }
    return result;
}

/**
 * Windows lengthened at their end by the ticks given, by key. On a p/q-tick window cycle a lengthened window covers its
 * ticks (`windowTicks`) and the ticks added in every window cycle; a fractional window cycle with no subtick clock keeps
 * its windows.
 */
export function withWindowsLengthened(
    windows: Map<string, OpenRange[]>,
    ticks_by_key: ReadonlyMap<string, number>,
    window_cycle: WindowCycle,
): Map<string, OpenRange[]> {
    const window_cycle_ticks = windowCycleTicks(window_cycle);
    const result = new Map<string, OpenRange[]>();
    const step = positionStep(window_cycle);
    for (const [key, ranges] of windows) {
        const ticks = ticks_by_key.get(key) ?? 0;
        if (ticks === 0 || step === null) {
            result.set(key, ranges);
            continue;
        }
        if (step !== 1) {
            result.set(key, ranges.length === 0 ? ranges : withWindowTicks(ranges, window_cycle, step, length => length + ticks, true));
            continue;
        }
        const extended = ranges.flatMap(r => {
            const length = Math.min(r.end_inclusive - r.start_inclusive + ticks, window_cycle_ticks - 1);
            return rotateRanges([OpenRange.from(0, length)], r.start_inclusive, window_cycle_ticks);
        });
        result.set(key, OpenRange.reduceRanges(extended));
    }
    return result;
}


export function shiftRangesForCircuitLatency(ranges: OpenRange[], window_cycle_ticks: number): EnableControlRange[] {
    const shifted: EnableControlRange[] = [];
    for (const range of ranges) {
        let start = range.start_inclusive + CIRCUIT_LATENCY_TICKS;
        let end = range.end_inclusive + CIRCUIT_LATENCY_TICKS;
        if (start >= window_cycle_ticks) {
            start -= window_cycle_ticks;
            end -= window_cycle_ticks;
        }
        if (end >= window_cycle_ticks) {
            shifted.push({ start, end: Number.isInteger(window_cycle_ticks) ? window_cycle_ticks - 1 : window_cycle_ticks });
            shifted.push({ start: 0, end: end - window_cycle_ticks });
        } else {
            shifted.push({ start, end });
        }
    }
    return shifted;
}

/**
 * The belt supply a clock is designed for. Moving pickups time reachable stacks; supply with backpressure refills reachable
 * stacks at belt speed, and its windows last as long as a hand takes from the lanes at rest (see backpressureHandTicks).
 * How long a pickup from a moving lane takes is the simulation's: a window gets no ticks beyond those of the plan.
 */
export type ClockBelt =
    /** Some input lane of the build is not a dead end */
    | { kind: "moving" }
    /** Every input lane is a dead end: its belt-fed inserters have the windows they need on a belt with backpressure */
    | { kind: "backed_up" };

/** "moving" or "backed-up"; empty when no inserter with windows picks up from a belt */
export function clockBeltLabel(belt: ClockBelt | null): string {
    if (belt === null) {
        return "";
    }
    return belt.kind === "backed_up" ? "backed-up" : "moving";
}
