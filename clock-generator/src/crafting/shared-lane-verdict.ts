import { Config } from "../config";
import { Logger } from "../common/logger";
import { OpenRange } from "../data-types";
import Fraction, { fraction } from "../data-types/fraction";
import { FactorioDataService } from "../data";
import { LaneEnd, laneFactsOf, sharedLaneModelEnds } from "../entities/traits/lane-facts";
import { fractionOf } from "../entities/traits/ratio";
import { SerializableClockWindows } from "./clock";
import { DropRecorder, FlowDirection, LaneRow, laneRowsOf, recordInserters, runOnSharedLanes } from "./shared-lane-model";
import { longRunWindowCyclesOf, runClockOnBuild } from "./trial";
import type { HandDropped } from "../simulation/copy-taker";

/**
 * Whether a clock holds on the lanes its copies share (rulings: the other copies' pickup inserters are simulated on each
 * shared lane, and a copy that loses swings fails the clock; a lane of unknown end must hold under each end).
 *
 * The lanes judged are the ones `sharedLaneModelEnds` runs, under each end it gives, where the model checks something
 * the run of one copy does not: a lane the copies share (more than one copy), or a lane whose end that run does not read
 * (an unknown end, which it reads as a free outlet). A lane the build drops onto is left out: its entry would be the
 * drops, which the model does not run. So is a lane one of whose takers puts into something other than a machine: the
 * model runs a taker of another copy into a machine only.
 *
 * The config does not say which way a lane the build takes from flows, so the model runs it both ways along the row of
 * copies, and the clock has to hold both ways.
 *
 * First a fast check: the refill arithmetic of the lane (`refillsInTime`), on a run of the clock with one copy. Where it
 * proves that every lane refills in time after every enable window, no copy is short and the model does not run. Where it
 * does not, the model runs, and its verdict stands: the arithmetic never fails a clock alone.
 *
 * Each copy's takers are judged on the second half of a long run against the run of one copy: a taker that puts down a
 * whole hand fewer of the lane's item than the same inserter does with no other copy on the lane loses swings.
 */

/** One taker of one copy that loses swings on a lane the copies share */
export interface SharedLaneLoss {
    belt_id: number;
    /** The lane, 1 or 2 */
    lane: number;
    lane_end: LaneEnd["kind"];
    item: string;
    /** Copies that take from the lane, as the config counts them (5.5); one on a lane that is one per copy */
    copies: number;
    /** The copy, counted from the lane's entry: 1 is the one simulated in full */
    copy: number;
    inserter_id: number;
    /** Items of the lane's item the taker put down in the judged window cycles */
    items: number;
    /** What the inserter put down in them with no other copy on the lane */
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
    /** Whether the refill arithmetic proved that no copy is short, so that the model did not have to run */
    fast_check_passes: boolean;
    /** Whether the model ran */
    simulated: boolean;
    /** Lanes the model would run, by "belt/lane" */
    lanes: string[];
}

/** A lane the model runs, and the end it runs it under */
interface ModelLane {
    belt_id: number;
    lane: 1 | 2;
    stated: LaneEnd;
    ends: readonly LaneEnd[];
}

/** The lanes the model judges, with the ends it runs each under (see the module's description) */
function modelLanesOf(config: Config, logger: Logger): ModelLane[] {
    const facts = laneFactsOf(config);
    const copies = config.setpoint.copies;
    const dropped_onto = new Set(config.inserters.flatMap(inserter => inserter.sink.type === "belt" ? [inserter.sink.id] : []));
    const lanes: ModelLane[] = [];
    for (const belt of config.belts) {
        if (dropped_onto.has(belt.id)) continue;
        for (const lane of [1, 2] as const) {
            const item = belt.lanes[lane - 1]?.ingredient;
            if (item === undefined || item === "") continue;
            const takers = config.inserters.filter(inserter => inserter.source.type === "belt" && inserter.source.id === belt.id
                && (inserter.filters === undefined || inserter.filters.length === 0
                    || (inserter.filter_mode === "blacklist" ? !inserter.filters.includes(item) : inserter.filters.includes(item))));
            if (takers.length === 0) continue;
            const lane_facts = facts.of(belt.id, lane);
            const shared = lane_facts.sharing === "shared_by_copies" && copies > 1;
            // the run of one copy reads a dead end as one and every other end as a free outlet
            const read_alone = lane_facts.lane_end.kind === "dead_end" ? "dead_end" : "outlet";
            const ends = sharedLaneModelEnds(lane_facts.lane_end).filter(end => shared || end.kind !== read_alone);
            if (ends.length === 0) continue;
            if (takers.some(inserter => inserter.sink.type !== "machine")) {
                logger.log(`The shared lanes: lane ${lane} of belt ${belt.id} is not checked, as a taker of it puts into something other than a machine`);
                continue;
            }
            lanes.push({ belt_id: belt.id, lane, stated: lane_facts.lane_end, ends });
        }
    }
    return lanes;
}

/** The config with each lane's end as one reading has it: the `reading`-th end of each lane, or its last */
function configUnder(config: Config, lanes: readonly ModelLane[], reading: number): Config {
    return { ...config, belts: config.belts.map(belt => {
        const of_belt = lanes.filter(lane => lane.belt_id === belt.id);
        if (of_belt.length === 0) return belt;
        return { ...belt, lanes: belt.lanes.map((lane, index) => {
            const model = of_belt.find(it => it.lane === index + 1);
            if (model === undefined) return lane;
            const end = model.ends[Math.min(reading, model.ends.length - 1)];
            return { ...lane, lane_end: end.kind === "outlet" ? { kind: "outlet", outlet_rate: fractionOf(end.outlet_rate).toDecimal() } : { kind: end.kind } };
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

/** The ticks from one enable window of the lane's takers opening to the next, and the window each tick belongs to */
interface LaneWindow { start: number; end: number }

/** The enable windows of a lane's takers as the lane sees them: theirs joined where they touch or overlap, by when they open */
export function laneWindowsOf(ranges: readonly { start: number; end: number }[], window_cycle_ticks: number): LaneWindow[] {
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
 * The refill arithmetic of the lanes that carry one item of one belt (the parked rule after #725): in each opening of an
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
 * "Lane 1 of belt 2 ends in a dead end, and 6 copies take advanced circuit from it. When the items move east, copy 3 from
 * the entry of the lane gets too few. Its inserter 3 takes 2,240 in 50 window cycles, and 3,360 when no other copy takes
 * from the lane." The game's names of items have no plural.
 */
export function describeSharedLaneLoss(loss: Omit<SharedLaneLoss, "text">): string {
    const end = loss.lane_end === "dead_end" ? "ends in a dead end" : "has an unknown end, which is checked as a dead end";
    const item = FactorioDataService.isAvailable() ? FactorioDataService.itemNameInSentence(loss.item) : loss.item;
    return `Lane ${loss.lane} of belt ${loss.belt_id} ${end}, and ${loss.copies} copies take ${item} from it. `
        + `When the items move ${directionWord(loss.flow)}, copy ${loss.copy} from the entry of the lane gets too few. `
        + `Its inserter ${loss.inserter_id} takes ${counted(loss.items)} in ${loss.window_cycles} window cycles, `
        + `and ${counted(loss.alone_items)} when no other copy takes from the lane.`;
}

/**
 * Judges a clock on the lanes its copies share (see the module's description). `simulate_always` runs the model also
 * where the fast check passes, for a comparison of the two; it never changes the verdict.
 */
export function judgeSharedLanes(config: Config, clock_windows: SerializableClockWindows, window_cycle_ticks: number, logger: Logger,
    options: { simulate_always?: boolean } = {}): SharedLaneJudgement {
    const lanes = modelLanesOf(config, logger);
    const keys = lanes.map(lane => `${lane.belt_id}/${lane.lane}`);
    if (lanes.length === 0) return { losses: [], fast_check_passes: true, simulated: false, lanes: keys };
    const windows = new Map(Object.entries(clock_windows).map(([id, ranges]) => [id, ranges.map(range => OpenRange.from(range.start, range.end))] as const));
    const window_cycles = longRunWindowCyclesOf(window_cycle_ticks);
    const readings = Math.max(...lanes.map(lane => lane.ends.length));
    const axis = rowAxisOf(config);
    const flows: FlowDirection[] = [axis, { x: -axis.x, y: -axis.y }];
    const losses: SharedLaneLoss[] = [];
    let fast_check_passes = true, simulated = false;
    for (let reading = 0; reading < readings; reading++) {
        const under = configUnder(config, lanes, reading);
        const named = lanes.map(({ belt_id, lane }) => ({ belt_id, lane }));
        const facts = laneFactsOf(under);
        // the run of one copy: what each taker takes and puts down with no other copy on the lane
        const rows_one_way = laneRowsOf(under, flows[0], named);
        const taker_ids = [...new Set(rows_one_way.flatMap(row => row.takers.map(taker => taker.inserter_id)))];
        let recorders = new Map<string, DropRecorder>();
        runClockOnBuild({ ...under, overrides: { ...under.overrides, derive_clock_windows: false } }, windows, window_cycle_ticks, logger, {
            simulate_window_cycles: window_cycles, record_histories: false, factorio_states: false,
            on_context: context => { recorders = recordInserters(context, taker_ids); },
        });
        const last_tick = Math.max(0, ...[...recorders.values()].map(recorder => recorder.last_tick));
        const from = Math.floor(last_tick / 2);
        const judged_cycles = Math.floor((last_tick - from) / window_cycle_ticks);
        const pickups = new Map([...recorders].map(([id, recorder]) => [id, recorder.pickups]));
        // the fast check, for each item of each belt: the lanes that carry it, their supply summed
        const groups = new Map<string, { rows: LaneRow[]; supply: Fraction; item: string }>();
        for (const row of rows_one_way) {
            const item = under.belts.find(belt => belt.id === row.belt_id)!.lanes[row.lane - 1].ingredient;
            const key = `${row.belt_id}/${item}`;
            const group = groups.get(key) ?? { rows: [], supply: fraction(0), item };
            group.rows.push(row);
            group.supply = group.supply.add(fractionOf(facts.of(row.belt_id, row.lane).supply_rate));
            groups.set(key, group);
        }
        const passes = [...groups.values()].every(group => refillsInTime(group.rows, group.supply, pickups, group.item, clock_windows, window_cycle_ticks, from, last_tick));
        fast_check_passes &&= passes;
        if (passes && options.simulate_always !== true) continue;
        simulated = true;
        const alone = (inserter_id: string, item: string) => {
            const hands = (recorders.get(inserter_id)?.hands ?? []).filter(hand => hand.item === item);
            return { items: hands.filter(hand => hand.tick >= from).reduce((sum, hand) => sum + hand.items, 0), hand: Math.max(1, ...hands.map(hand => hand.items)) };
        };
        for (const flow of flows) {
            const rows = flow === flows[0] ? rows_one_way : laneRowsOf(under, flow, named);
            const model = runOnSharedLanes(under, windows, window_cycle_ticks, rows, window_cycles, logger);
            for (const row of rows) {
                const item = under.belts.find(belt => belt.id === row.belt_id)!.lanes[row.lane - 1].ingredient;
                const lane = lanes.find(it => it.belt_id === row.belt_id && it.lane === row.lane)!;
                for (const taker of row.takers) {
                    const record = model.takers.find(it => it.copy === taker.copy && it.inserter_id === taker.inserter_id);
                    if (record === undefined) continue;
                    const items = record.hands.filter(hand => hand.item === item && hand.tick >= from).reduce((sum, hand) => sum + hand.items, 0);
                    const reference = alone(taker.inserter_id, item);
                    if (reference.items - items < reference.hand) continue;
                    const copies = facts.of(row.belt_id, row.lane).sharing === "one_per_copy" ? 1 : under.setpoint.copies;
                    const loss = { belt_id: row.belt_id, lane: row.lane, lane_end: lane.stated.kind, item, copies, copy: taker.copy + 1,
                        inserter_id: Number(taker.inserter_id.slice("inserter:".length)), items, alone_items: reference.items, window_cycles: judged_cycles, flow };
                    losses.push({ ...loss, text: describeSharedLaneLoss(loss) });
                }
            }
        }
    }
    // the worst first: the most items short of the run of one copy
    losses.sort((a, b) => (b.alone_items - b.items) - (a.alone_items - a.items));
    return { losses, fast_check_passes, simulated, lanes: keys };
}
