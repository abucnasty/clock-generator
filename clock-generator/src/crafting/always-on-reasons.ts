import { Entity, EntityId, ReadableEntityRegistry } from "../entities";
import type { ChestDrillClock, ChestDrillWhy } from "./chest-drill-windows";
import { alwaysEnabledInserters, loopInserters } from "./sequence/unplanned-inserter-clock";

/**
 * Why a clock leaves an inserter or a drill on all the time, with no wake window, where the planner has a reason:
 *
 * - "enable-rule": its enable rule is Always on, set by the build;
 * - "loop": it moves items between machines that feed each other in a loop, which the clock leaves running;
 * - "from-loop": it takes from a machine of a loop to a machine outside it, which the clock leaves running too;
 * - "busy": its swings take the whole clock period (or all of it but the offset of its window), so a wake window would
 *   only put gaps between swings that follow each other;
 * - "chest-drill": a drill into a chest that nothing can time (see `ChestDrillWhy`);
 * - "no-swing": the run of the build that the windows are read from recorded no swing of it, so there is nothing to read
 *   a window from.
 *
 * An inserter or drill with no reason here is one the planner leaves on without having said why.
 */
export type AlwaysOnReason =
    | { kind: "enable-rule" }
    | { kind: "loop" }
    | { kind: "from-loop" }
    | { kind: "busy"; period_ticks: number }
    | { kind: "no-swing" }
    | { kind: "chest-drill"; why: Exclude<ChestDrillWhy, { kind: "config" }> };

/** The reason each inserter and drill is always on, by entity id ("inserter:3", "drill:1"); none for one that has windows */
export type AlwaysOnReasons = Record<string, AlwaysOnReason>;

/** The reasons of the drills into chests that the clock leaves always enabled, by drill id */
export function chestDrillReasons(drills: readonly ChestDrillClock[]): AlwaysOnReasons {
    return Object.fromEntries(drills.flatMap(drill => {
        const why = drill.enabled_ticks === null ? drill.always_enabled_because : undefined;
        if (why === undefined) {
            return [];
        }
        // a drill the build sets to Always on is not a chest drill's reason
        const reason: AlwaysOnReason = why.kind === "config" ? { kind: "enable-rule" } : { kind: "chest-drill", why };
        return [[EntityId.forDrill(drill.drill_id).id, reason] as const];
    }));
}

/**
 * The reason for every inserter and drill of the build that the clock leaves on all the time: those `is_clocked` does
 * not name (an inserter or drill with wake windows, or a fuel inserter on a clock of its own). In the order the reasons
 * are known best: the strategy that left it on (`left_open`), the drill's own report, the build's enable rule, a loop,
 * and last that the run the windows were read from never swung it (`swung` holds the ones it did).
 */
export function alwaysOnReasons(
    entity_registry: Pick<ReadableEntityRegistry, "getAll">,
    is_clocked: (entity_id: string) => boolean,
    known: {
        /** The ids the build sets to Always on */
        enable_rule: ReadonlySet<string>;
        /** What the strategy that made the windows left without them, with its reason */
        left_open: ReadonlyMap<string, AlwaysOnReason>;
        chest_drills: readonly ChestDrillClock[];
        /** The ids with a swing in the run the windows were read from */
        swung: ReadonlySet<string>;
    },
): AlwaysOnReasons {
    const drills = chestDrillReasons(known.chest_drills);
    const loop = new Set(loopInserters(entity_registry).map(it => it.entity_id.id));
    const from_loop = new Set(alwaysEnabledInserters(entity_registry).map(it => it.entity_id.id));
    const reasons: AlwaysOnReasons = {};
    for (const entity of entity_registry.getAll().filter(it => Entity.isInserter(it) || Entity.isDrill(it))) {
        const id = entity.entity_id.id;
        if (is_clocked(id)) {
            continue;
        }
        const reason = known.left_open.get(id) ?? drills[id]
            ?? (known.enable_rule.has(id) ? { kind: "enable-rule" as const } : undefined)
            ?? (loop.has(id) ? { kind: "loop" as const } : from_loop.has(id) ? { kind: "from-loop" as const } : undefined)
            ?? (known.swung.has(id) ? undefined : { kind: "no-swing" as const });
        if (reason !== undefined) {
            reasons[id] = reason;
        }
    }
    return reasons;
}
