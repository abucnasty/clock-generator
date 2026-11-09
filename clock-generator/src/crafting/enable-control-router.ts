import * as E from "fp-ts/Either";
import { absurd, pipe } from "fp-ts/function";
import { Entity, EntityId, ReadableEntityRegistry } from "../entities";
import type { ChestDrillClock, ChestDrillWhy } from "./chest-drill-windows";
import type { ClockStrategy, StrategyId, StrategyRef } from "./clock-strategy";
import type { BlueprintGenerationResult } from "./plan/unclocked-run";
import { alwaysEnabledInserters, loopInserters, type InserterClock } from "./sequence/unplanned-inserter-clock";
import type { TuningMethod } from "./strategy-catalog";

/**
 * The Enable Control Strategy Router: every inserter and drill of a clock gets exactly one route, the reason it stays always
 * enabled (Left) or the rule that places its enable windows (Right). It runs in two phases, as the facts and the strategy's name
 * are known at different points:
 *
 * - phase 1 (`classifyEntities`, in exportClock) classifies every inserter and drill when a maker exports its clock, and the
 *   clock's `always_on_reasons` are its Lefts. An entity with windows from the clock is a Right whose strategy has no name yet.
 * - phase 2 (`entityRoutesOf`, where the strategy of an alternative is known) reads those routes back from the result and names
 *   the windowed entities: a Direct clock's strategy, or the strategy of the part each source of a Coordinated Sources clock took.
 *
 * The routes stay inside the engine: the result, the exports and the record carry only what is derived from them.
 */

/** The build sets the entity's Enable Control Strategy override to Always on */
export interface OverrideReason { kind: "override" }
/** It moves items between machines that feed each other in a loop, which the clock leaves running */
export interface LoopReason { kind: "loop" }
/** It takes from a machine of a loop to a machine outside it, which the clock leaves running too */
export interface FromLoopReason { kind: "from-loop" }
/**
 * A full duty cycle: its swings take the whole window cycle, or all of it but its window's offset. Its enable windows would
 * have a duty cycle of 1, so the clock leaves it always enabled
 */
export interface FullDutyCycleReason { kind: "full-duty-cycle"; window_cycle_ticks: number }
/** The run of the build that the windows are read from recorded no swing of it, so there is nothing to read a window from */
export interface NoSwingReason { kind: "no-swing" }
/** A drill into a chest that nothing can time (see `ChestDrillWhy`) */
export interface ChestDrillReason { kind: "chest-drill"; why: Exclude<ChestDrillWhy, { kind: "config" }> }

/**
 * Why a clock leaves an inserter or a drill on all the time, with no enable window: a sealed union, one variant per reason,
 * each with its own data. A new reason is a new variant; every switch over the reasons ends in `absurd`, so it is a compile
 * error wherever it must be handled.
 */
export type AlwaysOnReason = OverrideReason | LoopReason | FromLoopReason | FullDutyCycleReason | NoSwingReason | ChestDrillReason;

/** The reason each inserter and drill is always on, by entity id ("inserter:3", "drill:1"); none for one that has windows */
export type AlwaysOnReasons = Record<string, AlwaysOnReason>;

/** A strategy of the catalog */
export interface CatalogStrategy { kind: "catalog"; id: StrategyId; tuning_method: TuningMethod }
/** A fuel inserter on a clock of its own */
export interface OwnFuelClockStrategy { kind: "own_fuel_clock" }
/** A by-product inserter on its modulus windows */
export interface ByProductStrategy { kind: "by_product" }
/** A drill into a chest on just-in-time windows */
export interface ChestDrillStrategy { kind: "chest_drill" }
/** The build's Clocked override */
export interface OverrideClockedStrategy { kind: "override_clocked" }

/** The rule that places an entity's enable windows: an Enable Control Strategy, as the glossary defines it */
export type EnableControlStrategy = CatalogStrategy | OwnFuelClockStrategy | ByProductStrategy | ChestDrillStrategy | OverrideClockedStrategy;

/** An entity's route: the reason it stays always enabled, or the rule that places its enable windows */
export type EntityRoute = E.Either<AlwaysOnReason, EnableControlStrategy>;

/** The route of every inserter and drill of the build, by entity id */
export type EntityRoutes = ReadonlyMap<string, EntityRoute>;

/** Phase 1's Right for an entity with windows from the clock: the strategy that made them is named in phase 2 */
interface WindowedByTheClock { kind: "windowed" }

/** A route as phase 1 gives it */
type ClassifiedRoute = E.Either<AlwaysOnReason, Exclude<EnableControlStrategy, CatalogStrategy> | WindowedByTheClock>;

/** An inserter or drill the router cannot route: generation fails, naming it, as no rule of the router covers it */
export class EntityRouteError extends Error {
    constructor(message: string) { super(message); this.name = "EntityRouteError"; }
}

/** What tells the Rights apart: the same facts in exportClock and, read back, in a result */
interface WindowFacts {
    /** Its windows are on the clock of the window cycle (an empty list included) */
    has_windows: (entity_id: string) => boolean;
    /** Its clock outside the plan (fuel, by-product), where it has one */
    inserter_clock: (entity_id: string) => Pick<InserterClock, "kind" | "own_clock"> | undefined;
    chest_drills: readonly ChestDrillClock[];
    /** The ids the build sets to Clocked */
    clocked_by_config: ReadonlySet<string>;
}

/** Always on: no windows on the clock of the window cycle and no clock of its own */
const alwaysOn = (facts: WindowFacts, entity_id: string): boolean =>
    !facts.has_windows(entity_id) && facts.inserter_clock(entity_id)?.own_clock !== true;

/** The rule of an entity with windows, in the order of the router's table */
function windowRuleOf(facts: WindowFacts, entity_id: string): Exclude<EnableControlStrategy, CatalogStrategy> | WindowedByTheClock {
    if (facts.chest_drills.some(drill => drill.planned && EntityId.forDrill(drill.drill_id).id === entity_id)) {
        return { kind: "chest_drill" };
    }
    if (facts.clocked_by_config.has(entity_id)) {
        return { kind: "override_clocked" };
    }
    const clock = facts.inserter_clock(entity_id);
    if (clock !== undefined) {
        switch (clock.kind) {
            case "fuel": return { kind: "own_fuel_clock" };
            case "by-product": return { kind: "by_product" };
            default: return absurd(clock.kind);
        }
    }
    return { kind: "windowed" };
}

const routedIds = (entity_registry: Pick<ReadableEntityRegistry, "getAll">): string[] =>
    entity_registry.getAll().filter(it => Entity.isInserter(it) || Entity.isDrill(it)).map(it => it.entity_id.id);

/** The reasons of the drills into chests that the clock leaves always enabled, by drill id */
export function chestDrillReasons(drills: readonly ChestDrillClock[]): AlwaysOnReasons {
    return Object.fromEntries(drills.flatMap(drill => {
        const why = drill.enabled_ticks === null ? drill.always_enabled_because : undefined;
        if (why === undefined) {
            return [];
        }
        // a drill the build sets to Always on is not a chest drill's reason
        const reason: AlwaysOnReason = why.kind === "config" ? { kind: "override" } : { kind: "chest-drill", why };
        return [[EntityId.forDrill(drill.drill_id).id, reason] as const];
    }));
}

/**
 * Phase 1: the route of every inserter and drill of the build as a maker exports its clock. One with windows (or a clock of its
 * own) is a Right: a drill into a chest on just-in-time windows, the build's Clocked override, a fuel inserter on its own clock, a
 * by-product inserter, else windows from the clock that phase 2 names. One without is a Left, for the first reason known, in the
 * order they are known best: the strategy that left it on (`left_open`), the drill's own report, the build's Always on, a loop, and
 * last that the run the windows were read from never swung it. One that swung, has no window and that no rule names throws.
 */
export function classifyEntities(
    entity_registry: Pick<ReadableEntityRegistry, "getAll">,
    facts: WindowFacts & {
        /** The ids the build sets to Always on */
        override: ReadonlySet<string>;
        /** What the strategy that made the windows left without them, with its reason */
        left_open: ReadonlyMap<string, AlwaysOnReason>;
        /** The ids with a swing in the run the windows were read from */
        swung: ReadonlySet<string>;
    },
): ReadonlyMap<string, ClassifiedRoute> {
    const drills = chestDrillReasons(facts.chest_drills);
    const loop = new Set(loopInserters(entity_registry).map(it => it.entity_id.id));
    const from_loop = new Set(alwaysEnabledInserters(entity_registry).map(it => it.entity_id.id));
    const reasonOf = (id: string): AlwaysOnReason | undefined => facts.left_open.get(id) ?? drills[id]
        ?? (facts.override.has(id) ? { kind: "override" } : undefined)
        ?? (loop.has(id) ? { kind: "loop" } : from_loop.has(id) ? { kind: "from-loop" } : undefined)
        ?? (facts.swung.has(id) ? undefined : { kind: "no-swing" });
    return new Map(routedIds(entity_registry).map(id => {
        if (!alwaysOn(facts, id)) {
            return [id, E.right(windowRuleOf(facts, id))] as const;
        }
        const reason = reasonOf(id);
        if (reason === undefined) {
            throw new EntityRouteError(`Internal error: ${id} swung in the run its enable windows are read from, has no enable window, `
                + "and no rule leaves it always enabled");
        }
        return [id, E.left(reason)] as const;
    }));
}

/** The clock's reasons: the Lefts of its routes, in the order of the build's entities */
export function alwaysOnReasonsOf(routes: ReadonlyMap<string, E.Either<AlwaysOnReason, unknown>>): AlwaysOnReasons {
    const reasons: AlwaysOnReasons = {};
    for (const [id, route] of routes) {
        if (E.isLeft(route)) {
            reasons[id] = route.left;
        }
    }
    return reasons;
}

/**
 * The routes phase 1 gave a clock, read back from its result: its `always_on_reasons` are the Lefts, and what tells the Rights
 * apart is in it (its windows, its clocks outside the plan, its drills into chests) and in the config (`clocked_by_config`).
 * The problems name what breaks the routing: an entity always on with no reason (no route), one that has a reason and windows
 * too, a reason for an entity the build does not have.
 */
export function routesOfResult(
    entity_registry: Pick<ReadableEntityRegistry, "getAll">,
    result: Pick<BlueprintGenerationResult, "clock_windows" | "unplanned_inserter_clocks" | "chest_drills" | "always_on_reasons">,
    clocked_by_config: ReadonlySet<string>,
): { routes: ReadonlyMap<string, ClassifiedRoute>; problems: string[] } {
    const facts: WindowFacts = {
        has_windows: id => result.clock_windows[id] !== undefined,
        inserter_clock: id => result.unplanned_inserter_clocks?.[id],
        chest_drills: result.chest_drills ?? [],
        clocked_by_config,
    };
    const ids = routedIds(entity_registry);
    const reasons = result.always_on_reasons ?? {};
    const routes = new Map<string, ClassifiedRoute>();
    const problems: string[] = [];
    for (const id of ids) {
        const reason = reasons[id];
        if (reason !== undefined) {
            routes.set(id, E.left(reason));
            if (!alwaysOn(facts, id)) problems.push(`${id} has a reason and is not always on`);
        } else if (alwaysOn(facts, id)) {
            problems.push(`${id} is always on with no reason`);
        } else {
            routes.set(id, E.right(windowRuleOf(facts, id)));
        }
    }
    problems.push(...Object.keys(reasons).filter(id => !ids.includes(id)).map(id => `${id} has a reason and is not an inserter or drill of the build`));
    return { routes, problems };
}

/**
 * Who placed the windows of an entity the clock gave windows: a Direct clock's strategy; for Coordinated Sources the strategy
 * of the part its source took (`routing.sources`), and for an entity in no source (a drill) the strategy of the clock whose
 * windows the composition keeps beside the sources' (`beside_sources`, the recommended clock's)
 */
function windowStrategyOf(strategy: ClockStrategy, beside_sources: StrategyRef | undefined, entity_registry: Pick<ReadableEntityRegistry, "getAll">) {
    const inserters = new Set(entity_registry.getAll().filter(Entity.isInserter).map(it => it.entity_id.id));
    const catalog = (ref: StrategyRef): CatalogStrategy => ({ kind: "catalog", id: ref.id, tuning_method: ref.tuning_method });
    return (entity_id: string): CatalogStrategy => {
        const router = strategy.routing.router;
        switch (router) {
            case "direct":
                if (strategy.id === null || strategy.tuning_method === null) {
                    throw new EntityRouteError(`Internal error: ${entity_id} has enable windows from a Direct clock with no strategy`);
                }
                return catalog({ id: strategy.id, tuning_method: strategy.tuning_method });
            case "coordinated_sources": {
                if (!inserters.has(entity_id)) {
                    if (beside_sources === undefined) {
                        throw new EntityRouteError(`Internal error: ${entity_id} has enable windows from a Coordinated Sources clock whose recommended clock has no strategy`);
                    }
                    return catalog(beside_sources);
                }
                const control = strategy.routing.sources?.flatMap(source => source.entities[entity_id] ?? []).find(it => it.kind === "strategy");
                if (control?.kind !== "strategy") {
                    throw new EntityRouteError(`Internal error: ${entity_id} has enable windows and no source of the Coordinated Sources clock gives it a strategy`);
                }
                return catalog(control);
            }
            default: return absurd(router);
        }
    };
}

/**
 * Phase 2: the route of every inserter and drill of an alternative's clock, its windowed entities named by its strategy. Throws
 * where an entity has no route or one that cannot be named; the routes stay internal (question 111).
 */
export function entityRoutesOf(
    entity_registry: Pick<ReadableEntityRegistry, "getAll">,
    result: Pick<BlueprintGenerationResult, "clock_windows" | "unplanned_inserter_clocks" | "chest_drills" | "always_on_reasons">,
    clocked_by_config: ReadonlySet<string>,
    strategy: ClockStrategy,
    beside_sources?: StrategyRef,
): EntityRoutes {
    const { routes, problems } = routesOfResult(entity_registry, result, clocked_by_config);
    if (problems.length > 0) {
        throw new EntityRouteError(`Internal error: ${problems.join("; ")}`);
    }
    const named = windowStrategyOf(strategy, beside_sources, entity_registry);
    return new Map(Array.from(routes, ([id, route]) => [id, pipe(route, E.map((rule): EnableControlStrategy => {
        switch (rule.kind) {
            case "windowed": return named(id);
            case "own_fuel_clock":
            case "by_product":
            case "chest_drill":
            case "override_clocked":
                return rule;
            default: return absurd(rule);
        }
    }))] as const));
}
