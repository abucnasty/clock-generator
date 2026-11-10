import { Config } from "../config";
import { Logger } from "../common/logger";
import { OpenRange } from "../data-types";
import Fraction, { fraction } from "../data-types/fraction";
import { FactorioDataService } from "../data";
import { Entity, EntityId, handSizeFor, Inserter } from "../entities";
import { FlowDirection, LaneEnd, laneFactsOf } from "../entities/traits/lane-facts";
import { fractionOf } from "../entities/traits/ratio";
import { handOfItem, traitsOf, traitsOfMachine } from "../entities/traits/traits-of";
import type { AfterInsertersTick } from "../simulation/world";
import type { MachineState } from "../state/machine-state";
import { SerializableClockWindows } from "./clock";
import { computeMachineTargetRates } from "./machine-target-rates";
import { COPY_NUMBER_STRIDE } from "./sequence/build-copies";
import { OutputCyclePlan } from "./sequence/cycle/output-cycle";
import { targetInsertersOf, targetItemOf, targetMachinesOf } from "./sequence/cycle/target-ends";
import { createEntityRegistryFromConfig, SimulationContext } from "./sequence/simulation-context";
import { DropRecorder, HandDropped, LaidOutLane, LaneRow, recordInserters, runOnSharedLanes, SharedLaneLayout, sharedLaneLayoutOf } from "./shared-lane-model";
import { TargetProductionRate } from "./target-production-rate";
import { longRunWindowCyclesOf, runClockOnBuild } from "./trial";

/**
 * Whether a clock holds on the lanes its copies share. One run holds every copy of the build, each with its own machines
 * and inserters, `copy_offset` apart along the lanes they share; each such lane runs tick by tick with every copy's
 * takers on it, whatever its end (crafting/shared-lane-model.ts). A copy that loses swings there fails the clock.
 *
 * The lanes judged: every lane a belt pickup takes from that the copies share (`sharing`, more than one copy), under its
 * end; a lane of unknown end is run as a dead end and as a free outlet in turn, and the clock has to hold under both. A
 * lane of unknown end that the copies do not share is run with the takers of one copy on it as a dead end (the run of one
 * copy reads it as a free outlet). A belt the build drops onto is left out: its entry would be the drops, which the
 * model does not run (`droppedOntoSharedLanes`).
 *
 * A lane whose belt states its `flow_direction` is run with its items moving that way; a lane whose belt does not is run
 * with them moving each way along the copies in turn, and the clock has to hold both ways. A run whose rows are those of a run
 * made already is not made again: the same rows give the same run.
 *
 * The refill arithmetic of the lane (`refillsInTime`) is worked out on the run of one copy and reported beside the
 * verdict, but it skips nothing: on the samples with their input lanes read as dead ends it said every lane refills in
 * time for clocks under which the model has a copy lose swings, so it proves nothing yet. It never fails a clock alone.
 *
 * Each copy's takers are judged over the whole window cycles of the clock in the second half of a long run, against the
 * same inserter in a run of one copy alone, with a stock of each lane of its own. A taker that puts down fewer items of the
 * lane's item there is short. A copy whose hands come a few ticks after those of the copy alone has one hand unfinished at
 * the end of the judged span: that is a lag, not a loss. In a longer run that hand can fall on another inserter of the
 * copy. Measured on the inserter build of three copies (INSERTER_CRAFTING_240_SHARED_SIGNAL_CLOCK): a clock the game
 * holds is short by one hand or none at 1, 2 and 4 times the run (16, 0 and 16 items); a clock the game fails is short by
 * 1,024, 2,000 and 3,920. So:
 * - no taker short: no loss, and no other run;
 * - a taker short by more than one hand of its own for the lane's item, which the end of the span does not make: a loss,
 *   and no other run;
 * - every taker short by at most one hand: the runs with a shortfall are made again for twice the window cycles. A taker
 *   short there by more than one hand of its own is a loss; a taker short there by at most one hand is a lag.
 * A drift too slow to make a taker short by more than one hand in twice the run passes.
 *
 * A taker short of the run of one copy is not by itself output lost: the copy alone can still be filling a machine's stock
 * in the judged span, and take more there than its steady rate, while a copy on the shared lanes filled it earlier and
 * takes less. Measured on the inserter build (Time-Study Windows on 72 ticks): copy 3's ore inserter is short by 48 items
 * (3 hands), every machine and output inserter of every copy keeps its target rate, and the game holds the clock. What a
 * clock is held to is that each machine meets its target rate, to supply its sink or the output inserters the setpoint
 * counts at. So a loss stands only where, in the same run of the copies and over the same judged window cycles, a machine
 * of a copy is behind its target rate by more than one craft, or an output inserter of a copy by more than one hand
 * (`behindTargetIn`); a part copy's machine is held to the same target as a whole copy's. Where none is, the shortfall is
 * stock moved between the runs, and the clock holds. The condition reads only the runs made above: it adds no run, and a
 * clock that no taker's shortfall fails holds whatever its rates. Where the targets cannot be worked out, the loss stands.
 *
 * What each copy's taker got, and what each copy's machines and output inserters made, is read through one function,
 * `copyLaneTakes`, and nowhere else.
 */

/** What one taker of one copy put down of a lane's item in a run of the copies on their shared lanes */
export interface CopyLaneTake {
    belt_id: number;
    lane: 1 | 2;
    item: string;
    /** The copy, counted from the lane's entry: 0 is the config's own */
    copy: number;
    /** The config's inserter that the copy's taker is a copy of */
    inserter_id: string;
    /** Its hands of the lane's item, at the ticks of the run */
    hands: readonly HandDropped[];
}

/** What one machine of one copy made, or one output inserter of one copy put down of the target's item, in a run of the copies */
export interface CopyMade {
    /** The copy, counted from the lane's entry: 0 is the config's own */
    copy: number;
    kind: "machine" | "output_inserter";
    /** The config's machine or inserter that the copy's is a copy of */
    id: number;
    /** The crafts it finished, or the items it put down, at the ticks of the run */
    counts: readonly { tick: number; amount: number }[];
}

/** The output inserters of a config, by number, and the item of its target: where a copy's output is counted */
interface OutputEnds {
    item: string;
    inserter_ids: ReadonlySet<number>;
}

/** Records the crafts a machine finishes, at the ticks it finishes them */
class CraftRecorder implements AfterInsertersTick {
    public readonly counts: { tick: number; amount: number }[] = [];
    private crafts: number;

    constructor(private readonly machine: MachineState, private readonly now: () => number) {
        this.crafts = machine.craftCount;
    }

    public tick(): void {
        const crafts = this.machine.craftCount;
        if (crafts > this.crafts) this.counts.push({ tick: this.now(), amount: crafts - this.crafts });
        this.crafts = crafts;
    }
}

/** Puts a recorder on every machine of every copy, and on every output inserter of every copy, before the run's first tick */
function recordCopiesMade(context: SimulationContext, ends: OutputEnds | null): () => CopyMade[] {
    const now = () => context.tick_provider.getCurrentTick();
    const made: { copy: number; kind: CopyMade["kind"]; id: number; counts: () => readonly { tick: number; amount: number }[] }[] = [];
    for (const { machine_state } of context.machines) {
        const recorder = new CraftRecorder(machine_state, now);
        context.after_inserters.push(recorder);
        const number = machine_state.machine.entity_id.number;
        made.push({ copy: Math.floor(number / COPY_NUMBER_STRIDE), kind: "machine", id: number % COPY_NUMBER_STRIDE, counts: () => recorder.counts });
    }
    for (const inserter of context.inserters) {
        const number = inserter.entity_id.number;
        if (ends === null || !ends.inserter_ids.has(number % COPY_NUMBER_STRIDE)) continue;
        const recorder = new DropRecorder(inserter, now);
        context.after_inserters.push(recorder);
        made.push({ copy: Math.floor(number / COPY_NUMBER_STRIDE), kind: "output_inserter", id: number % COPY_NUMBER_STRIDE,
            counts: () => recorder.hands.filter(hand => hand.item === ends.item).map(hand => ({ tick: hand.tick, amount: hand.items })) });
    }
    return () => made.map(({ counts, ...it }) => ({ ...it, counts: counts() }));
}

/**
 * What each copy's pickup inserter got on each shared lane: the hands of the lane's item each taker of each copy put down
 * in a run of the clock with every copy of the layout built and the rows' lanes shared, and the run's last tick; and, in
 * the same run, the crafts of each copy's machines and the items of the target each copy's output inserters put down
 * (`made`). The verdict reads the copies' figures here alone, so that where they come from can change in this function only.
 */
export function copyLaneTakes(config: Config, windows: Map<string, OpenRange[]>, window_cycle_ticks: number, layout: SharedLaneLayout,
    window_cycles: number, logger: Logger, ends: OutputEnds | null = null): { takes: CopyLaneTake[]; made: CopyMade[]; last_tick: number } {
    let madeOf = (): CopyMade[] => [];
    const model = runOnSharedLanes(config, windows, window_cycle_ticks, layout, window_cycles, logger, context => { madeOf = recordCopiesMade(context, ends); });
    let last_tick = 0;
    const takes = layout.rows.flatMap(row => {
        const item = config.belts.find(belt => belt.id === row.belt_id)!.lanes[row.lane - 1].ingredient;
        return row.takers.flatMap(taker => {
            const record = model.takers.find(it => it.copy === taker.copy && it.inserter_id === taker.inserter_id);
            if (record === undefined) return [];
            last_tick = Math.max(last_tick, record.last_tick);
            return [{ belt_id: row.belt_id, lane: row.lane, item, copy: taker.copy, inserter_id: taker.inserter_id, hands: record.hands.filter(hand => hand.item === item) }];
        });
    });
    return { takes, made: madeOf(), last_tick };
}

/** One taker of one copy that loses swings on a lane the copies share */
export interface SharedLaneLoss {
    belt_id: number;
    /** The lane, 1 or 2 */
    lane: number;
    lane_end: LaneEnd["kind"];
    /** The end the lane was run under, for a lane of unknown end: a dead end or an outlet */
    run_as: "dead_end" | "outlet";
    item: string;
    /** Copies that take from the lane, as the config counts them (5.5); one on a lane only one copy takes from */
    copies: number;
    /** The copy, counted from the lane's entry: 1 is the config's own */
    copy: number;
    inserter_id: number;
    /** Items of the lane's item the taker put down in the judged window cycles */
    items: number;
    /** What the inserter put down in them in a run of one copy alone */
    alone_items: number;
    window_cycles: number;
    /** The way the items flow, as a map direction */
    flow: FlowDirection;
    /**
     * The machine or output inserter furthest behind its target rate in the same run of the copies, which makes the
     * shortfall a loss; absent only where the targets could not be worked out
     */
    behind?: BehindTarget;
    /** The sentence the result shows */
    text: string;
}

/** A machine or an output inserter of a copy behind its target rate over the judged window cycles of a run of the copies */
export interface BehindTarget {
    /** The copy, counted from the lane's entry: 1 is the config's own */
    copy: number;
    kind: "machine" | "output_inserter";
    /** The config's machine or inserter */
    id: number;
    /** Crafts it finished, or items of the target it put down, in the judged window cycles */
    made: number;
    /** What its target rate makes or puts down in them */
    target: number;
    /** Crafts behind for a machine, hands behind for an output inserter: more than one */
    behind: number;
}

/** What the fast check and the model said of one clock, for a comparison of the two */
export interface SharedLaneJudgement {
    losses: SharedLaneLoss[];
    /** Whether the refill arithmetic says every lane refills in time after every enable window (reported; it skips nothing) */
    fast_check_passes: boolean;
    /** Whether the model ran */
    simulated: boolean;
    /**
     * Whether the copies were run again for twice the window cycles: only where some taker was short in the first run, and
     * none by more than one hand
     */
    longer_run: boolean;
    /** Lanes the model runs, by "belt/lane" */
    lanes: string[];
}

/** A lane the model runs: whether the copies share it, its end, and the way its items move where the config states it */
interface ModelLane {
    belt_id: number;
    lane: 1 | 2;
    shared: boolean;
    stated: LaneEnd;
    flow: FlowDirection | null;
}

/** The belts an inserter of the config drops onto */
function droppedOnto(config: Config): Set<number> {
    return new Set(config.inserters.flatMap(inserter => inserter.sink.type === "belt" ? [inserter.sink.id] : []));
}

/** The lanes a belt pickup of the config takes an item from: each belt's lanes with an item and a taker of it */
function takenLanesOf(config: Config): { belt_id: number; lane: 1 | 2 }[] {
    return config.belts.flatMap(belt => ([1, 2] as const).flatMap(lane => {
        const item = belt.lanes[lane - 1]?.ingredient;
        if (item === undefined || item === "") return [];
        const taken = config.inserters.some(inserter => inserter.source.type === "belt" && inserter.source.id === belt.id
            && (inserter.filters === undefined || inserter.filters.length === 0
                || (inserter.filter_mode === "blacklist" ? !inserter.filters.includes(item) : inserter.filters.includes(item))));
        return taken ? [{ belt_id: belt.id, lane }] : [];
    }));
}

/** The lanes the model judges (see the module's description) */
function modelLanesOf(config: Config): ModelLane[] {
    const facts = laneFactsOf(config);
    const dropped = droppedOnto(config);
    return takenLanesOf(config).flatMap(({ belt_id, lane }) => {
        if (dropped.has(belt_id)) return [];
        const lane_facts = facts.of(belt_id, lane);
        const shared = lane_facts.sharing === "shared_by_copies" && config.setpoint.copies > 1;
        if (!shared && lane_facts.lane_end.kind !== "unknown") return [];
        return [{ belt_id, lane, shared, stated: lane_facts.lane_end, flow: lane_facts.flow_direction }];
    });
}

/**
 * The lanes the copies share that the model leaves out because the build drops onto their belt, for the result to name
 * as not checked
 */
export function droppedOntoSharedLanes(config: Config): { belt_id: number; lane: 1 | 2 }[] {
    if (!(config.setpoint.copies > 1)) return [];
    const facts = laneFactsOf(config);
    const dropped = droppedOnto(config);
    return takenLanesOf(config).filter(({ belt_id, lane }) => dropped.has(belt_id) && facts.of(belt_id, lane).sharing === "shared_by_copies");
}

/**
 * The spacing the check of the shared lanes puts the copies at on each lane they share, where the config does not give
 * `copy_offset`: the copy's length from its positions, or the width of a copy (`sharedLaneLayoutOf`). Empty where the
 * config gives it, or no lane is shared.
 */
export function assumedCopySpacings(config: Config): { belt_id: number; lane: 1 | 2; tiles: number }[] {
    if (config.setpoint.copy_offset !== undefined) return [];
    const lanes = modelLanesOf(config).filter(lane => lane.shared);
    if (lanes.length === 0) return [];
    try {
        return sharedLaneLayoutOf(config, laidOutLanesOf(config, lanes)[0]).rows.map(row => ({ belt_id: row.belt_id, lane: row.lane, tiles: row.step_tiles }));
    } catch {
        return [];
    }
}

/**
 * The config with each lane of unknown end as one reading has it: a dead end in reading 0, a free outlet in reading 1.
 * A lane of known end is run as it is.
 */
function configUnder(config: Config, lanes: readonly ModelLane[], reading: number): Config {
    return { ...config, belts: config.belts.map(belt => {
        const unknown = lanes.filter(lane => lane.belt_id === belt.id && lane.stated.kind === "unknown");
        if (unknown.length === 0) return belt;
        return { ...belt, lanes: belt.lanes.map((lane, index) => {
            const model = unknown.find(it => it.lane === index + 1);
            if (model === undefined) return lane;
            // a lane the copies do not share is run as a dead end only: the run of one copy reads it as a free outlet
            return { ...lane, lane_end: reading === 1 && model.shared ? { kind: "outlet" } : { kind: "dead_end" } };
        }) as typeof belt.lanes };
    }) };
}

/** The axis along which the copies stand: copy_offset's, else the one the takers of belts spread along most, else x */
function rowAxisOf(config: Config): FlowDirection {
    const offset = config.setpoint.copy_offset;
    if (offset !== undefined && (offset.x !== 0 || offset.y !== 0)) {
        return Math.abs(offset.x) >= Math.abs(offset.y) ? { x: 1, y: 0 } : { x: 0, y: 1 };
    }
    const positions = config.inserters.flatMap(inserter => inserter.source.type === "belt" && inserter.position !== undefined ? [inserter.position] : []);
    const spread = (values: number[]) => values.length === 0 ? 0 : Math.max(...values) - Math.min(...values);
    return spread(positions.map(it => it.y)) > spread(positions.map(it => it.x)) ? { x: 0, y: 1 } : { x: 1, y: 0 };
}

/**
 * The lanes laid out for each way the run has the items move: a lane whose belt states its flow direction keeps it, and
 * every other lane has its items move along the copies' axis, then against it
 */
function laidOutLanesOf(config: Config, lanes: readonly ModelLane[]): LaidOutLane[][] {
    const axis = rowAxisOf(config);
    const ways = lanes.every(lane => lane.flow !== null) ? [axis] : [axis, { x: -axis.x, y: -axis.y }];
    return ways.map(way => lanes.map(({ belt_id, lane, shared, flow }) => ({ belt_id, lane, shared, flow: flow ?? way })));
}

/** The ticks from one enable window of the lane's takers opening to the next, and the window each tick belongs to */
interface LaneWindow { start: number; end: number }

/** The enable windows of a lane's takers as the lane sees them: theirs joined where they touch or overlap, by when they open */
function laneWindowsOf(ranges: readonly { start: number; end: number }[], window_cycle_ticks: number): LaneWindow[] {
    const joined: LaneWindow[] = [];
    for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
        const last = joined[joined.length - 1];
        if (last !== undefined && range.start <= last.end + 1) last.end = Math.max(last.end, range.end);
        else joined.push({ start: range.start, end: range.end });
    }
    // a window that runs over the end of the window cycle goes on at its beginning: it opens at its later part
    if (joined.length > 1 && joined[0].start === 0 && joined[joined.length - 1].end >= window_cycle_ticks - 1) {
        const first = joined.shift()!;
        joined[joined.length - 1].end = first.end;
    }
    return joined;
}

/** Ticks from window `k` opening to the next window opening */
function gapOf(windows: readonly LaneWindow[], k: number, window_cycle_ticks: number): number {
    return k + 1 < windows.length ? windows[k + 1].start - windows[k].start : windows[0].start + window_cycle_ticks - windows[k].start;
}

/** The window a tick of the window cycle belongs to: the last that opened at or before it, the last of the window cycle before the first */
function windowAt(windows: readonly LaneWindow[], position: number): number {
    let found = windows.length - 1;
    for (let k = 0; k < windows.length && windows[k].start <= position; k++) found = k;
    return found;
}

/**
 * The refill arithmetic of the lanes that carry one item of one belt (the rule #725 was found with): in each opening of an
 * enable window of their takers, every taker of every copy takes what the same inserter took in that opening in the run of
 * one copy; the lanes bring those items back at their supply rate. Whether they are back before the next window opens,
 * after every opening of the judged half; a refill exactly as long as the gap passes.
 */
function refillsInTime(rows: readonly LaneRow[], supply_per_second: Fraction, pickups: ReadonlyMap<string, readonly HandDropped[]>,
    item: string, clock_windows: SerializableClockWindows, window_cycle_ticks: number, from: number, last_tick: number): boolean {
    const takers = rows.flatMap(row => row.takers);
    const ids = [...new Set(takers.map(taker => taker.inserter_id))];
    const windows = laneWindowsOf(ids.flatMap(id => clock_windows[id] ?? [{ start: 0, end: Math.ceil(window_cycle_ticks) - 1 }]), window_cycle_ticks);
    if (windows.length === 0) return true;
    // what one inserter took in each opening, then summed over every taker of every copy
    const per_opening = new Map<string, number>();
    for (const taker of takers) {
        for (const pickup of pickups.get(taker.inserter_id) ?? []) {
            if (pickup.item !== item) continue;
            const k = windowAt(windows, pickup.tick % window_cycle_ticks);
            const opening = Math.floor((pickup.tick - windows[k].start) / window_cycle_ticks);
            const opens_at = opening * window_cycle_ticks + windows[k].start;
            if (opens_at < from || opens_at + gapOf(windows, k, window_cycle_ticks) > last_tick) continue;
            per_opening.set(`${opening}/${k}`, (per_opening.get(`${opening}/${k}`) ?? 0) + pickup.items);
        }
    }
    const per_tick = supply_per_second.divide(60);
    for (const [key, items] of per_opening) {
        const k = Number(key.split("/")[1]);
        const refill = fraction(items).divide(per_tick), gap = gapOf(windows, k, window_cycle_ticks);
        if (Number.isInteger(gap) ? refill.subtract(gap).getNumerator > 0 : refill.toDecimal() > gap) return false;
    }
    return true;
}

/** A map direction as a word: east, west, south or north */
function directionWord(flow: FlowDirection): string {
    return flow.x > 0 ? "east" : flow.x < 0 ? "west" : flow.y > 0 ? "south" : "north";
}

/** "1,234" */
const counted = (value: number) => value.toLocaleString("en-US");

/**
 * "In the same run, machine 2 of copy 3 is 1,536 crafts behind its target rate." The copy is named where the lane's
 * copies are, or where the copy is not the config's own.
 */
function describeBehind(behind: BehindTarget, copies: number): string {
    const entity = behind.kind === "machine" ? `machine ${behind.id}` : `output inserter ${behind.id}`;
    const of_copy = copies === 1 && behind.copy === 1 ? "" : ` of copy ${behind.copy}`;
    const amount = behind.behind.toLocaleString("en-US", { maximumFractionDigits: 1 });
    return `In the same run, ${entity}${of_copy} is ${amount} ${behind.kind === "machine" ? "crafts" : "hands"} behind its target rate.`;
}

/**
 * "Lane 1 of belt 2 ends in a dead end. The 6 copies take advanced circuit from it. When the items move east, copy 3 from
 * the entry does not get sufficient items. Its inserter 3 takes 2,240 in 50 window cycles. With no other copy on the lane, it
 * takes 3,360. In the same run, machine 2 of copy 3 is 1,536 crafts behind its target rate." One fact a sentence; the
 * game's names of items have no plural.
 */
function describeSharedLaneLoss(loss: Omit<SharedLaneLoss, "text">): string {
    const run_as = loss.run_as === "dead_end" ? "a dead end" : "an outlet";
    const end = loss.lane_end === "unknown" ? `has an unknown end. It is checked as ${run_as}.` : `ends in ${run_as}.`;
    const item = FactorioDataService.isAvailable() ? FactorioDataService.itemNameInSentence(loss.item) : loss.item;
    const counts = `takes ${counted(loss.items)} in ${loss.window_cycles} window cycles.`;
    const behind = loss.behind === undefined ? "" : ` ${describeBehind(loss.behind, loss.copies)}`;
    if (loss.copies === 1) {
        return `Lane ${loss.lane} of belt ${loss.belt_id} ${end} The build takes ${item} from it. `
            + `When the items move ${directionWord(loss.flow)}, inserter ${loss.inserter_id} does not get sufficient items. `
            + `It ${counts} With no other inserter on the lane, it takes ${counted(loss.alone_items)}.${behind}`;
    }
    return `Lane ${loss.lane} of belt ${loss.belt_id} ${end} The ${loss.copies} copies take ${item} from it. `
        + `When the items move ${directionWord(loss.flow)}, copy ${loss.copy} from the entry does not get sufficient items. `
        + `Its inserter ${loss.inserter_id} ${counts} With no other copy on the lane, it takes ${counted(loss.alone_items)}.${behind}`;
}

/** The tick window cycle `k` of the clock starts in: the clock stands at 0 in the run's first tick */
const cycleStart = (k: number, window_cycle_ticks: number) => Math.ceil(k * window_cycle_ticks - 1e-9);

/** Items of the hands put down from tick `from` up to, not including, tick `to` */
const itemsIn = (hands: readonly HandDropped[], from: number, to: number) =>
    hands.reduce((sum, hand) => hand.tick >= from && hand.tick < to ? sum + hand.items : sum, 0);

/** What one taker of one copy put down short of the run of one copy, over the judged window cycles of one run of the copies */
interface Shortfall {
    /** Items short of the run of one copy */
    short: number;
    /** One hand of the taker for the lane's item */
    hand: number;
    loss: Omit<SharedLaneLoss, "text">;
}

/** The run of one copy alone: what each taker put down, the run's last tick, and the hand of each taker for an item */
interface AloneRun {
    recorders: Map<string, DropRecorder>;
    last_tick: number;
    handOf: (inserter_id: string, item: string) => number;
}

/** Runs one copy alone, with a stock of each lane of its own, recording the takers named */
function runAlone(under: Config, taker_ids: readonly string[], windows: Map<string, OpenRange[]>, window_cycle_ticks: number,
    window_cycles: number, logger: Logger): AloneRun {
    let recorders = new Map<string, DropRecorder>();
    let takers = new Map<string, Inserter>();
    runClockOnBuild({ ...under, overrides: { ...under.overrides, derive_clock_windows: false } }, windows, window_cycle_ticks, logger, {
        simulate_window_cycles: window_cycles, record_histories: false, factorio_states: false,
        on_context: context => {
            recorders = recordInserters(context, taker_ids);
            takers = new Map(context.inserters.filter(it => taker_ids.includes(it.entity_id.id)).map(it => [it.entity_id.id, it.inserter_state.inserter]));
        },
    });
    const last_tick = Math.max(0, ...[...recorders.values()].map(recorder => recorder.last_tick));
    return { recorders, last_tick, handOf: (inserter_id, item) => handSizeFor(takers.get(inserter_id)!, item) };
}

/** One run of the copies, read over its judged window cycles: the takers short of the run of one copy, and what each copy made */
interface RunOfCopies {
    shortfalls: Shortfall[];
    made: CopyMade[];
    /** The judged window cycles, from the tick `from` up to, not including, the tick `to` */
    from: number;
    to: number;
}

/**
 * The takers of the copies that put down fewer items of their lane's item than the run of one copy alone, over the whole
 * window cycles of the clock in the second half of both runs, and what each copy's machines and output inserters made
 */
function shortfallsOf(under: Config, lanes: readonly ModelLane[], layout: SharedLaneLayout, alone: AloneRun, windows: Map<string, OpenRange[]>,
    window_cycle_ticks: number, window_cycles: number, logger: Logger, ends: OutputEnds | null): RunOfCopies {
    const facts = laneFactsOf(under);
    const { takes, made, last_tick } = copyLaneTakes(under, windows, window_cycle_ticks, layout, window_cycles, logger, ends);
    const last = Math.min(alone.last_tick, last_tick);
    const first_cycle = Math.ceil(last / 2 / window_cycle_ticks), end_cycle = Math.floor((last + 1) / window_cycle_ticks + 1e-9);
    const from = cycleStart(first_cycle, window_cycle_ticks), to = cycleStart(end_cycle, window_cycle_ticks);
    if (end_cycle <= first_cycle) return { shortfalls: [], made, from, to };
    const shortfalls = takes.flatMap(take => {
        const alone_items = itemsIn((alone.recorders.get(take.inserter_id)?.hands ?? []).filter(hand => hand.item === take.item), from, to);
        const items = itemsIn(take.hands, from, to);
        if (items >= alone_items) return [];
        const lane = lanes.find(it => it.belt_id === take.belt_id && it.lane === take.lane)!;
        const row = layout.rows.find(it => it.belt_id === take.belt_id && it.lane === take.lane)!;
        const run_as = facts.of(take.belt_id, take.lane).lane_end.kind === "dead_end" ? "dead_end" as const : "outlet" as const;
        const loss = { belt_id: take.belt_id, lane: take.lane, lane_end: lane.stated.kind, run_as, item: take.item,
            copies: lane.shared ? under.setpoint.copies : 1, copy: take.copy + 1,
            inserter_id: Number(take.inserter_id.slice("inserter:".length)), items, alone_items,
            window_cycles: end_cycle - first_cycle, flow: row.flow };
        return [{ short: alone_items - items, hand: alone.handOf(take.inserter_id, take.item), loss }];
    });
    return { shortfalls, made, from, to };
}

/** The output inserters of a config and the item of its target (target-ends.ts); null where they cannot be worked out */
function outputEndsOf(config: Config): OutputEnds | null {
    try {
        const registry = createEntityRegistryFromConfig(config);
        const target = targetItemOf(config.setpoint);
        const inserter_ids = new Set(targetMachinesOf(target, registry).flatMap(machine => targetInsertersOf(machine, target, registry).map(inserter => inserter.entity_id.number)));
        return { item: target.item, inserter_ids };
    } catch {
        return null;
    }
}

/** The target rates of one copy: crafts a second of each machine, and items of the target a second of each output inserter, with its hand */
interface TargetRates {
    crafts_per_second: ReadonlyMap<number, number>;
    output_inserters: ReadonlyMap<number, { items_per_second: number; hand: number }>;
}

/**
 * The target rates of one copy of the config: each machine's from the planner's at-target rates (`computeMachineTargetRates`)
 * over what one of its crafts makes of its main product, and each output inserter's from the output cycle's transfers of the
 * target's item. Null where the planner cannot work them out.
 */
function targetRatesOf(config: Config, ends: OutputEnds): TargetRates | null {
    try {
        const traits = traitsOf(config);
        const crafts_per_second = new Map(computeMachineTargetRates(config).map(rate => [rate.machine_id,
            rate.output_rate_per_second / traitsOfMachine(traits, EntityId.forMachine(rate.machine_id).id).yield.results[0].expected_per_craft]));
        const registry = createEntityRegistryFromConfig(config);
        const cycle = OutputCyclePlan.create(TargetProductionRate.fromConfig(config.setpoint), registry, config, fraction(1));
        const seconds = cycle.total_duration_ticks.divide(60);
        const output_inserters = new Map<number, { items_per_second: number; hand: number }>();
        for (const transfer of cycle.entity_transfer_map.values()) {
            const number = transfer.entity.entity_id.number;
            if (!Entity.isInserter(transfer.entity) || !ends.inserter_ids.has(number)) continue;
            const of_target = transfer.item_transfers.find(it => it.item_name === ends.item);
            if (of_target === undefined) continue;
            const hand = handOfItem(traits, transfer.entity.entity_id.id, ends.item);
            output_inserters.set(number, { items_per_second: of_target.transfer_count.multiply(hand).divide(seconds).toDecimal(), hand });
        }
        return { crafts_per_second, output_inserters };
    } catch {
        return null;
    }
}

/** The rounding of a float rate times a span, below which a figure counts as on its target: not an allowance */
const ROUNDING = 1e-9;

/**
 * The machines of every copy behind their target rate by more than one craft, and the output inserters of every copy
 * behind theirs by more than one hand, over the judged window cycles of one run of the copies; the furthest behind first.
 * A part copy's machine is held to the same target as a whole copy's.
 */
function behindTargetIn(run: RunOfCopies, rates: TargetRates): BehindTarget[] {
    const seconds = (run.to - run.from) / 60;
    return run.made.flatMap(({ copy, kind, id, counts }): BehindTarget[] => {
        const made = counts.reduce((sum, it) => it.tick >= run.from && it.tick < run.to ? sum + it.amount : sum, 0);
        if (kind === "machine") {
            const rate = rates.crafts_per_second.get(id);
            if (rate === undefined) return [];
            const target = rate * seconds;
            return target - made > 1 + ROUNDING ? [{ copy: copy + 1, kind, id, made, target, behind: target - made }] : [];
        }
        const output = rates.output_inserters.get(id);
        if (output === undefined) return [];
        const target = output.items_per_second * seconds;
        const behind = (target - made) / output.hand;
        return behind > 1 + ROUNDING ? [{ copy: copy + 1, kind, id, made, target, behind }] : [];
    }).sort((a, b) => b.behind - a.behind);
}

/**
 * Judges a clock on the lanes its copies share (see the module's description). The runs it makes are decided by the
 * takers' shortfalls alone; a loss they find stands only where a machine or an output inserter of a copy is behind its
 * target rate in the same run (`standing`).
 */
export function judgeSharedLanes(config: Config, clock_windows: SerializableClockWindows, window_cycle_ticks: number, logger: Logger): SharedLaneJudgement {
    const lanes = modelLanesOf(config);
    const keys = lanes.map(lane => `${lane.belt_id}/${lane.lane}`);
    if (lanes.length === 0) return { losses: [], fast_check_passes: true, simulated: false, longer_run: false, lanes: keys };
    const windows = new Map(Object.entries(clock_windows).map(([id, ranges]) => [id, ranges.map(range => OpenRange.from(range.start, range.end))] as const));
    const window_cycles = longRunWindowCyclesOf(window_cycle_ticks);
    const readings = lanes.some(lane => lane.stated.kind === "unknown" && lane.shared) ? 2 : 1;
    const ends = outputEndsOf(config);
    // the target rates, worked out once and only where a taker's shortfall is a loss
    let rates: TargetRates | null | undefined;
    /**
     * The losses the takers of one run of the copies make that stand: each with the machine or output inserter furthest
     * behind its target in that run, of the loss's own copy where one of it is behind, and none where none is behind
     * (stock moved between the runs, not output lost). Where the target rates cannot be worked out, every loss stands as
     * the takers make it.
     */
    const standing = (run: RunOfCopies, losses: Omit<SharedLaneLoss, "text">[]): Omit<SharedLaneLoss, "text">[] => {
        if (losses.length === 0) return [];
        if (rates === undefined) rates = ends === null ? null : targetRatesOf(config, ends);
        if (rates === null) return losses;
        const behind = behindTargetIn(run, rates);
        return behind.length === 0 ? [] : losses.map(loss => ({ ...loss, behind: behind.find(it => it.copy === loss.copy) ?? behind[0] }));
    };
    // the first run of each reading: the run of one copy, and the copies on each layout of the lanes, with their shortfalls
    const first: { under: Config; taker_ids: string[]; runs: { layout: SharedLaneLayout; run: RunOfCopies }[] }[] = [];
    let fast_check_passes = true;
    for (let reading = 0; reading < readings; reading++) {
        const under = configUnder(config, lanes, reading);
        const facts = laneFactsOf(under);
        // a layout whose rows are those of one run already is not run again: the same rows give the same run
        const layouts = [...new Map(laidOutLanesOf(under, lanes).map(laid => sharedLaneLayoutOf(under, laid)).map(layout => [JSON.stringify(layout), layout])).values()];
        const taker_ids = [...new Set(layouts[0].rows.flatMap(row => row.takers.map(taker => taker.inserter_id)))];
        const alone = runAlone(under, taker_ids, windows, window_cycle_ticks, window_cycles, logger);
        // the fast check, for each item of each belt: the lanes that carry it, their supply summed
        const pickups = new Map([...alone.recorders].map(([id, recorder]) => [id, recorder.pickups]));
        const from_tick = cycleStart(Math.ceil(alone.last_tick / 2 / window_cycle_ticks), window_cycle_ticks);
        const groups = new Map<string, { rows: LaneRow[]; supply: Fraction; item: string }>();
        for (const row of layouts[0].rows) {
            const item = under.belts.find(belt => belt.id === row.belt_id)!.lanes[row.lane - 1].ingredient;
            const key = `${row.belt_id}/${item}`;
            const group = groups.get(key) ?? { rows: [], supply: fraction(0), item };
            group.rows.push(row);
            group.supply = group.supply.add(fractionOf(facts.of(row.belt_id, row.lane).supply_rate));
            groups.set(key, group);
        }
        fast_check_passes &&= [...groups.values()].every(group => refillsInTime(group.rows, group.supply, pickups, group.item, clock_windows, window_cycle_ticks, from_tick, alone.last_tick));
        first.push({ under, taker_ids, runs: layouts.map(layout => ({ layout, run: shortfallsOf(under, lanes, layout, alone, windows, window_cycle_ticks, window_cycles, logger, ends) })) });
    }
    const shortfalls = first.flatMap(it => it.runs.flatMap(({ run }) => run.shortfalls));
    const judged = (losses: Omit<SharedLaneLoss, "text">[], longer_run: boolean): SharedLaneJudgement => ({
        // the worst first: the most items short of the run of one copy
        losses: losses.map(loss => ({ ...loss, text: describeSharedLaneLoss(loss) })).sort((a, b) => (b.alone_items - b.items) - (a.alone_items - a.items)),
        fast_check_passes, simulated: true, longer_run, lanes: keys,
    });
    // no taker short, or one short by more than a hand, which the end of the judged span does not make: judged as it is,
    // each run's losses standing where a machine or an output inserter of that run is behind its target
    if (shortfalls.length === 0 || shortfalls.some(it => it.short > it.hand)) {
        return judged(first.flatMap(it => it.runs.flatMap(({ run }) => standing(run, run.shortfalls.map(shortfall => shortfall.loss)))), false);
    }
    // every taker short by at most one hand: the runs with a shortfall again, twice as long, and a loss where a taker is
    // short there by more than one hand of its own (the unfinished hand at the span's end can fall on another taker) and a
    // machine or an output inserter of the longer run is behind its target
    const losses: Omit<SharedLaneLoss, "text">[] = [];
    for (const { under, taker_ids, runs } of first) {
        const short_runs = runs.filter(({ run }) => run.shortfalls.length > 0);
        if (short_runs.length === 0) continue;
        const alone = runAlone(under, taker_ids, windows, window_cycle_ticks, 2 * window_cycles, logger);
        for (const { layout } of short_runs) {
            const longer = shortfallsOf(under, lanes, layout, alone, windows, window_cycle_ticks, 2 * window_cycles, logger, ends);
            losses.push(...standing(longer, longer.shortfalls.filter(shortfall => shortfall.short > shortfall.hand).map(shortfall => shortfall.loss)));
        }
    }
    return judged(losses, true);
}
