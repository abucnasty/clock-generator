import { Config } from "../config";
import { Logger } from "../common/logger";
import { OpenRange } from "../data-types";
import Fraction, { fraction } from "../data-types/fraction";
import { FactorioDataService } from "../data";
import { FlowDirection, LaneEnd, laneFactsOf } from "../entities/traits/lane-facts";
import { fractionOf } from "../entities/traits/ratio";
import { SerializableClockWindows } from "./clock";
import { DropRecorder, HandDropped, LaidOutLane, LaneRow, recordInserters, runOnSharedLanes, SharedLaneLayout, sharedLaneLayoutOf } from "./shared-lane-model";
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
 * Each copy's takers are judged over the whole window cycles of the clock in the second half of a long run: a taker that
 * puts down fewer items of the lane's item than the same inserter does in a run of one copy alone, with a stock of each
 * lane of its own, loses swings. What each copy's taker got is read through one function, `copyLaneTakes`, and nowhere
 * else.
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

/**
 * What each copy's pickup inserter got on each shared lane: the hands of the lane's item each taker of each copy put down
 * in a run of the clock with every copy of the layout built and the rows' lanes shared, and the run's last tick. The
 * verdict reads the copies' figures here alone, so that where they come from can change in this function only.
 */
export function copyLaneTakes(config: Config, windows: Map<string, OpenRange[]>, window_cycle_ticks: number, layout: SharedLaneLayout,
    window_cycles: number, logger: Logger): { takes: CopyLaneTake[]; last_tick: number } {
    const model = runOnSharedLanes(config, windows, window_cycle_ticks, layout, window_cycles, logger);
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
    return { takes, last_tick };
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
    /** The sentence the result shows */
    text: string;
}

/** What the fast check and the model said of one clock, for a comparison of the two */
export interface SharedLaneJudgement {
    losses: SharedLaneLoss[];
    /** Whether the refill arithmetic says every lane refills in time after every enable window (reported; it skips nothing) */
    fast_check_passes: boolean;
    /** Whether the model ran */
    simulated: boolean;
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
 * "Lane 1 of belt 2 ends in a dead end. The 6 copies take advanced circuit from it. When the items move east, copy 3 from
 * the entry does not get sufficient items. Its inserter 3 takes 2,240 in 50 window cycles. With no other copy on the lane, it
 * takes 3,360." One fact a sentence; the game's names of items have no plural.
 */
function describeSharedLaneLoss(loss: Omit<SharedLaneLoss, "text">): string {
    const run_as = loss.run_as === "dead_end" ? "a dead end" : "an outlet";
    const end = loss.lane_end === "unknown" ? `has an unknown end. It is checked as ${run_as}.` : `ends in ${run_as}.`;
    const item = FactorioDataService.isAvailable() ? FactorioDataService.itemNameInSentence(loss.item) : loss.item;
    const counts = `takes ${counted(loss.items)} in ${loss.window_cycles} window cycles.`;
    if (loss.copies === 1) {
        return `Lane ${loss.lane} of belt ${loss.belt_id} ${end} The build takes ${item} from it. `
            + `When the items move ${directionWord(loss.flow)}, inserter ${loss.inserter_id} does not get sufficient items. `
            + `It ${counts} With no other inserter on the lane, it takes ${counted(loss.alone_items)}.`;
    }
    return `Lane ${loss.lane} of belt ${loss.belt_id} ${end} The ${loss.copies} copies take ${item} from it. `
        + `When the items move ${directionWord(loss.flow)}, copy ${loss.copy} from the entry does not get sufficient items. `
        + `Its inserter ${loss.inserter_id} ${counts} With no other copy on the lane, it takes ${counted(loss.alone_items)}.`;
}

/** The tick window cycle `k` of the clock starts in: the clock stands at 0 in the run's first tick */
const cycleStart = (k: number, window_cycle_ticks: number) => Math.ceil(k * window_cycle_ticks - 1e-9);

/** Items of the hands put down from tick `from` up to, not including, tick `to` */
const itemsIn = (hands: readonly HandDropped[], from: number, to: number) =>
    hands.reduce((sum, hand) => hand.tick >= from && hand.tick < to ? sum + hand.items : sum, 0);

/** Judges a clock on the lanes its copies share (see the module's description) */
export function judgeSharedLanes(config: Config, clock_windows: SerializableClockWindows, window_cycle_ticks: number, logger: Logger): SharedLaneJudgement {
    const lanes = modelLanesOf(config);
    const keys = lanes.map(lane => `${lane.belt_id}/${lane.lane}`);
    if (lanes.length === 0) return { losses: [], fast_check_passes: true, simulated: false, lanes: keys };
    const windows = new Map(Object.entries(clock_windows).map(([id, ranges]) => [id, ranges.map(range => OpenRange.from(range.start, range.end))] as const));
    const window_cycles = longRunWindowCyclesOf(window_cycle_ticks);
    const readings = lanes.some(lane => lane.stated.kind === "unknown" && lane.shared) ? 2 : 1;
    const losses: SharedLaneLoss[] = [];
    let fast_check_passes = true;
    for (let reading = 0; reading < readings; reading++) {
        const under = configUnder(config, lanes, reading);
        const facts = laneFactsOf(under);
        const layouts = laidOutLanesOf(under, lanes).map(laid => sharedLaneLayoutOf(under, laid));
        // the run of one copy: what each taker takes and puts down with a stock of each lane of its own
        const taker_ids = [...new Set(layouts[0].rows.flatMap(row => row.takers.map(taker => taker.inserter_id)))];
        let recorders = new Map<string, DropRecorder>();
        runClockOnBuild({ ...under, overrides: { ...under.overrides, derive_clock_windows: false } }, windows, window_cycle_ticks, logger, {
            simulate_window_cycles: window_cycles, record_histories: false, factorio_states: false,
            on_context: context => { recorders = recordInserters(context, taker_ids); },
        });
        const alone_last = Math.max(0, ...[...recorders.values()].map(recorder => recorder.last_tick));
        // the fast check, for each item of each belt: the lanes that carry it, their supply summed
        const pickups = new Map([...recorders].map(([id, recorder]) => [id, recorder.pickups]));
        const from_tick = cycleStart(Math.ceil(alone_last / 2 / window_cycle_ticks), window_cycle_ticks);
        const groups = new Map<string, { rows: LaneRow[]; supply: Fraction; item: string }>();
        for (const row of layouts[0].rows) {
            const item = under.belts.find(belt => belt.id === row.belt_id)!.lanes[row.lane - 1].ingredient;
            const key = `${row.belt_id}/${item}`;
            const group = groups.get(key) ?? { rows: [], supply: fraction(0), item };
            group.rows.push(row);
            group.supply = group.supply.add(fractionOf(facts.of(row.belt_id, row.lane).supply_rate));
            groups.set(key, group);
        }
        fast_check_passes &&= [...groups.values()].every(group => refillsInTime(group.rows, group.supply, pickups, group.item, clock_windows, window_cycle_ticks, from_tick, alone_last));
        const run_rows = new Set<string>();
        for (const layout of layouts) {
            const rows_key = JSON.stringify(layout);
            if (run_rows.has(rows_key)) continue;
            run_rows.add(rows_key);
            const { takes, last_tick } = copyLaneTakes(under, windows, window_cycle_ticks, layout, window_cycles, logger);
            // whole window cycles of the clock in the second half of both runs
            const last = Math.min(alone_last, last_tick);
            const first_cycle = Math.ceil(last / 2 / window_cycle_ticks), end_cycle = Math.floor((last + 1) / window_cycle_ticks + 1e-9);
            if (end_cycle <= first_cycle) continue;
            const from = cycleStart(first_cycle, window_cycle_ticks), to = cycleStart(end_cycle, window_cycle_ticks);
            for (const take of takes) {
                const alone_items = itemsIn((recorders.get(take.inserter_id)?.hands ?? []).filter(hand => hand.item === take.item), from, to);
                const items = itemsIn(take.hands, from, to);
                if (items >= alone_items) continue;
                const lane = lanes.find(it => it.belt_id === take.belt_id && it.lane === take.lane)!;
                const row = layout.rows.find(it => it.belt_id === take.belt_id && it.lane === take.lane)!;
                const run_as = facts.of(take.belt_id, take.lane).lane_end.kind === "dead_end" ? "dead_end" as const : "outlet" as const;
                const loss = { belt_id: take.belt_id, lane: take.lane, lane_end: lane.stated.kind, run_as, item: take.item,
                    copies: lane.shared ? under.setpoint.copies : 1, copy: take.copy + 1,
                    inserter_id: Number(take.inserter_id.slice("inserter:".length)), items, alone_items,
                    window_cycles: end_cycle - first_cycle, flow: row.flow };
                losses.push({ ...loss, text: describeSharedLaneLoss(loss) });
            }
        }
    }
    // the worst first: the most items short of the run of one copy
    losses.sort((a, b) => (b.alone_items - b.items) - (a.alone_items - a.items));
    return { losses, fast_check_passes, simulated: true, lanes: keys };
}
