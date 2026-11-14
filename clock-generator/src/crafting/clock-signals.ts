import { FactorioBlueprint } from "../blueprints/blueprint";
import { EntityId } from "../entities";
import type { ChestDrillClock } from "./chest-drill-windows";
import type { InserterCounters } from "./inserter-counters";

/**
 * The signals a clock sends in a minute, beside its wake-ups (GOALS.md, goal 2): the activation signals of its window deciders.
 *
 * A window decider sends one signal each time one of its enable windows opens, and that switches on every inserter or drill
 * wired to it. Each signal costs the game time on its own, for every inserter on the decider's network, so the count is of
 * signals sent, not of inserters switched on: inserters that share a decider share its signals. A window's closing edge is a
 * second change of the output; it is not counted, since there is one for each opening edge.
 *
 * It is read from the clock-only run the wake-ups are counted on (`as_built.counters`, same ticks):
 * - a decider that switches inserters sends as many signals as the most of its inserters were switched on, which is the same
 *   for all of them but a window that finds one still enabled;
 * - a decider that switches drills of a chest sends one signal for each window the drills have in a window cycle.
 *
 * Null where the clock had no long run to count on. The selection compares it only between clocks equal on wake-ups
 * (`ClockRanking.signals_per_minute`); nothing judges a clock by it.
 */
export function signalsPerMinuteOf(
    counters: InserterCounters | undefined,
    blueprint: FactorioBlueprint,
    chest_drills: readonly ChestDrillClock[] | undefined,
    clock_window_cycle_ticks: number,
): number | null {
    if (counters === undefined) {
        return null;
    }
    const switched_on = new Map(counters.inserters.map(it => [it.inserter_id, it.switch_ons_per_minute]));
    const drills = new Map((chest_drills ?? []).map(it => [it.drill_id, it.window_count]));
    let signals = 0;
    for (const entity of blueprint.entities) {
        const named = entity.name === "decider-combinator"
            ? (entity.tags as { clock_generator?: { inserters?: number[]; drills?: number[] } } | undefined)?.clock_generator : undefined;
        if (named === undefined) {
            continue;
        }
        if (named.inserters !== undefined) {
            signals += Math.max(0, ...named.inserters.map(number => switched_on.get(EntityId.forInserter(number).id) ?? 0));
        } else if (named.drills !== undefined) {
            signals += Math.max(0, ...named.drills.map(number => drills.get(number) ?? 0)) * 3600 / clock_window_cycle_ticks;
        }
    }
    return signals;
}
