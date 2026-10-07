import { Duration, OpenRange } from "../../data-types";
import { Belt, Entity, handSizeFor, Inserter, Machine, ReadableEntityRegistry } from "../../entities";

/** Ticks added to the end of a window, so a late pickup from a busy belt or a machine still fills the hand */
const WINDOW_SLACK_TICKS = 4;

/**
 * An inserter that is not part of the transfer plan is enabled by a window that repeats every `modulus` ticks. Its
 * machine's inventory is only looked at inside the window: the rest of the time the inserter ignores it.
 *
 * - "fuel": fills the fuel slot of a burner machine. Nothing in the plan depends on when it swings, so it runs on a
 *   clock of its own that counts `modulus` ticks, whatever the clock period is: the fewer windows, the less often the
 *   inserter is woken up to find the fuel slot full.
 * - "by-product": takes a by-product, which no machine in the config uses, off its machine. Its `modulus` is a divisor
 *   of the clock period, so the clock of the period holds a whole number of repeats.
 */
export interface InserterClock {
    inserter_id: string;
    kind: "fuel" | "by-product";
    /** Ticks between the starts of two windows; divides the clock period unless the inserter has a clock of its own */
    modulus: number;
    /** The window is on a clock of its own that counts `modulus` ticks, not on the clock of the period */
    own_clock: boolean;
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

/**
 * The clock of an inserter that repeats every at most `interval_ticks`, which `index` staggers from the others on the
 * same machine. On the clock of the period (`period_ticks`) it repeats every divisor of the period; on a clock of its
 * own (`period_ticks` null) every `interval_ticks`.
 */
function clockEvery(
    inserter: Inserter,
    kind: InserterClock["kind"],
    interval_ticks: number,
    pickup_ticks: number,
    period_ticks: number | null,
    index: number,
    cannot_keep_up: () => string,
): InserterClock {
    const swing_ticks = inserter.animation.total.ticks + 1;
    const modulus = period_ticks === null
        ? (interval_ticks >= swing_ticks ? interval_ticks : null)
        : largestDivisorAtMost(period_ticks, interval_ticks, swing_ticks);
    if (modulus === null) {
        throw new Error(
            `Inserter ${inserter.entity_id.id.replace("inserter:", "")} cannot keep up: ${cannot_keep_up()} lasts ${interval_ticks} ticks `
            + `and a swing takes ${swing_ticks}`
            + (interval_ticks >= swing_ticks && period_ticks !== null ? ` (and no divisor of the ${period_ticks} tick clock fits between them)` : "")
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
        own_clock: period_ticks === null,
        window: OpenRange.from(start, start + window_ticks - 1),
    };
}

/**
 * Fuel is burned while a machine crafts, and a machine burns more than its crafting share predicts: each time it stops
 * and starts it spends most of a tick's fuel without crafting (up to 5.3% more in recordings). The share is counted
 * this much higher.
 */
const CRAFTING_SHARE_MARGIN = 1.1;

/**
 * The fuel clock of an inserter. The fuel slot stops a swing once it holds its limit, so at a window the slot has
 * either the limit, or gets a hand. Either way it holds at least the limit (or the hand, if that is less), which lasts
 * the machine `items / burn rate` ticks of crafting. The window repeats that often, so the slot never runs dry; a
 * window more often than that only wakes the inserter up to find the slot full.
 *
 * `crafting_share` is the part of the time the machine crafts in the plan (1 when it never stops). A machine that
 * crafts 80% of the time burns its fuel 80% as fast, so its slot is looked at that much less often. A machine that
 * crafts more than planned, as it can while a build starts up, may run out of fuel for a few ticks before a window.
 *
 * `index` staggers the windows of the inserters that fill the same machine, so they do not all start on the same tick.
 * With `shared_clock_ticks`, the ticks one clock counts for the period and every fuel clock, the window repeats every
 * divisor of that.
 */
export function fuelClockFor(
    inserter: Inserter,
    machine: Machine,
    entity_registry: ReadableEntityRegistry,
    index: number = 0,
    crafting_share: number = 1,
    shared_clock_ticks: number | null = null,
    measured_interval_ticks?: number,
): InserterClock {
    const slot = machine.fuel_slot;
    if (!machine.fuel_consumption || !slot) {
        throw new Error(`${machine} does not burn fuel`);
    }

    const items_in_slot_at_a_window = Math.min(handSizeFor(inserter, slot.fuel.item_name), slot.automated_insertion_limit);
    const burn_interval_ticks = measured_interval_ticks ?? fuelBurnIntervalTicks(inserter, machine, crafting_share);
    const swing_ticks = inserter.animation.total.ticks + 1;
    // a little more often than the fuel lasts, where that lets one short clock hold every fuel clock
    const interval_ticks = shared_clock_ticks === null
        ? burn_interval_ticks
        : largestDivisorAtMost(shared_clock_ticks, burn_interval_ticks, swing_ticks) ?? burn_interval_ticks;
    return clockEvery(
        inserter, "fuel", interval_ticks, pickupTicks(inserter, entity_registry, slot.fuel.item_name), null, index,
        () => `${items_in_slot_at_a_window} ${slot.fuel.item_name} in the fuel slot of ${machine.entity_id.id}`,
    );
}

/** Ticks the fuel a slot is sure to hold at a window lasts a machine that crafts `crafting_share` of the time */
export function fuelBurnIntervalTicks(inserter: Inserter, machine: Machine, crafting_share: number = 1): number {
    const consumption = machine.fuel_consumption;
    const slot = machine.fuel_slot;
    if (!consumption || !slot) {
        throw new Error(`${machine} does not burn fuel`);
    }
    const items_in_slot_at_a_window = Math.min(handSizeFor(inserter, slot.fuel.item_name), slot.automated_insertion_limit);
    const burning_share = Math.min(1, Math.max(crafting_share, 0) * CRAFTING_SHARE_MARGIN) || 1;
    return Math.floor(items_in_slot_at_a_window / (consumption.rate_per_tick * burning_share));
}

/** Longest the one clock for the period and the fuel clocks is made to count: 10 minutes */
export const MAX_SHARED_FUEL_CLOCK_TICKS = 36_000;

/** How many more enables than the fuel needs are taken for a shorter clock */
export const SHARED_FUEL_CLOCK_TOLERANCE = 1.05;

/**
 * The ticks one clock counts to hold the period and every fuel clock: a few periods, with each fuel clock a divisor of
 * it that is no longer than its fuel lasts. Fuel clocks of exactly the ticks their fuel lasts seldom share a factor
 * with the period or each other, and the clock that holds them all counts for hours (839040 ticks for a period of 128
 * with fuel clocks of 95 and 138). Looking a little more often gives a short one: 1408 ticks holds fuel clocks of 88
 * and 128.
 *
 * It is the fewest periods whose fuel clocks enable no more than `SHARED_FUEL_CLOCK_TOLERANCE` times as often as the
 * fuel needs, or, when no count up to `MAX_SHARED_FUEL_CLOCK_TICKS` does, the one that enables the least. Null when
 * the period is not a whole number of ticks, or no count has a divisor for every fuel clock.
 */
export function sharedFuelClockTicks(
    period_ticks: number,
    fuel_clocks: ReadonlyArray<{ burn_interval_ticks: number; swing_ticks: number }>,
): number | null {
    if (!Number.isInteger(period_ticks) || period_ticks < 1 || fuel_clocks.length === 0) {
        return null;
    }
    const needed = fuel_clocks.reduce((sum, clock) => sum + 1 / clock.burn_interval_ticks, 0);
    let best: { ticks: number; enables: number } | null = null;
    for (let ticks = period_ticks; ticks <= Math.max(period_ticks, MAX_SHARED_FUEL_CLOCK_TICKS); ticks += period_ticks) {
        const moduli = fuel_clocks.map(clock => largestDivisorAtMost(ticks, clock.burn_interval_ticks, clock.swing_ticks));
        if (moduli.some(modulus => modulus === null)) {
            continue;
        }
        const enables = moduli.reduce((sum: number, modulus) => sum + 1 / modulus!, 0);
        if (enables <= needed * SHARED_FUEL_CLOCK_TOLERANCE + 1e-12) {
            return ticks;
        }
        if (best === null || enables < best.enables - 1e-12) {
            best = { ticks, enables };
        }
    }
    return best?.ticks ?? null;
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

/**
 * The clock of every inserter outside the plan that has one, keyed by inserter id. `crafting_shares` is the part of the
 * time each machine crafts in the plan, by machine id; a machine without one is taken to craft all the time.
 * `measured_fuel_intervals` is, by machine id, how many ticks the fuel its slot is filled up to lasted at the least in
 * a run of the build: where it is known, the fuel clock is made from it and not from the crafting share.
 */
export function unplannedInserterClocks(
    entity_registry: ReadableEntityRegistry,
    period_ticks: number,
    crafting_shares: ReadonlyMap<string, number> = new Map(),
    measured_fuel_intervals: ReadonlyMap<string, number> = new Map(),
): Map<string, InserterClock> {
    const clocks = new Map<string, InserterClock>();
    const used_per_machine = new Map<string, number>();
    const nextIndex = (machine: Machine) => {
        const index = used_per_machine.get(machine.entity_id.id) ?? 0;
        used_per_machine.set(machine.entity_id.id, index + 1);
        return index;
    };

    const fuel_inserters = fuelOnlyInserters(entity_registry).flatMap(inserter => {
        const machine = entity_registry.getEntityByIdOrThrow(inserter.sink.entity_id);
        return Entity.isMachine(machine) ? [{ inserter, machine, crafting_share: crafting_shares.get(machine.entity_id.id) ?? 1 }] : [];
    });
    // a hand smaller than the slot's limit is what the slot is sure to hold, which the measured interval is not for
    const measuredInterval = (inserter: Inserter, machine: Machine): number | undefined => {
        const slot = machine.fuel_slot;
        const measured = measured_fuel_intervals.get(machine.entity_id.id);
        return slot && measured !== undefined && handSizeFor(inserter, slot.fuel.item_name) >= slot.automated_insertion_limit
            ? measured
            : undefined;
    };
    const shared_clock_ticks = sharedFuelClockTicks(period_ticks, fuel_inserters.map(({ inserter, machine, crafting_share }) => ({
        burn_interval_ticks: measuredInterval(inserter, machine) ?? fuelBurnIntervalTicks(inserter, machine, crafting_share),
        swing_ticks: inserter.animation.total.ticks + 1,
    })));
    for (const { inserter, machine, crafting_share } of fuel_inserters) {
        clocks.set(inserter.entity_id.id, fuelClockFor(
            inserter, machine, entity_registry, nextIndex(machine), crafting_share, shared_clock_ticks, measuredInterval(inserter, machine),
        ));
    }
    for (const inserter of byProductOnlyInserters(entity_registry)) {
        const machine = entity_registry.getEntityByIdOrThrow(inserter.source.entity_id);
        if (Entity.isMachine(machine)) {
            clocks.set(inserter.entity_id.id, byProductClockFor(inserter, machine, entity_registry, period_ticks, nextIndex(machine)));
        }
    }
    return clocks;
}

/** The windows of a clock repeated over a clock period, for a clock that divides it */
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
