import { Duration, OpenRange } from "../../data-types";
import { Belt, Entity, handSizeFor, Inserter, Machine, ReadableEntityRegistry } from "../../entities";

/** Ticks added to the end of a window, so a late pickup from a busy belt or a machine still fills the hand */
const WINDOW_SLACK_TICKS = 4;

/**
 * An inserter that is not part of the transfer plan is enabled by a window that repeats every `modulus` ticks, a
 * divisor of the clock period, so the clock of the period holds a whole number of repeats. Its machine's inventory is
 * only looked at inside the window: the rest of the time the inserter ignores it.
 *
 * - "fuel": fills the fuel slot of a burner machine
 * - "by-product": takes a by-product, which no machine in the config uses, off its machine
 */
export interface InserterClock {
    inserter_id: string;
    kind: "fuel" | "by-product";
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

/**
 * An inserter that only takes by-products no machine in the config uses just clears them out of the machine,
 * whatever it puts them on. Nothing in the chain depends on its rate, so it is not part of the plan.
 */
export function isByProductOnlyInserter(entity_registry: ReadableEntityRegistry, inserter: Inserter): boolean {
    const source = entity_registry.getEntityById(inserter.source.entity_id);
    if (!source || !Entity.isMachine(source) || inserter.filtered_items.size === 0) {
        return false;
    }
    const machines = entity_registry.getAll().filter(Entity.isMachine);
    const by_products = new Set(source.outputs.slice(1).map(it => it.item_name));
    return Array.from(inserter.filtered_items).every(item_name =>
        by_products.has(item_name) && !machines.some(machine => machine.inputs.has(item_name))
    );
}

export function byProductOnlyInserters(entity_registry: ReadableEntityRegistry): Inserter[] {
    return entity_registry.getAll().filter(Entity.isInserter).filter(inserter => isByProductOnlyInserter(entity_registry, inserter));
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

/** Ticks it takes to fill a hand at the pickup: a belt gives a lane stack a tick, a machine or a chest is the pickup animation */
function pickupTicks(inserter: Inserter, entity_registry: ReadableEntityRegistry, item_name: string): number {
    const source = entity_registry.getEntityById(inserter.source.entity_id);
    const hand = handSizeFor(inserter, item_name);
    if (source !== null && Entity.isBelt(source)) {
        const lane_stack_size = (source as Belt).lanes.find(lane => lane.ingredient_name === item_name)?.stack_size;
        return lane_stack_size ? Math.ceil(hand / lane_stack_size) : inserter.animation.pickup.ticks;
    }
    return inserter.animation.pickup.ticks;
}

/** The clock of an inserter that repeats every at most `interval_ticks`, which `index` staggers from the others on the same machine */
function clockEvery(
    inserter: Inserter,
    kind: InserterClock["kind"],
    interval_ticks: number,
    pickup_ticks: number,
    period_ticks: number,
    index: number,
    cannot_keep_up: () => string,
): InserterClock {
    const swing_ticks = inserter.animation.total.ticks + 1;
    const modulus = largestDivisorAtMost(period_ticks, interval_ticks, swing_ticks);
    if (modulus === null) {
        throw new Error(
            `Inserter ${inserter.entity_id.id.replace("inserter:", "")} cannot keep up: ${cannot_keep_up()} lasts ${interval_ticks} ticks `
            + `and a swing takes ${swing_ticks}`
            + (interval_ticks >= swing_ticks ? ` (and no divisor of the ${period_ticks} tick clock fits between them)` : "")
            + ". Add another inserter or raise its stack size."
        );
    }

    const window_ticks = Math.min(pickup_ticks + WINDOW_SLACK_TICKS, modulus);
    const stagger = index * (window_ticks + 1);
    const start = stagger + window_ticks <= modulus ? stagger : 0;
    return {
        inserter_id: inserter.entity_id.id,
        kind,
        modulus,
        window: OpenRange.from(start, start + window_ticks - 1),
    };
}

/**
 * The fuel clock of an inserter, for a clock of `period_ticks`. The fuel slot stops a swing once it holds its limit,
 * so at a window the slot has either the limit, or gets a hand. Either way it holds at least the limit (or the hand,
 * if that is less), which lasts the machine `items / burn rate` ticks while it crafts. The window repeats at least that
 * often, so the slot never runs dry; a window more often than needed only lets the slot fill sooner.
 *
 * `index` staggers the windows of the inserters that fill the same machine, so they do not all start on the same tick.
 */
export function fuelClockFor(
    inserter: Inserter,
    machine: Machine,
    entity_registry: ReadableEntityRegistry,
    period_ticks: number,
    index: number = 0,
): InserterClock {
    const consumption = machine.fuel_consumption;
    const slot = machine.fuel_slot;
    if (!consumption || !slot) {
        throw new Error(`${machine} does not burn fuel`);
    }

    const hand = handSizeFor(inserter, slot.fuel.item_name);
    const items_in_slot_at_a_window = Math.min(hand, slot.automated_insertion_limit);
    const burn_interval_ticks = Math.floor(items_in_slot_at_a_window / consumption.rate_per_tick);
    return clockEvery(
        inserter, "fuel", burn_interval_ticks, pickupTicks(inserter, entity_registry, slot.fuel.item_name), period_ticks, index,
        () => `${items_in_slot_at_a_window} ${slot.fuel.item_name} in the fuel slot of ${machine.entity_id.id}`,
    );
}

/**
 * The clock of an inserter that takes by-products off a machine. The machine makes `rate` of a by-product a tick, and
 * the window repeats often enough for two things:
 *
 * - a hand of it builds up in `hand / rate` ticks, which the window repeats within, so everything the machine made is taken;
 * - the machine never holds more than the stack size allows, or it is blocked until the next window. The hand takes
 *   what is there when the window opens, but the machine can still hold what it did not take, and a by-product made by
 *   chance (a probability per craft) comes in streaks, so only the room the stack has over a hand is counted on: the
 *   window repeats within `(stack size - hand) / rate` ticks.
 *
 * The window is short: the inserter checks the machine's output only there, picks up what is ready, and swings once its
 * hand is full. When no divisor of the clock period fits the stack's room, the hand's interval is used instead.
 */
export function byProductClockFor(
    inserter: Inserter,
    machine: Machine,
    entity_registry: ReadableEntityRegistry,
    period_ticks: number,
    index: number = 0,
): InserterClock {
    const by_products = machine.outputs.slice(1).filter(output => inserter.filtered_items.has(output.item_name));
    if (by_products.length === 0) {
        throw new Error(`${inserter.entity_id.id} does not take a by-product of ${machine.entity_id.id}`);
    }
    const swing_ticks = inserter.animation.total.ticks + 1;
    // the item that fills first sets how often the inserter has to look
    const limits = by_products.map(output => {
        const hand = handSizeFor(inserter, output.item_name);
        const rate = output.production_rate.amount_per_tick.toDecimal();
        const room_over_a_hand = Math.max(output.outputBlock.max_stack_size - hand, 1);
        return {
            output,
            hand_ticks: Math.floor(hand / rate),
            stack_ticks: Math.floor(room_over_a_hand / rate),
        };
    });
    const soonest = (key: "hand_ticks" | "stack_ticks") =>
        limits.reduce((first, next) => next[key] < first[key] ? next : first);

    // a divisor that keeps the stack clear if there is one, else one that at least takes a hand as it builds up
    const for_stack = soonest("stack_ticks");
    const stack_fits = largestDivisorAtMost(period_ticks, for_stack.stack_ticks, swing_ticks) !== null;
    const chosen = stack_fits ? for_stack : soonest("hand_ticks");
    const interval_ticks = stack_fits ? chosen.stack_ticks : chosen.hand_ticks;
    return clockEvery(
        inserter, "by-product", interval_ticks,
        pickupTicks(inserter, entity_registry, chosen.output.item_name), period_ticks, index,
        () => `a hand of ${chosen.output.item_name} the machine makes`,
    );
}

/** The clock of every inserter outside the plan that has one, keyed by inserter id */
export function unplannedInserterClocks(entity_registry: ReadableEntityRegistry, period_ticks: number): Map<string, InserterClock> {
    const clocks = new Map<string, InserterClock>();
    const used_per_machine = new Map<string, number>();
    const nextIndex = (machine: Machine) => {
        const index = used_per_machine.get(machine.entity_id.id) ?? 0;
        used_per_machine.set(machine.entity_id.id, index + 1);
        return index;
    };

    for (const inserter of fuelOnlyInserters(entity_registry)) {
        const machine = entity_registry.getEntityByIdOrThrow(inserter.sink.entity_id);
        if (Entity.isMachine(machine)) {
            clocks.set(inserter.entity_id.id, fuelClockFor(inserter, machine, entity_registry, period_ticks, nextIndex(machine)));
        }
    }
    for (const inserter of byProductOnlyInserters(entity_registry)) {
        const machine = entity_registry.getEntityByIdOrThrow(inserter.source.entity_id);
        if (Entity.isMachine(machine)) {
            clocks.set(inserter.entity_id.id, byProductClockFor(inserter, machine, entity_registry, period_ticks, nextIndex(machine)));
        }
    }
    return clocks;
}

/** The windows of a clock repeated over a clock period */
export function clockWindowsOverPeriod(clock: InserterClock, period_ticks: number): OpenRange[] {
    const windows: OpenRange[] = [];
    for (let start = 0; start < period_ticks; start += clock.modulus) {
        windows.push(OpenRange.from(start + clock.window.start_inclusive, start + clock.window.end_inclusive));
    }
    return windows;
}

export function clockPeriod(clock: InserterClock): Duration {
    return Duration.ofTicks(clock.modulus);
}
