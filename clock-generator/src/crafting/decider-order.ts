import { OpenRange } from "../data-types";
import { Entity, ReadableEntityRegistry } from "../entities";
import { InserterClock } from "./sequence/unplanned-inserter-clock";

/**
 * In what order a check builds the window deciders of a clock: "built", as the clock's blueprint has them, which a
 * build placed in one go and the harness's builds follow; "reversed", the last of them first, as a build whose deciders
 * were put down the other way round (robots build a blueprint in no fixed order).
 */
export type DeciderOrder = "built" | "reversed";

/**
 * Where the window decider of each clocked entity stands in the order the clock's blueprint builds its deciders, 0
 * the first, by entity key ("inserter:3"). In a tick in which the windows of two inserters open together, the game
 * updates the one whose decider was built last first (docs/simulator.md, "When a waiting inserter acts"), so the
 * order decides which of them sees what the other did in that tick.
 *
 * As `createSignalPerInserterBlueprint` builds them: one decider for each set of windows that some entity of the plan
 * has, and for each set of windows and items of the inserters outside it, standing for the first entity with it, in the
 * order of those entities' ids as strings;
 * then one for each window of the fuel inserters on clocks of their own, by modulus and window, their inserters taken
 * in the order of their ids. `windows` are those of `withInserterClocks`, in the order the blueprint's history has
 * them. The blueprint tells the inserters outside the plan with the same windows apart by the items they carry: an
 * inserter's filtered items stand in for them (decider-order.generation.test.ts).
 */
export function deciderBuildOrder(
    windows: ReadonlyMap<string, readonly OpenRange[]>,
    entity_registry: ReadableEntityRegistry,
    inserter_clocks: ReadonlyMap<string, InserterClock> = new Map(),
): Map<string, number> {
    const filters = new Map(entity_registry.getAll().filter(Entity.isInserter)
        .map(inserter => [inserter.entity_id.id, Array.from(inserter.filtered_items).sort().join(",")] as const));
    const representative_of = new Map<string, string>();
    const by_signature = new Map<string, string>();
    for (const [key, ranges] of windows) {
        // the entities of the plan share a decider whatever they carry; one outside it (a by-product inserter) by its items
        const item_name = inserter_clocks.has(key) ? filters.get(key) ?? key : "";
        const signature = ranges.map(range => `${item_name}:${range.start_inclusive}-${range.end_inclusive}`).sort().join("|");
        const representative = by_signature.get(signature) ?? key;
        by_signature.set(signature, representative);
        representative_of.set(key, representative);
    }
    const representatives = Array.from(new Set(representative_of.values())).sort((a, b) => a.localeCompare(b));
    const place_of = new Map(representatives.map((key, place) => [key, place] as const));
    const order = new Map(Array.from(representative_of, ([key, representative]) => [key, place_of.get(representative)!] as const));
    const own_clocks = Array.from(inserter_clocks.values())
        .filter(clock => clock.own_clock)
        .sort((a, b) => a.inserter_id.number - b.inserter_id.number);
    let place = representatives.length;
    for (const modulus of Array.from(new Set(own_clocks.map(clock => clock.modulus))).sort((a, b) => a - b)) {
        const place_of_window = new Map<string, number>();
        for (const clock of own_clocks.filter(it => it.modulus === modulus)) {
            const window = `${clock.window.start_inclusive}-${clock.window.end_inclusive}`;
            if (!place_of_window.has(window)) {
                place_of_window.set(window, place++);
            }
            order.set(clock.inserter_id.id, place_of_window.get(window)!);
        }
    }
    return order;
}


/** The order of `deciderBuildOrder` with the deciders built the other way round: the last built first */
export function reversedDeciderOrder(order: ReadonlyMap<string, number>): Map<string, number> {
    const last = Math.max(-1, ...order.values());
    return new Map(Array.from(order, ([key, place]) => [key, last - place] as const));
}
