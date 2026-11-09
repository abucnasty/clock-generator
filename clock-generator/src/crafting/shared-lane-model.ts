import assert from "../common/assert";
import { pickupLaneLength } from "../common/belt-pickup-layout";
import { Config } from "../config";
import { EntityId, Inserter } from "../entities";
import { BeltSpeed } from "../entities/belt";
import { LaneEnd, laneFactsOf } from "../entities/traits/lane-facts";
import { BackpressurePickupLane } from "../state/backpressure-pickup-lane";
import { BeltPickupLane } from "../state/belt-pickup-lane";
import { BeltPickupStock } from "../state/belt-pickup-stock";
import { EntityState } from "../state/entity-state";
import { SharedLane } from "../state/shared-lane";
import { CopyTaker, HandDropped } from "../simulation/copy-taker";
import type { InserterArchetype } from "../simulation/archetypes/inserter";
import type { CopyTakerTick } from "../simulation/world";
import { Logger } from "../common/logger";
import { OpenRange } from "../data-types";
import { SimulationContext } from "./sequence/simulation-context";
import { runClockOnBuild } from "./trial";

/** A map direction as a unit step: the way a lane's items flow */
export interface FlowDirection {
    readonly x: number;
    readonly y: number;
}

/** One taker of one copy on a lane of the row, and the stretch of the lane it reaches */
export interface RowTaker {
    /** Which copy of the row, 0 the most upstream, which is the one simulated in full */
    readonly copy: number;
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
    readonly takers: readonly RowTaker[];
}

/** The lane between the entry and the first reach, in tiles: the entry stands a tile upstream of the row */
const ENTRY_TILES = 1;

/**
 * The lanes the copies share, each laid out as a row (rulings: copies stand in a row along every lane they share,
 * `copy_offset` apart, or end to end from the config's positions when it is unset; a part copy holds that part of a
 * copy's takers on each lane, rounded up for each taker).
 *
 * Where along the lane a taker reaches is its position on the map along the way the lane flows: an inserter at the side
 * of a straight belt reaches the belt tile beside it, so the tile's middle is the inserter's position along the flow.
 * The copies stand downstream of each other in the order they are numbered, the copy of the config first and simulated
 * in full; the part copy stands last, with the takers of it that stand furthest upstream.
 *
 * A config without the positions of a lane's takers gets the least spacing: the takers of a copy a tile apart in the
 * config's order, and the copies end to end, unless `copy_offset` says how far apart they stand.
 *
 * Only the lanes `lanes` names are laid out. By default that is every lane a belt pickup takes from that the copies
 * share and that the build drops nothing onto: a lane the build drops onto is fed by those drops, which the model does
 * not run yet, and a supply rate at its entry alone would feed it what the drops do not.
 */
export function laneRowsOf(config: Config, flow: FlowDirection, lanes?: readonly { belt_id: number; lane: 1 | 2 }[]): LaneRow[] {
    const copies = config.setpoint.copies;
    const whole = Math.floor(copies), part = copies - whole;
    const facts = laneFactsOf(config);
    const along = (position: { x: number; y: number }) => position.x * flow.x + position.y * flow.y;
    const positions = [...config.machines, ...config.inserters, ...(config.chests ?? []), ...(config.drills?.configs ?? [])]
        .flatMap(entity => "position" in entity && entity.position !== undefined ? [along(entity.position)] : []);
    const offset = config.setpoint.copy_offset;
    const dropped_onto = new Set(config.inserters.flatMap(inserter => inserter.sink.type === "belt" ? [inserter.sink.id] : []));

    const rows: LaneRow[] = [];
    for (const belt of config.belts) {
        for (const lane of [1, 2] as const) {
            const named = lanes === undefined
                ? facts.of(belt.id, lane).sharing === "shared_by_copies" && !dropped_onto.has(belt.id)
                : lanes.some(it => it.belt_id === belt.id && it.lane === lane);
            const item = belt.lanes[lane - 1]?.ingredient;
            if (!named || item === undefined) continue;
            const of_lane = config.inserters.flatMap((inserter, index) => {
                const source = inserter.source;
                if (source.type !== "belt" || source.id !== belt.id) return [];
                const takes = inserter.filters === undefined || inserter.filters.length === 0
                    || (inserter.filter_mode === "blacklist" ? !inserter.filters.includes(item) : inserter.filters.includes(item));
                return takes ? [{ inserter, index }] : [];
            });
            const positioned = of_lane.every(({ inserter }) => inserter.position !== undefined);
            const takers = of_lane.map(({ inserter, index }, order) => ({
                inserter_id: EntityId.forInserter(inserter.id ?? index + 1).id,
                at: positioned ? along(inserter.position!) : order,
                length: inserter.source.type === "belt"
                    ? pickupLaneLength(inserter.source.pickup_layout ?? "side-straight", lane, inserter.source.pickup_length ?? 1) : 1,
            }));
            // one copy to the next, along the flow: copy_offset where it is given, else the copy's own length from its
            // positions, else a tile for each of its takers
            const step = offset !== undefined ? Math.abs(along(offset))
                : positioned ? Math.max(...positions) - Math.min(...positions) + 1 : takers.length;
            assert(takers.length === 0 || step > 0, `The copies on lane ${lane} of belt ${belt.id} need copy_offset along the lane`);
            if (takers.length === 0) continue;
            const in_part = Math.ceil(part * takers.length - 1e-9);
            const by_place = [...takers].sort((a, b) => a.at - b.at);
            const copy_count = whole + (in_part > 0 ? 1 : 0);
            const placed: { copy: number; inserter_id: string; low: number; high: number }[] = [];
            for (let copy = 0; copy < copy_count; copy++) {
                const of_copy = copy < whole ? by_place : by_place.slice(0, in_part);
                for (const taker of of_copy) {
                    const middle = taker.at + copy * step;
                    placed.push({ copy, inserter_id: taker.inserter_id, low: middle - taker.length / 2, high: middle + taker.length / 2 });
                }
            }
            const entry = Math.min(...placed.map(it => it.low)) - ENTRY_TILES;
            const end = Math.max(...placed.map(it => it.high));
            rows.push({
                belt_id: belt.id, lane, copies: copy_count, length_tiles: end - entry,
                takers: placed.map(it => ({ copy: it.copy, inserter_id: it.inserter_id, edge_tiles: it.high - entry, length_tiles: it.high - it.low })),
            });
        }
    }
    return rows;
}

/** What one inserter of one copy did on the lanes the model ran */
export interface CopyTakerRecord {
    readonly copy: number;
    readonly inserter_id: string;
    readonly hands: readonly HandDropped[];
}

/** The model as installed in a context: the lanes, and what each taker of each copy put down */
export interface SharedLaneRun {
    readonly rows: readonly LaneRow[];
    readonly lanes: readonly SharedLane[];
    readonly takers: readonly CopyTakerRecord[];
    /** The other copies' takers whose control is not a clock: they need what their machine holds, which is not simulated */
    readonly need_machine_state: readonly string[];
}

/** Records the hands an inserter of the simulated copy puts down, from what it has dropped */
class DropRecorder implements CopyTakerTick {
    public readonly hands: HandDropped[] = [];
    private dropped: number;

    constructor(private readonly inserter: InserterArchetype, private readonly now: () => number) {
        this.dropped = inserter.inserter_state.items_dropped;
    }

    public tick(): void {
        const dropped = this.inserter.inserter_state.items_dropped;
        if (dropped > this.dropped) this.hands.push({ tick: this.now(), items: dropped - this.dropped });
        this.dropped = dropped;
    }
}

/** A pickup stock of a lane the model does not run, as the hand's port makes one */
function ownStock(inserter: Inserter, belt_speed: BeltSpeed, lane_end: LaneEnd, lane: 1 | 2, stack_size: number): BeltPickupStock {
    const length = pickupLaneLength(inserter.pickup_layout ?? "side-straight", lane, inserter.pickup_length ?? 1);
    return lane_end.kind === "dead_end"
        ? new BackpressurePickupLane(belt_speed, length, stack_size)
        : new BeltPickupLane(belt_speed, length, stack_size, 0);
}

/**
 * Puts the model into a context before its first tick: each row's lane runs as one `SharedLane`, the simulated copy's
 * takers reach it in place of their own stocks, and each other copy's takers run on it as `CopyTaker`s after the
 * inserters in every tick. A lane of unknown end is not run here: it is run under each end in turn by the caller.
 */
export function installSharedLanes(context: SimulationContext, config: Config, rows: readonly LaneRow[]): SharedLaneRun {
    assert(context.tick_provider.getCurrentTick() === 0, "The shared lanes go in before the first tick");
    const facts = laneFactsOf(config);
    const now = () => context.tick_provider.getCurrentTick();
    const archetypes = new Map(context.inserters.map(inserter => [inserter.entity_id.id, inserter]));
    // each taker's reaches, by copy and inserter, one for each lane the model runs
    const reaches = new Map<string, Map<1 | 2, BeltPickupStock>>();
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
            const key = `${taker.copy}/${taker.inserter_id}`;
            const of_taker = reaches.get(key) ?? new Map<1 | 2, BeltPickupStock>();
            of_taker.set(row.lane, lane.reachOf(taker.edge_tiles, taker.length_tiles));
            reaches.set(key, of_taker);
        }
    }

    const takers: CopyTakerRecord[] = [];
    const need_machine_state = new Set<string>();
    let number = 0;
    for (const [key, of_taker] of reaches) {
        const [copy_text, inserter_id] = key.split("/");
        const copy = Number(copy_text);
        const archetype = archetypes.get(inserter_id);
        assert(archetype !== undefined, `No inserter ${inserter_id} in the simulation`);
        const inserter = archetype.inserter_state.inserter;
        const belt_state = context.state_registry.getStateByEntityIdOrThrow(inserter.source.entity_id);
        assert(EntityState.isBelt(belt_state), `${inserter_id} does not take from a belt`);
        const stocks = belt_state.lanes.map((lane, index) => {
            const at = (index + 1) as 1 | 2;
            return of_taker.get(at) ?? (copy === 0 ? belt_state.pickupsOf(inserter_id)![index]
                : ownStock(inserter, belt_state.belt.belt_speed, facts.of(belt_state.belt.entity_id.number, at).lane_end, at, lane.stack_size));
        });
        if (copy === 0) {
            belt_state.seedPickups(inserter_id, stocks);
            const recorder = new DropRecorder(archetype, now);
            context.copy_takers.push(recorder);
            takers.push({ copy, inserter_id, hands: recorder.hands });
            continue;
        }
        const sink = context.state_registry.getStateByEntityIdOrThrow(inserter.sink.entity_id);
        const taker = new CopyTaker(archetype, copy, 1_000_000 * copy + ++number, belt_state, stocks, sink, context.tick_provider);
        if (!taker.clock_alone) need_machine_state.add(inserter_id);
        context.copy_takers.push(taker);
        takers.push({ copy, inserter_id, hands: taker.dropped });
    }
    return { rows, lanes, takers, need_machine_state: [...need_machine_state] };
}

/**
 * Runs a build on the windows of a clock from a cold start, as `runClockOnBuild` does, with the copies on the rows'
 * lanes (`installSharedLanes`). It judges nothing: it gives what each taker of each copy put down, at the ticks of the
 * run (the clock stands at 0 in its first tick), for a reader to compare.
 */
export function runOnSharedLanes(
    config: Config,
    windows: Map<string, OpenRange[]>,
    window_cycle_ticks: number,
    rows: readonly LaneRow[],
    window_cycles: number,
    logger: Logger,
): SharedLaneRun {
    let model: SharedLaneRun | undefined;
    runClockOnBuild({ ...config, overrides: { ...config.overrides, derive_clock_windows: false } }, windows, window_cycle_ticks, logger, {
        simulate_window_cycles: window_cycles, record_histories: false, factorio_states: false,
        on_context: context => { model = installSharedLanes(context, config, rows); },
    });
    assert(model !== undefined, "The run made no context");
    return model;
}
