import assert from "../common/assert";
import { pickupLaneLength } from "../common/belt-pickup-layout";
import { Config } from "../config";
import { EntityId } from "../entities";
import { laneFactsOfConfig } from "../entities/traits/build-traits";
import { BeltPickupStock } from "../state/belt-pickup-stock";
import { EntityState } from "../state/entity-state";
import { SharedLane } from "../state/shared-lane";
import { FactorioDataService, ItemName } from "../data";
import type { TileSize } from "../data/factorio-data-types";
import type { InserterArchetype } from "../simulation/archetypes/inserter";
import type { AfterInsertersTick } from "../simulation/world";
import { BuildCopies, copyNumberOf } from "./sequence/build-copies";
import { Logger } from "../common/logger";
import { OpenRange } from "../data-types";
import { SimulationContext } from "./sequence/simulation-context";
import { runClockOnBuild } from "./trial";
import { alongFlow } from "./shared-lane-lanes";
import type { CopiesOnSharedLanes, DisturbanceTrialOptions, LossOutcome } from "./disturbance-trial";
import { installOutputBelt, OutputBeltRun } from "./output-belt-run";

/** A hand that an inserter put down, at the tick it did */
export interface HandDropped {
    readonly tick: number;
    readonly item: ItemName;
    readonly items: number;
}

/** A map direction as a unit step: the way a lane's items flow */
export interface FlowDirection {
    readonly x: number;
    readonly y: number;
}

/** One taker of one copy on a lane of the row, and the stretch of the lane it reaches */
export interface RowTaker {
    /** Which copy of the row, 0 the most upstream, which is the config's own */
    readonly copy: number;
    /** The config's inserter that the copy's taker is a copy of */
    readonly inserter_id: string;
    /** The downstream edge of its reach, in tiles from the lane's entry */
    readonly edge_tiles: number;
    readonly length_tiles: number;
}

/** A lane the copies share, laid out as a row: its takers of every copy, in tiles from its entry */
export interface LaneRow {
    readonly belt_id: number;
    readonly lane: 1 | 2;
    readonly length_tiles: number;
    /** Copies on the lane, the part copy counted as one */
    readonly copies: number;
    /** The way the lane's items move */
    readonly flow: FlowDirection;
    /** Tiles from one copy to the next along the lane */
    readonly step_tiles: number;
    /** Whether the step is the config's `copy_offset`, or one the layout assumed for want of it */
    readonly step_stated: boolean;
    readonly takers: readonly RowTaker[];
}

/** A lane the layout lays out, the way its items move, and whether the copies share it or each copy has a lane of its own */
export interface LaidOutLane {
    readonly belt_id: number;
    readonly lane: 1 | 2;
    readonly flow: FlowDirection;
    /** Whether every copy takes from it; a lane one copy alone takes from holds the takers of the config's copy */
    readonly shared: boolean;
}

/** The lanes laid out as rows, and the copies a run of them holds */
export interface SharedLaneLayout {
    readonly rows: readonly LaneRow[];
    readonly copies: BuildCopies;
}

/** The lane between the entry and the first reach, in tiles: the entry stands a tile upstream of the row */
const ENTRY_TILES = 1;

/** The longer side of an entity in tiles: the config does not say which way a machine is turned */
const longerSide = (size: TileSize) => Math.max(size.tile_width, size.tile_height);

/**
 * The tiles one copy takes along a belt, for a config that gives no spacing and no positions: the longer side of its
 * widest machine or drill, as the game data gives their sizes (a machine that names no prototype has no size). A copy
 * with no machine or drill of known size gets the smallest that the game data has, the nearest that copies can stand.
 */
function copyWidthTiles(config: Config): number {
    const machines = config.machines.flatMap(machine => {
        const prototype = machine.prototype === undefined ? null : FactorioDataService.findCraftingMachine(machine.prototype);
        return prototype === null ? [] : [longerSide(prototype)];
    });
    const drills = (config.drills?.configs ?? []).map(drill => longerSide(FactorioDataService.getMiningDrillSpec(drill.type)));
    const known = [...machines, ...drills];
    if (known.length > 0) return Math.max(...known);
    return Math.min(...[...FactorioDataService.getAllCraftingMachines(), ...FactorioDataService.getAllMiningDrills()].map(longerSide));
}

/** Whether an inserter that takes from a belt takes the lane's item, by its filters */
function takesItem(inserter: Config["inserters"][number], item: string): boolean {
    return inserter.filters === undefined || inserter.filters.length === 0
        || (inserter.filter_mode === "blacklist" ? !inserter.filters.includes(item) : inserter.filters.includes(item));
}

/**
 * The entities of the config a part copy holds: its share of the takers of each shared lane, with the machines they
 * feed: the takers `chosen`, every machine, chest and drill that their sinks need, found upstream through what
 * feeds them (inserters, a machine that places its results itself, drills), and the inserters that take the results of
 * those machines to a belt, a chest or one of those machines. A taker of a shared lane that is not chosen stays out.
 */
function partCopyOf(config: Config, chosen: ReadonlySet<string>, lane_takers: ReadonlySet<string>): Set<string> {
    const inserters = config.inserters.map((inserter, index) => ({ id: EntityId.forInserter(inserter.id ?? index + 1).id, inserter }));
    const endId = (end: { type: string; id: number }) => end.type === "machine" ? EntityId.forMachine(end.id).id
        : end.type === "chest" ? EntityId.forChest(end.id).id : EntityId.forBelt(end.id).id;
    const held = new Set<string>(chosen);
    const nodes: string[] = [];
    const reach = (id: string) => { if (!held.has(id)) { held.add(id); nodes.push(id); } };
    for (const { id, inserter } of inserters) if (chosen.has(id) && inserter.sink.type !== "belt") reach(endId(inserter.sink));
    while (nodes.length > 0) {
        const node = nodes.pop()!;
        for (const { id, inserter } of inserters) {
            if (endId(inserter.sink) !== node || (lane_takers.has(id) && !chosen.has(id))) continue;
            held.add(id);
            if (inserter.source.type !== "belt") reach(endId(inserter.source));
        }
        for (const machine of config.machines) {
            if (machine.result_target !== undefined && endId(machine.result_target) === node) reach(EntityId.forMachine(machine.id).id);
        }
        for (const drill of config.drills?.configs ?? []) if (endId(drill.target) === node) held.add(EntityId.forDrill(drill.id).id);
    }
    for (const { id, inserter } of inserters) {
        if (inserter.source.type !== "belt" && held.has(endId(inserter.source)) && (inserter.sink.type === "belt" || held.has(endId(inserter.sink)))) held.add(id);
        if (inserter.sink.type === "chest" && held.has(id)) held.add(endId(inserter.sink));
    }
    for (const machine of config.machines) {
        if (held.has(EntityId.forMachine(machine.id).id) && machine.result_target !== undefined) held.add(endId(machine.result_target));
    }
    for (const belt of config.belts) held.add(EntityId.forBelt(belt.id).id);
    return held;
}

/**
 * The lanes `lanes` names laid out as rows, and the copies a run of them holds: copies stand in a row along every lane
 * they share, `copy_offset` apart, or end to end from the config's positions when it is unset, else one copy's width
 * apart; a part copy
 * holds that part of a copy's takers on each lane, rounded up for each taker, with the machines they feed.
 *
 * Where along the lane a taker reaches is its position on the map along the way the lane flows: an inserter at the side
 * of a straight belt reaches the belt tile beside it, so the tile's middle is the inserter's position along the flow.
 * The copies stand downstream of each other in the order they are numbered, the copy of the config first; the part copy
 * stands last, with the takers of it that stand furthest upstream (`partCopyOf`). The row is straight: a row folded
 * back on itself or mirrored is not expressed, and is run as if it were straight.
 *
 * A lane one copy alone takes from (per copy, or a build of one copy) holds the takers of the config's copy only.
 * It needs no spacing along it, and may run across `copy_offset`; a lane that more than one copy shares needs one.
 *
 * A config without the positions of a lane's takers has the takers of a copy a tile apart in the config's order, and the
 * copies one copy's width apart (`copyWidthTiles`), unless `copy_offset` says how far apart they stand. The width is
 * never less than a tile for each taker, so that the takers of two copies never stand on one tile.
 */
export function sharedLaneLayoutOf(config: Config, lanes: readonly LaidOutLane[]): SharedLaneLayout {
    const offset = config.setpoint.copy_offset;
    const copies = config.setpoint.copies;
    const whole = Math.floor(copies), part = copies - whole;

    const copy_width = offset === undefined ? copyWidthTiles(config) : 0;
    const laid = lanes.flatMap(({ belt_id, lane, flow, shared }) => {
        const belt = config.belts.find(it => it.id === belt_id);
        const item = belt?.lanes[lane - 1]?.ingredient;
        if (belt === undefined || item === undefined || item === "") return [];
        const along = (position: { x: number; y: number }) => alongFlow(position, flow);
        const of_lane = config.inserters.flatMap((inserter, index) => inserter.source.type === "belt" && inserter.source.id === belt_id && takesItem(inserter, item)
            ? [{ inserter, index }] : []);
        if (of_lane.length === 0) return [];
        const positioned = of_lane.every(({ inserter }) => inserter.position !== undefined);
        const takers = of_lane.map(({ inserter, index }, order) => ({
            inserter_id: EntityId.forInserter(inserter.id ?? index + 1).id,
            at: positioned ? along(inserter.position!) : order,
            length: inserter.source.type === "belt"
                ? pickupLaneLength(inserter.source.pickup_layout ?? "side-straight", lane, inserter.source.pickup_length ?? 1) : 1,
        })).sort((a, b) => a.at - b.at);
        const positions = [...config.machines, ...config.inserters, ...(config.chests ?? []), ...(config.drills?.configs ?? [])]
            .flatMap(entity => "position" in entity && entity.position !== undefined ? [along(entity.position)] : []);
        // one copy to the next, along the flow: copy_offset where it is given, else the copy's own length from its
        // positions, else the width of a copy
        const step = offset !== undefined ? Math.abs(along(offset))
            : positioned ? Math.max(...positions) - Math.min(...positions) + 1 : Math.max(copy_width, takers.length);
        // the step places the copies after the first, so only a lane that more than one copy shares needs it: a lane one copy
        // alone takes from may run any way, across copy_offset too
        assert(step > 0 || !(shared && copies > 1), `The copies on lane ${lane} of belt ${belt_id} need copy_offset along the lane`);
        return [{ belt_id, lane, flow, shared, takers, step, item }];
    });

    // the part copy: its share of each shared lane's takers, those furthest upstream, and what they need
    const shared_lanes = laid.filter(it => it.shared);
    const lane_takers = new Set(shared_lanes.flatMap(it => it.takers.map(taker => taker.inserter_id)));
    const chosen = new Set(shared_lanes.flatMap(it => it.takers.slice(0, Math.ceil(part * it.takers.length - 1e-9)).map(taker => taker.inserter_id)));
    const part_copy = part > 0 && shared_lanes.length > 0 ? partCopyOf(config, chosen, lane_takers) : null;
    const copy_count = shared_lanes.length === 0 ? 1 : whole + (part_copy !== null ? 1 : 0);

    const rows = laid.map(({ belt_id, lane, flow, shared, takers, step }) => {
        const placed: { copy: number; inserter_id: string; low: number; high: number }[] = [];
        for (let copy = 0; copy < (shared ? copy_count : 1); copy++) {
            const of_copy = copy < whole ? takers : takers.filter(taker => part_copy!.has(taker.inserter_id));
            for (const taker of of_copy) {
                const middle = taker.at + copy * step;
                placed.push({ copy, inserter_id: taker.inserter_id, low: middle - taker.length / 2, high: middle + taker.length / 2 });
            }
        }
        const entry = Math.min(...placed.map(it => it.low)) - ENTRY_TILES;
        const end = Math.max(...placed.map(it => it.high));
        return {
            belt_id, lane, flow, copies: shared ? copy_count : 1, length_tiles: end - entry, step_tiles: step, step_stated: offset !== undefined,
            takers: placed.map(it => ({ copy: it.copy, inserter_id: it.inserter_id, edge_tiles: it.high - entry, length_tiles: it.high - it.low })),
        };
    });
    const later = Array.from({ length: copy_count - 1 }, (_, index): "whole" | ReadonlySet<string> => index + 1 < whole ? "whole" : part_copy!);
    return { rows, copies: { later } };
}

/** What one inserter of one copy did on the lanes the model ran */
export interface CopyTakerRecord {
    readonly copy: number;
    /** The config's inserter the copy's taker is a copy of */
    readonly inserter_id: string;
    readonly hands: readonly HandDropped[];
    /** The last tick of the run it recorded */
    readonly last_tick: number;
}

/** The model as installed in a context: the lanes, and what each taker of each copy put down */
export interface SharedLaneRun {
    readonly rows: readonly LaneRow[];
    readonly lanes: readonly SharedLane[];
    readonly takers: readonly CopyTakerRecord[];
    /** Where the config states its output belt: the belt from the copies' output inserters to the infinite end, as it ran */
    readonly output_belt?: OutputBeltRun;
    /** With a disturbance trial asked for (`runOnSharedLanes`): what the copies made after each trial of the loss */
    readonly disturbance_trial?: LossOutcome;
}

/**
 * Records the hands an inserter of the simulated copy puts down, from what it has dropped, and the items it picks up,
 * from what its hand holds
 */
export class DropRecorder implements AfterInsertersTick {
    public readonly hands: HandDropped[] = [];
    /** Each rise of what the hand holds: the items picked up in a tick */
    public readonly pickups: HandDropped[] = [];
    /** The ticks the hand put down the last of what it held: one a swing, where a hand goes down in several drops (on a belt) */
    public readonly hand_ends: number[] = [];
    private dropped: number;
    /** The item the hand held after the last tick: what a drop in this tick put down */
    private held: string | null;
    private quantity: number;
    /** The last tick recorded: the run's length */
    public last_tick = 0;

    constructor(private readonly inserter: InserterArchetype, private readonly now: () => number) {
        this.dropped = inserter.inserter_state.items_dropped;
        this.held = inserter.inserter_state.held_item?.item_name ?? null;
        this.quantity = inserter.inserter_state.held_item?.quantity ?? 0;
    }

    public tick(): void {
        const state = this.inserter.inserter_state;
        const tick = this.now();
        this.last_tick = tick;
        const dropped = state.items_dropped;
        const put_down = dropped > this.dropped;
        if (put_down) this.hands.push({ tick, item: this.held ?? "", items: dropped - this.dropped });
        this.dropped = dropped;
        const quantity = state.held_item?.quantity ?? 0;
        if (state.held_item !== null && quantity > this.quantity) this.pickups.push({ tick, item: state.held_item.item_name, items: quantity - this.quantity });
        if (this.quantity > 0 && quantity === 0 && put_down) this.hand_ends.push(tick);
        this.quantity = quantity;
        this.held = state.held_item?.item_name ?? this.held;
    }
}

/** Puts a recorder on each of the inserters named into a context before its first tick: for a run without the model */
export function recordInserters(context: SimulationContext, inserter_ids: readonly string[]): Map<string, DropRecorder> {
    assert(context.tick_provider.getCurrentTick() === 0, "The recorders go in before the first tick");
    const now = () => context.tick_provider.getCurrentTick();
    const recorders = new Map<string, DropRecorder>();
    for (const inserter of context.inserters) {
        if (!inserter_ids.includes(inserter.entity_id.id)) continue;
        const recorder = new DropRecorder(inserter, now);
        context.after_inserters.push(recorder);
        recorders.set(inserter.entity_id.id, recorder);
    }
    return recorders;
}

/**
 * Puts the model into a context of the copies (build-copies.ts) before its first tick: each row's lane runs as one
 * `SharedLane`, and each taker of each copy reaches it in place of a stock of its own, its hands recorded. A lane of
 * unknown end is not run here: it is run under each end in turn by the caller. Where the config states its output belt,
 * each copy's output inserter puts its stacks onto it (output-belt-run.ts); else each puts them on a tile of its own.
 */
export function installSharedLanes(context: SimulationContext, config: Config, rows: readonly LaneRow[]): SharedLaneRun {
    assert(context.tick_provider.getCurrentTick() === 0, "The shared lanes go in before the first tick");
    const facts = laneFactsOfConfig(config);
    const now = () => context.tick_provider.getCurrentTick();
    const archetypes = new Map(context.inserters.map(inserter => [inserter.entity_id.id, inserter]));
    // each taker's reaches, by the run's inserter, one for each lane the model runs
    const reaches = new Map<string, { copy: number; inserter_id: string; lanes: Map<1 | 2, BeltPickupStock> }>();
    const lanes: SharedLane[] = [];
    for (const row of rows) {
        const lane_facts = facts.of(row.belt_id, row.lane);
        const belt = config.belts.find(it => it.id === row.belt_id)!;
        const belt_state = context.state_registry.getStateByEntityIdOrThrow(EntityId.forBelt(row.belt_id));
        assert(EntityState.isBelt(belt_state), `Belt ${row.belt_id} is not a belt`);
        const lane = new SharedLane({
            belt_speed: belt_state.belt.belt_speed, stack_size: belt.lanes[row.lane - 1].stack_size,
            supply_rate: lane_facts.supply_rate, lane_end: lane_facts.lane_end, length_tiles: row.length_tiles,
        });
        lanes.push(lane);
        for (const taker of row.takers) {
            const id = EntityId.forInserter(copyNumberOf(taker.copy, Number(taker.inserter_id.slice("inserter:".length)))).id;
            const of_taker = reaches.get(id) ?? { copy: taker.copy, inserter_id: taker.inserter_id, lanes: new Map<1 | 2, BeltPickupStock>() };
            of_taker.lanes.set(row.lane, lane.reachOf(taker.edge_tiles, taker.length_tiles));
            reaches.set(id, of_taker);
        }
    }

    const takers: CopyTakerRecord[] = [];
    for (const [id, { copy, inserter_id, lanes: of_taker }] of reaches) {
        const archetype = archetypes.get(id);
        assert(archetype !== undefined, `No inserter ${id} in the simulation`);
        const belt_state = context.state_registry.getStateByEntityIdOrThrow(archetype.inserter_state.inserter.source.entity_id);
        assert(EntityState.isBelt(belt_state), `${id} does not take from a belt`);
        const own = belt_state.pickupsOf(id);
        assert(own !== undefined, `${id} has no pickup on its belt`);
        belt_state.seedPickups(id, belt_state.lanes.map((_, index) => of_taker.get((index + 1) as 1 | 2) ?? own[index]));
        const recorder = new DropRecorder(archetype, now);
        context.after_inserters.push(recorder);
        takers.push({ copy, inserter_id, hands: recorder.hands, get last_tick() { return recorder.last_tick; } });
    }
    const output_belt = installOutputBelt(context, config);
    return output_belt === null ? { rows, lanes, takers } : { rows, lanes, takers, output_belt };
}

/**
 * Runs a build on the windows of a clock from a cold start, as `runClockOnBuild` does, with every copy of the layout
 * built (each with its own machines) and the rows' lanes shared by them (`installSharedLanes`). It judges nothing: it
 * gives what each taker of each copy put down, at the ticks of the run (the clock stands at 0 in its first tick), for a
 * reader to compare. `on_context` lets the reader put recorders of its own into the run's context before its first tick.
 *
 * With `disturbance_trial`, the trials of its loss follow the run (disturbance-trial.ts), on the copies: a supply stop
 * closes the entry of each lane of the rows that carries the item, and each copy's output is judged on its own.
 */
export function runOnSharedLanes(
    config: Config,
    windows: Map<string, OpenRange[]>,
    window_cycle_ticks: number,
    layout: SharedLaneLayout,
    window_cycles: number,
    logger: Logger,
    on_context?: (context: SimulationContext) => void,
    disturbance_trial?: DisturbanceTrialOptions,
): SharedLaneRun {
    let model: SharedLaneRun | undefined;
    const copies: CopiesOnSharedLanes = { lanes: [] };
    const run = runClockOnBuild({ ...config, overrides: { ...config.overrides, derive_clock_windows: false } }, windows, window_cycle_ticks, logger, {
        simulate_window_cycles: window_cycles, record_histories: false, factorio_states: false, build_copies: layout.copies,
        ...(disturbance_trial !== undefined && { disturbance_trial: { ...disturbance_trial, copies } }),
        on_context: context => {
            model = installSharedLanes(context, config, layout.rows);
            copies.lanes = model.rows.map((row, index) => ({ belt_entity_id: EntityId.forBelt(row.belt_id).id,
                item: config.belts.find(belt => belt.id === row.belt_id)!.lanes[row.lane - 1].ingredient, lane: model!.lanes[index] }));
            if (model.output_belt !== undefined) copies.output_belt = { item: config.setpoint.recipe, belt: model.output_belt };
            on_context?.(context);
        },
    });
    assert(model !== undefined, "The run made no context");
    return run.disturbance_trial === undefined ? model : { ...model, disturbance_trial: run.disturbance_trial };
}
