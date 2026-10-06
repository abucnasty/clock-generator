import { Duration, OpenRange } from "../../data-types";
import { Belt, Entity, handSizeFor, Inserter, Machine, ReadableEntityRegistry } from "../../entities";

/** Ticks added to the end of a fuel window, so a late pickup from a busy belt still fills the hand */
const FUEL_WINDOW_SLACK_TICKS = 4;

/**
 * When an inserter that only fills the fuel slot of a burner machine is enabled. Fuel is not part of the plan, so it
 * does not change the LCM: the inserter gets a window that repeats every `modulus` ticks, a divisor of the clock
 * period, so the clock of the period holds a whole number of repeats.
 */
export interface FuelClock {
    inserter_id: string;
    /** Ticks between the starts of two windows; divides the clock period */
    modulus: number;
    /** The window within the first `modulus` ticks */
    window: OpenRange;
}

export function fuelOnlyInserters(entity_registry: ReadableEntityRegistry): Inserter[] {
    return entity_registry.getAll().filter(Entity.isInserter).filter(inserter => {
        const sink = entity_registry.getEntityById(inserter.sink.entity_id);
        return sink !== null && Entity.isMachine(sink) && sink.isFuelOnly(inserter.filtered_items);
    });
}

/** The largest divisor of `period` that is at most `limit`, or null when there is none of at least `minimum` */
export function largestDivisorAtMost(period: number, limit: number, minimum: number = 1): number | null {
    for (let divisor = Math.min(Math.floor(limit), period); divisor >= Math.max(minimum, 1); divisor--) {
        if (period % divisor === 0) {
            return divisor;
        }
    }
    return null;
}

/**
 * The fuel clock of an inserter, for a clock of `period_ticks`. The fuel slot stops a swing once it holds its limit,
 * so at a window the slot has either the limit, or gets a hand. Either way it holds at least the limit (or the hand,
 * if that is less), which lasts the machine `items / burn rate` ticks while it crafts. The window repeats at least that
 * often, so the slot never runs dry; a window more often than needed only lets the slot fill sooner.
 *
 * `index` staggers the windows of the fuel inserters that share a belt, so they do not all start on the same tick.
 */
export function fuelClockFor(
    inserter: Inserter,
    machine: Machine,
    entity_registry: ReadableEntityRegistry,
    period_ticks: number,
    index: number = 0,
): FuelClock {
    const consumption = machine.fuel_consumption;
    const slot = machine.fuel_slot;
    if (!consumption || !slot) {
        throw new Error(`${machine} does not burn fuel`);
    }

    const hand = handSizeFor(inserter, slot.fuel.item_name);
    const items_in_slot_at_a_window = Math.min(hand, slot.automated_insertion_limit);
    const burn_interval_ticks = Math.floor(items_in_slot_at_a_window / consumption.rate_per_tick);
    const swing_ticks = inserter.animation.total.ticks + 1;

    const modulus = largestDivisorAtMost(period_ticks, burn_interval_ticks, swing_ticks);
    if (modulus === null) {
        throw new Error(
            `Inserter ${inserter.entity_id.id.replace("inserter:", "")} cannot keep ${machine.entity_id.id} fuelled: `
            + `${items_in_slot_at_a_window} ${slot.fuel.item_name} last it ${burn_interval_ticks} ticks while it crafts, `
            + `and a swing takes ${swing_ticks}`
            + (burn_interval_ticks >= swing_ticks ? ` (and no divisor of the ${period_ticks} tick clock fits between them)` : "")
            + `. Add another fuel inserter or raise its stack size.`
        );
    }

    const window_ticks = Math.min(pickupTicks(inserter, entity_registry, slot.fuel.item_name) + FUEL_WINDOW_SLACK_TICKS, modulus);
    const stagger = index * (window_ticks + 1);
    const start = stagger + window_ticks <= modulus ? stagger : 0;
    return {
        inserter_id: inserter.entity_id.id,
        modulus,
        window: OpenRange.from(start, start + window_ticks - 1),
    };
}

/** Ticks it takes to fill a hand: a belt gives a lane stack a tick */
function pickupTicks(inserter: Inserter, entity_registry: ReadableEntityRegistry, item_name: string): number {
    const source = entity_registry.getEntityById(inserter.source.entity_id);
    const hand = handSizeFor(inserter, item_name);
    if (source !== null && Entity.isBelt(source)) {
        const lane_stack_size = (source as Belt).lanes.find(lane => lane.ingredient_name === item_name)?.stack_size;
        return lane_stack_size ? Math.ceil(hand / lane_stack_size) : inserter.animation.pickup.ticks;
    }
    return inserter.animation.pickup.ticks;
}

/** The clock of every fuel-only inserter, keyed by inserter id */
export function fuelClocks(entity_registry: ReadableEntityRegistry, period_ticks: number): Map<string, FuelClock> {
    const clocks = new Map<string, FuelClock>();
    const used_per_machine = new Map<string, number>();
    for (const inserter of fuelOnlyInserters(entity_registry)) {
        const machine = entity_registry.getEntityByIdOrThrow(inserter.sink.entity_id);
        if (!Entity.isMachine(machine)) {
            continue;
        }
        const index = used_per_machine.get(machine.entity_id.id) ?? 0;
        used_per_machine.set(machine.entity_id.id, index + 1);
        clocks.set(inserter.entity_id.id, fuelClockFor(inserter, machine, entity_registry, period_ticks, index));
    }
    return clocks;
}

/** The windows of a fuel clock repeated over a clock period */
export function fuelWindowsOverPeriod(clock: FuelClock, period_ticks: number): OpenRange[] {
    const windows: OpenRange[] = [];
    for (let start = 0; start < period_ticks; start += clock.modulus) {
        windows.push(OpenRange.from(start + clock.window.start_inclusive, start + clock.window.end_inclusive));
    }
    return windows;
}

export function fuelClockPeriod(clock: FuelClock): Duration {
    return Duration.ofTicks(clock.modulus);
}
