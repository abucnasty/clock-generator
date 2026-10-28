import { Entity, ReadableEntityRegistry } from "../entities";
import { loopInserters } from "./sequence/unplanned-inserter-clock";

/**
 * Wake-ups from more than one start (GOALS.md, goal 2; docs/wake-ups.md, "Wake-ups from more than one start").
 *
 * A build on a fixed clock can settle into more than one steady state, and which one it settles into depends on how it
 * starts: where its clock stands when its machines start empty, and, for a loop, what the loop holds. Each start
 * settles for good, and the wake-ups of the steady states differ: on the iron bacteria sample with one window a period
 * on its loop inserters 317 to 907 a minute by start, the same from each start over 180,000 ticks. The figure of the
 * cold start alone is then one of several, and a clock that is lowest from it need not be lowest from the others.
 *
 * On a build that holds a stock its clock does not set (a loop of machines, or a machine that makes its own
 * ingredient) a clock is ranked by the mean of its wake-ups over a fixed set of starts: the config's cold start with
 * the clock standing at START_PLACES evenly spaced places in its period, the places the as-built check starts it from
 * (`startPlaces`), the cold start itself the first. The loop is seeded as the config says (`overrides.loop_seed_items`)
 * from every start: the seed moves the mean (iron bacteria with one window a period: 495 a minute over every place at a
 * seed of 200, 670 at 50), so it is part of the build the config describes, not a start to average over. Every other
 * build keeps the one figure of its cold start, for now (docs/wake-ups.md says why).
 */

/** How many places in its period the clock is started from, the cold start included */
export const START_PLACES = 12;

/** The wake-ups of a clock from each start of the set, and their mean, which the clock is ranked by */
export interface WakeUpsFromStarts {
    /** Ticks into its period the clock stands at for each start, the cold start (0) first */
    places: number[];
    /** Wake-ups a minute, summed over the inserters of one copy, from each start, in the order of `places` */
    wake_ups_per_minute: number[];
    /** Their mean */
    mean: number;
}

/**
 * The places in its period a clock is started from: START_PLACES evenly spaced, in whole ticks of a whole period, the
 * steps of the as-built check's start phases (`runAsBuiltCheck`); a short period has fewer.
 */
export function startPlaces(period: number): number[] {
    const step = Math.max(1, Math.floor(period / START_PLACES));
    const places: number[] = [];
    for (let place = 0; place < period && places.length < START_PLACES; place += step) {
        places.push(place);
    }
    return places;
}

/**
 * Whether the build holds a stock its clock does not set: machines that feed each other in a loop, or a machine that
 * makes its own ingredient. What such a stock holds when the build has settled depends on what it held at the start,
 * so the wake-ups of every clock of the build are taken from all the starts.
 */
export function hasStockTheClockDoesNotSet(entity_registry: Pick<ReadableEntityRegistry, "getAll">): boolean {
    return loopInserters(entity_registry).length > 0
        || entity_registry.getAll().filter(Entity.isMachine).some(machine => machine.self_ingredients.size > 0);
}

/**
 * The wake-ups of a clock from every start of the set. `figureAt` gives the wake-ups a minute from the start at a place
 * (ticks into the period), or null where it cannot (no long run): the clock then keeps its one figure, as it does where
 * its period has fewer than two places.
 */
export function wakeUpsFromStarts(period: number, figureAt: (place: number) => number | null): WakeUpsFromStarts | null {
    const places = startPlaces(period);
    if (places.length < 2) {
        return null;
    }
    const wake_ups_per_minute: number[] = [];
    for (const place of places) {
        const figure = figureAt(place);
        if (figure === null) return null;
        wake_ups_per_minute.push(figure);
    }
    return { places, wake_ups_per_minute, mean: wake_ups_per_minute.reduce((sum, figure) => sum + figure, 0) / wake_ups_per_minute.length };
}
