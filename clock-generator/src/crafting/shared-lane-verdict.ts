import { Config } from "../config";
import { Logger } from "../common/logger";
import { OpenRange } from "../data-types";
import Fraction, { fraction } from "../data-types/fraction";
import { FactorioDataService } from "../data";
import { Entity, EntityId, handSizeFor, Inserter } from "../entities";
import { laneFactsOfConfig } from "../entities/traits/build-traits";
import { FlowDirection, LaneEnd } from "../entities/traits/lane-facts";
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
import { buildToNameOf } from "./build-names";
import { capitalized, inserterNameInText, theName, ITEM_IDS, lanesInSentence, NO_BUILD, type BuildToName, type ItemWords } from "./entity-name";
import { droppedOnto, ModelLane, modelLanesOf, takenLanesOf } from "./shared-lane-lanes";
import { DropRecorder, HandDropped, LaidOutLane, LaneRow, recordInserters, runOnSharedLanes, SharedLaneLayout, sharedLaneLayoutOf } from "./shared-lane-model";
import type { OutputBeltRun } from "./output-belt-run";
import { TargetProductionRate } from "./target-production-rate";
import { longRunWindowCyclesOf, runClockOnBuild } from "./trial";

/**
 * Whether a clock holds on the lanes its copies share. One run holds every copy of the build, each with its own machines
 * and inserters, `copy_offset` apart along the lanes they share; each such lane runs tick by tick with every copy's
 * takers on it, whatever its end (crafting/shared-lane-model.ts). A copy that loses swings there fails the clock.
 *
 * The lanes judged: every lane a belt pickup takes from that the copies share (`sharing`, more than one copy), under its
 * end; a lane of unknown end is run as a dead end and as an infinite end in turn, and the clock has to hold under both. A
 * lane of unknown end that the copies do not share is run with the takers of one copy on it as a dead end (the run of one
 * copy reads it as an infinite end). A belt the build drops onto is left out: its entry would be the drops, which the
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
 * (`behindTargetIn`). A part copy's machine can have fewer takers than a whole copy's, and makes only what they take: it
 * is held to the whole copy's target times the share of the machine's takers' transfers that the part copy holds. A part
 * copy's output inserter is held to its own target. Where none is behind, the shortfall is stock moved between the runs,
 * and the clock holds. The condition reads only the runs made above: it adds no run, and a clock that no taker's
 * shortfall fails holds whatever its rates. Where the targets cannot be worked out, the loss stands.
 *
 * What each copy's taker got, and what each copy's machines and output inserters made, is read through one function,
 * `copyLaneTakes`, and nowhere else.
 *
 * Where the config states its output belt, each copy's output inserter puts its stacks onto it (output-belt-run.ts). A
 * copy whose side belt is full at its join onto the output belt holds its hand: its machines fill up and its takers take
 * less from the lanes. Where such a copy's output inserter held a hand in the judged window cycles, the run is made once
 * more with each output inserter on a tile of its own (the run before the output belt). Where the output belt makes the
 * entity the loss names further behind by more than one craft or hand, the loss says that its join is full
 * (`join_full`), not that the lane gives it too few items; else it names the lane, and gives the held hands beside it
 * (`side_belt_waits`).
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
    window_cycles: number, logger: Logger, ends: OutputEnds | null = null): { takes: CopyLaneTake[]; made: CopyMade[]; last_tick: number; output_belt?: OutputBeltRun } {
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
    return { takes, made: madeOf(), last_tick, ...(model.output_belt !== undefined && { output_belt: model.output_belt }) };
}

/** One taker of one copy that loses swings on a lane the copies share */
export interface SharedLaneLoss {
    belt_id: number;
    /** The lane, 1 or 2; the first, where the taker takes the item from both lanes of the belt (`other_lanes`) */
    lane: number;
    lane_end: LaneEnd["kind"];
    /** The end the lane was run under, for a lane of unknown end: a dead end or an infinite end */
    run_as: "dead_end" | "infinite";
    /**
     * The other lane of the belt that the taker takes the item from, where it takes it from both: the loss is one for the
     * taker and the item, as a hand of it cannot be told by the lane it came from, and its counts are the taker's swings with
     * the item. Absent where the taker takes the item from one lane.
     */
    other_lanes?: { lane: number; lane_end: LaneEnd["kind"]; run_as: "dead_end" | "infinite" }[];
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
    /** The taker's swings with the item in the judged window cycles: the hands of it the run of the copies keeps */
    swings: number;
    /** Its swings with the item in them in the run of one copy alone */
    alone_swings: number;
    /** Of `swings`, those with fewer items than a full hand of the taker for the item */
    short_swings: number;
    window_cycles: number;
    /** The way the items flow, as a map direction */
    flow: FlowDirection;
    /**
     * The machine or output inserter furthest behind its target rate in the same run of the copies, which makes the
     * shortfall a loss; absent only where the targets could not be worked out
     */
    behind?: BehindTarget;
    /**
     * Where the config states its output belt and the copy's output inserter held hands in the judged window cycles, and
     * the output belt is the cause: its side belt is full at its join onto the output belt. That makes the copy short, not
     * the lane. The output belt is the cause where the copy's machine or output inserter that the loss names is further
     * behind by more than one craft or hand than in the same run with each output inserter on a tile of its own.
     */
    join_full?: JoinFull;
    /** The hands the copy's side belt held where the output belt is not the cause: a fact beside the lane's shortfall */
    side_belt_waits?: JoinFull;
    /** The sentence the result shows */
    text: string;
}

/** The hands of a copy's output inserter that its side belt held, as it was full at its join onto the output belt */
export interface JoinFull {
    /** Hands held in the judged window cycles: their stacks went down later than on a free side belt */
    held_hands: number;
    /** Hands of the output inserter in them */
    hands: number;
    /**
     * Where the side belt is the cause (`SharedLaneLoss.join_full`): the hands the copy's output inserters' target puts down in
     * the judged window cycles, from the target rates; absent where they cannot be worked out
     */
    target_swings?: number;
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

/**
 * The lanes the copies share could not be checked: the check stopped with an error (a config it cannot lay out the
 * copies of, for one). A clock is never taken to hold on lanes that were not checked, so this is a loss of its own.
 */
export interface SharedLanesNotChecked {
    kind: "not_checked";
    /** The message of the error the check stopped with */
    reason: string;
    /** The sentence the result shows */
    text: string;
}

/** What keeps a clock from being stable on the lanes its copies share: a taker that loses swings, or lanes that could not be checked */
export type ClockSharedLaneLoss = SharedLaneLoss | SharedLanesNotChecked;

/** The loss of a clock whose shared lanes could not be checked, for the reason given */
export function sharedLanesNotChecked(reason: string): SharedLanesNotChecked {
    return { kind: "not_checked", reason, text: `The lanes its copies share could not be checked: ${reason}${/[.!?]$/.test(reason) ? "" : "."}` };
}

/** Whether the loss is that the lanes could not be checked, not a taker that loses swings */
export function isNotChecked(loss: ClockSharedLaneLoss): loss is SharedLanesNotChecked {
    return "kind" in loss && loss.kind === "not_checked";
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

/**
 * The lanes the copies share that the model leaves out because the build drops onto their belt, for the result to name
 * as not checked
 */
export function droppedOntoSharedLanes(config: Config): { belt_id: number; lane: 1 | 2 }[] {
    if (!(config.setpoint.copies > 1)) return [];
    const facts = laneFactsOfConfig(config);
    const dropped = droppedOnto(config);
    return takenLanesOf(config).filter(({ belt_id, lane }) => dropped.has(belt_id) && facts.of(belt_id, lane).sharing === "shared");
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
 * The config with each lane of unknown end as one reading has it: a dead end in reading 0, an infinite end in reading 1.
 * A lane of known end is run as it is.
 */
function configUnder(config: Config, lanes: readonly ModelLane[], reading: number): Config {
    return { ...config, belts: config.belts.map(belt => {
        const unknown = lanes.filter(lane => lane.belt_id === belt.id && lane.stated.kind === "unknown");
        if (unknown.length === 0) return belt;
        return { ...belt, lanes: belt.lanes.map((lane, index) => {
            const model = unknown.find(it => it.lane === index + 1);
            if (model === undefined) return lane;
            // a lane the copies do not share is run as a dead end only: the run of one copy reads it as an infinite end
            return { ...lane, lane_end: reading === 1 && model.shared ? { kind: "infinite" } : { kind: "dead_end" } };
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

/** How the loss texts write an item: by the game's name in a sentence, or by its id without the game data */
function itemWords(): ItemWords {
    return FactorioDataService.isAvailable() ? { item: id => FactorioDataService.itemNameInSentence(id) } : ITEM_IDS;
}

/**
 * "The iron gear wheel lane ends in a dead end.", "Both lanes of the iron ore belt end in an infinite end.", or each lane with
 * its end where they differ
 */
function endsSentence(loss: Omit<SharedLaneLoss, "text">, build: BuildToName, words: ItemWords): string {
    const lanes = [{ lane: loss.lane, lane_end: loss.lane_end, run_as: loss.run_as }, ...loss.other_lanes ?? []];
    const end = (it: typeof lanes[number], many: boolean) => {
        const run_as = it.run_as === "dead_end" ? "a dead end" : "an infinite end";
        return it.lane_end === "unknown" ? `${many ? "have" : "has"} an unknown end. ${many ? "They are" : "It is"} checked as ${run_as}.` : `${many ? "end" : "ends"} in ${run_as}.`;
    };
    const named = (of: typeof lanes) => capitalized(lanesInSentence(of.map(it => ({ belt_id: loss.belt_id, lane: it.lane })), build, { words }));
    if (lanes.length > 1 && lanes.every(it => it.lane_end === lanes[0].lane_end && it.run_as === lanes[0].run_as)) {
        return `${named(lanes)} ${end(lanes[0], true)}`;
    }
    return lanes.map(it => `${named([it])} ${end(it, false)}`).join(" ");
}

/** "misses 3 of its 65 swings with iron gear wheel in 65 window cycles", with the swings that carry fewer items where there are */
function missedSwings(loss: Omit<SharedLaneLoss, "text">, item: string): string {
    const fewer = loss.short_swings > 0 ? `, and ${counted(loss.short_swings)} of the swings it makes ${loss.short_swings === 1 ? "carries" : "carry"} fewer items,` : "";
    return `misses ${counted(Math.max(0, loss.alone_swings - loss.swings))} of its ${counted(loss.alone_swings)} swings with ${item}${fewer} in ${loss.window_cycles} window cycles.`;
}

/**
 * "The advanced circuit lane ends in a dead end. The 6 copies take advanced circuit from it. When the items move east, copy 3
 * from the entry does not get sufficient items. Its inserter that takes advanced circuit and sulfur misses 70 of its 210 swings
 * with advanced circuit in 50 window cycles." At a join: "The side belt of copy 4 from the entry is full at its join onto the
 * output belt. Its output inserter waits for room in 84 of its 336 swings in 63 window cycles. It misses 42 of the 378 swings
 * its target needs." A loss is said in swings, not in items or crafts; a lane and an inserter by their items (entity-name.ts:
 * `build`, the config's). One fact a sentence; the game's names of items have no plural.
 */
export function describeSharedLaneLoss(loss: Omit<SharedLaneLoss, "text">, build: BuildToName = NO_BUILD): string {
    if (loss.join_full !== undefined) {
        const { held_hands, hands, target_swings } = loss.join_full;
        const missed = target_swings === undefined || target_swings <= hands ? ""
            : ` It misses ${counted(target_swings - hands)} of the ${counted(target_swings)} swings its target needs.`;
        return `The side belt of copy ${loss.copy} from the entry is full at its join onto the output belt. `
            + `Its output inserter waits for room in ${counted(held_hands)} of its ${counted(hands)} swings in ${loss.window_cycles} window cycles.${missed}`;
    }
    const words = itemWords();
    const item = words.item(loss.item);
    const them = loss.other_lanes === undefined ? "it" : "them";
    const inserter = inserterNameInText(loss.inserter_id, build, { words });
    const waits = loss.side_belt_waits === undefined ? ""
        : ` Its output inserter also waits for room on its side belt in ${counted(loss.side_belt_waits.held_hands)} of its ${counted(loss.side_belt_waits.hands)} swings.`;
    if (loss.copies === 1) {
        return `${endsSentence(loss, build, words)} The build takes ${item} from ${them}. `
            + `When the items move ${directionWord(loss.flow)}, ${theName(inserter)} does not get sufficient items. It ${missedSwings(loss, item)}${waits}`;
    }
    return `${endsSentence(loss, build, words)} The ${loss.copies} copies take ${item} from ${them}. `
        + `When the items move ${directionWord(loss.flow)}, copy ${loss.copy} from the entry does not get sufficient items. `
        + `Its ${inserter} ${missedSwings(loss, item)}${waits}`;
}

/** The tick window cycle `k` of the clock starts in: the clock stands at 0 in the run's first tick */
const cycleStart = (k: number, window_cycle_ticks: number) => Math.ceil(k * window_cycle_ticks - 1e-9);

/** The hands put down from tick `from` up to, not including, tick `to` */
const handsIn = (hands: readonly HandDropped[], from: number, to: number) => hands.filter(hand => hand.tick >= from && hand.tick < to);

/** Items of the hands */
const itemsOf = (hands: readonly HandDropped[]) => hands.reduce((sum, hand) => sum + hand.items, 0);

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
export interface RunOfCopies {
    shortfalls: Shortfall[];
    made: CopyMade[];
    /** The judged window cycles, from the tick `from` up to, not including, the tick `to` */
    from: number;
    to: number;
    /** What each copy after the config's own holds, in order: every entity, or the ids of the entities a part copy holds */
    holds: SharedLaneLayout["copies"]["later"];
    /** Where the config states its output belt: by the copy (1 the config's own), the hands its side belt held in the span */
    join_full?: ReadonlyMap<number, JoinFull>;
}

/**
 * The takers of the copies that put down fewer items of their lane's item than the run of one copy alone, over the whole
 * window cycles of the clock in the second half of both runs, and what each copy's machines and output inserters made
 */
function shortfallsOf(under: Config, lanes: readonly ModelLane[], layout: SharedLaneLayout, alone: AloneRun, windows: Map<string, OpenRange[]>,
    window_cycle_ticks: number, window_cycles: number, logger: Logger, ends: OutputEnds | null): RunOfCopies {
    const facts = laneFactsOfConfig(under);
    const { takes, made, last_tick, output_belt } = copyLaneTakes(under, windows, window_cycle_ticks, layout, window_cycles, logger, ends);
    const last = Math.min(alone.last_tick, last_tick);
    const first_cycle = Math.ceil(last / 2 / window_cycle_ticks), end_cycle = Math.floor((last + 1) / window_cycle_ticks + 1e-9);
    const from = cycleStart(first_cycle, window_cycle_ticks), to = cycleStart(end_cycle, window_cycle_ticks);
    const holds = layout.copies.later;
    const join_full = output_belt === undefined ? undefined : joinFullOf(output_belt, from, to);
    if (end_cycle <= first_cycle) return { shortfalls: [], made, from, to, holds, ...(join_full !== undefined && { join_full }) };
    // a taker that takes one item from both lanes of its belt has the same hands on both: a hand cannot be told by its lane,
    // so it makes one loss for the item, which names both lanes
    const by_taker = new Map<string, CopyLaneTake[]>();
    for (const take of takes) {
        const key = `${take.copy}|${take.inserter_id}|${take.belt_id}|${take.item}`;
        by_taker.set(key, [...by_taker.get(key) ?? [], take]);
    }
    const shortfalls = [...by_taker.values()].flatMap(([take, ...others]) => {
        const alone_hands = handsIn((alone.recorders.get(take.inserter_id)?.hands ?? []).filter(hand => hand.item === take.item), from, to);
        const hands = handsIn(take.hands, from, to);
        const alone_items = itemsOf(alone_hands), items = itemsOf(hands);
        if (items >= alone_items) return [];
        const hand = alone.handOf(take.inserter_id, take.item);
        const lane = lanes.find(it => it.belt_id === take.belt_id && it.lane === take.lane)!;
        const row = layout.rows.find(it => it.belt_id === take.belt_id && it.lane === take.lane)!;
        const runAs = (of: 1 | 2) => facts.of(take.belt_id, of).lane_end.kind === "dead_end" ? "dead_end" as const : "infinite" as const;
        const other_lanes = others.map(other => ({ lane: other.lane, lane_end: lanes.find(it => it.belt_id === other.belt_id && it.lane === other.lane)!.stated.kind,
            run_as: runAs(other.lane) }));
        const loss = { belt_id: take.belt_id, lane: take.lane, lane_end: lane.stated.kind, run_as: runAs(take.lane),
            ...(other_lanes.length > 0 && { other_lanes }), item: take.item,
            copies: lane.shared ? under.setpoint.copies : 1, copy: take.copy + 1,
            inserter_id: Number(take.inserter_id.slice("inserter:".length)), items, alone_items,
            swings: hands.length, alone_swings: alone_hands.length, short_swings: hands.filter(it => it.items < hand).length,
            window_cycles: end_cycle - first_cycle, flow: row.flow };
        return [{ short: alone_items - items, hand, loss }];
    });
    return { shortfalls, made, from, to, holds, ...(join_full !== undefined && { join_full }) };
}

/** The config with each output inserter dropping on a tile of its own: the run of the copies as it was before the output belt */
function withoutOutputBelt(config: Config): Config {
    const { output_belt: _output_belt, ...without } = config;
    return without;
}

/** The copies whose side belt held a hand of their output inserter from tick `from` up to, not including, `to` */
function joinFullOf(output_belt: OutputBeltRun, from: number, to: number): Map<number, JoinFull> {
    const full = new Map<number, JoinFull>();
    for (const [copy, hands] of output_belt.hands) {
        const in_span = hands.filter(hand => hand.arrival >= from && hand.arrival < to);
        const held_hands = in_span.filter(hand => output_belt.held(hand)).length;
        if (held_hands > 0) full.set(copy, { held_hands, hands: in_span.length });
    }
    return full;
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

/** One inserter that takes from a machine, and the hands it moves in one output cycle of one copy */
interface MachineTaker {
    inserter_id: string;
    transfers: number;
}

/**
 * The target rates of one copy: crafts a second of each machine, and items of the target a second of each output inserter,
 * with its hand; and the takers of each machine, with their transfers
 */
export interface TargetRates {
    crafts_per_second: ReadonlyMap<number, number>;
    output_inserters: ReadonlyMap<number, { items_per_second: number; hand: number }>;
    /** The inserters that take from each machine, by the config's machine number */
    takers: ReadonlyMap<number, readonly MachineTaker[]>;
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
        // the machine each inserter of the config takes from, by the inserter's id
        const source_machines = new Map(config.inserters.flatMap((inserter, index) => inserter.source.type === "machine"
            ? [[EntityId.forInserter(inserter.id ?? index + 1).id, inserter.source.id] as const] : []));
        const takers = new Map<number, MachineTaker[]>();
        for (const transfer of cycle.entity_transfer_map.values()) {
            const number = transfer.entity.entity_id.number;
            if (!Entity.isInserter(transfer.entity)) continue;
            const machine = source_machines.get(transfer.entity.entity_id.id);
            if (machine !== undefined) {
                takers.set(machine, [...takers.get(machine) ?? [], { inserter_id: transfer.entity.entity_id.id, transfers: transfer.total_transfer_count.toDecimal() }]);
            }
            if (!ends.inserter_ids.has(number)) continue;
            const of_target = transfer.item_transfers.find(it => it.item_name === ends.item);
            if (of_target === undefined) continue;
            const hand = handOfItem(traits, transfer.entity.entity_id.id, ends.item);
            output_inserters.set(number, { items_per_second: of_target.transfer_count.multiply(hand).divide(seconds).toDecimal(), hand });
        }
        return { crafts_per_second, output_inserters, takers };
    } catch {
        return null;
    }
}

/** The rounding of a float rate times a span, below which a figure counts as on its target: not an allowance */
const ROUNDING = 1e-9;

/**
 * The share of a whole copy's target that a machine of a copy is held to: all of it for a whole copy; for a part copy, the
 * share of the machine's takers' transfers that the part copy holds. A machine that no inserter takes from, or whose
 * takers move nothing in the output cycle, is held to all of it.
 */
function machineShareOf(holds: "whole" | ReadonlySet<string>, takers: readonly MachineTaker[] | undefined): number {
    if (holds === "whole" || takers === undefined) return 1;
    const all = takers.reduce((sum, taker) => sum + taker.transfers, 0);
    if (!(all > 0)) return 1;
    return takers.reduce((sum, taker) => holds.has(taker.inserter_id) ? sum + taker.transfers : sum, 0) / all;
}

/**
 * The machines of every copy behind their target rate by more than one craft, and the output inserters of every copy
 * behind theirs by more than one hand, over the judged window cycles of one run of the copies; the furthest behind first.
 * A part copy's machine is held to the whole copy's target times the share of the machine's takers' transfers that the
 * part copy holds (`machineShareOf`): a machine of which it holds two of four equal takers is held to half. An output
 * inserter of a part copy is held to its own target, as one of a whole copy.
 */
export function behindTargetIn(run: RunOfCopies, rates: TargetRates): BehindTarget[] {
    return howFarBehind(run, rates).filter(it => it.behind > 1 + ROUNDING).sort((a, b) => b.behind - a.behind);
}

/** How far each machine and output inserter of every copy is behind its target over the judged window cycles, ahead or not */
function howFarBehind(run: RunOfCopies, rates: TargetRates): BehindTarget[] {
    const seconds = (run.to - run.from) / 60;
    return run.made.flatMap(({ copy, kind, id, counts }): BehindTarget[] => {
        const made = counts.reduce((sum, it) => it.tick >= run.from && it.tick < run.to ? sum + it.amount : sum, 0);
        if (kind === "machine") {
            const rate = rates.crafts_per_second.get(id);
            if (rate === undefined) return [];
            const target = rate * seconds * machineShareOf(copy === 0 ? "whole" : run.holds[copy - 1] ?? "whole", rates.takers.get(id));
            return [{ copy: copy + 1, kind, id, made, target, behind: target - made }];
        }
        const output = rates.output_inserters.get(id);
        if (output === undefined) return [];
        const target = output.items_per_second * seconds;
        return [{ copy: copy + 1, kind, id, made, target, behind: (target - made) / output.hand }];
    });
}

/**
 * The hands that the target rates of copy `copy`'s output inserters put down over the judged window cycles of `run`, to the
 * nearest whole hand; undefined where the copy has no output inserter with a target
 */
function targetSwingsOf(run: RunOfCopies, rates: TargetRates, copy: number): number | undefined {
    const seconds = (run.to - run.from) / 60;
    const of_copy = run.made.filter(it => it.copy + 1 === copy && it.kind === "output_inserter").flatMap(it => {
        const output = rates.output_inserters.get(it.id);
        return output === undefined ? [] : [output.items_per_second * seconds / output.hand];
    });
    return of_copy.length === 0 ? undefined : Math.round(of_copy.reduce((sum, it) => sum + it, 0));
}

/**
 * Whether the output belt makes a copy's entity further behind: by more than one craft or hand (the measure of
 * behindTargetIn) against the same run with each output inserter dropping on a tile of its own (`reference`)
 */
function joinIsTheCause(behind: BehindTarget, reference: RunOfCopies, rates: TargetRates): boolean {
    const there = howFarBehind(reference, rates).find(it => it.copy === behind.copy && it.kind === behind.kind && it.id === behind.id);
    return there === undefined || behind.behind - there.behind > 1 + ROUNDING;
}

/**
 * The runs of the copies the verdict makes, before any is made: the lanes it judges (`modelLanesOf`), and for each reading of
 * the lanes of unknown end (a dead end, then an infinite end, where one the copies share has an unknown end) the config under
 * it and its layouts, one for each way the items move, those with the same rows once.
 */
export function sharedLaneRunsOf(config: Config): { lanes: { belt_id: number; lane: 1 | 2; shared: boolean }[]; readings: { under: Config; layouts: SharedLaneLayout[] }[] } {
    const lanes = modelLanesOf(config);
    if (lanes.length === 0) return { lanes, readings: [] };
    const readings = lanes.some(lane => lane.stated.kind === "unknown" && lane.shared) ? 2 : 1;
    return { lanes, readings: Array.from({ length: readings }, (_, reading) => {
        const under = configUnder(config, lanes, reading);
        // a layout whose rows are those of one run already is not run again: the same rows give the same run
        const layouts = [...new Map(laidOutLanesOf(under, lanes).map(laid => sharedLaneLayoutOf(under, laid)).map(layout => [JSON.stringify(layout), layout])).values()];
        return { under, layouts };
    }) };
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
    const build = buildToNameOf(config);
    const windows = new Map(Object.entries(clock_windows).map(([id, ranges]) => [id, ranges.map(range => OpenRange.from(range.start, range.end))] as const));
    const window_cycles = longRunWindowCyclesOf(window_cycle_ticks);
    const ends = outputEndsOf(config);
    // the target rates, worked out once and only where a taker's shortfall is a loss
    let rates: TargetRates | null | undefined;
    /**
     * The losses the takers of one run of the copies make that stand: each with the machine or output inserter furthest
     * behind its target in that run, of the loss's own copy where one of it is behind, and none where none is behind
     * (stock moved between the runs, not output lost). Where the target rates cannot be worked out, every loss stands as
     * the takers make it.
     */
    const standing = (run: RunOfCopies, losses: Omit<SharedLaneLoss, "text">[], reference: () => RunOfCopies): Omit<SharedLaneLoss, "text">[] => {
        if (losses.length === 0) return [];
        if (rates === undefined) rates = ends === null ? null : targetRatesOf(config, ends);
        if (rates === null) return losses;
        const behind = behindTargetIn(run, rates);
        // the run with each output inserter on a tile of its own, made only where a copy's side belt held a hand
        let without: RunOfCopies | undefined;
        return behind.length === 0 ? [] : losses.map(loss => {
            const of_copy = behind.find(it => it.copy === loss.copy) ?? behind[0];
            const held = run.join_full?.get(loss.copy);
            if (held === undefined) return { ...loss, behind: of_copy };
            without ??= reference();
            if (!joinIsTheCause(of_copy, without, rates!)) return { ...loss, behind: of_copy, side_belt_waits: held };
            const target_swings = targetSwingsOf(run, rates!, loss.copy);
            return { ...loss, behind: of_copy, join_full: { ...held, ...(target_swings !== undefined && { target_swings }) } };
        });
    };
    // the first run of each reading: the run of one copy, and the copies on each layout of the lanes, with their shortfalls
    const first: { under: Config; taker_ids: string[]; alone: AloneRun; runs: { layout: SharedLaneLayout; run: RunOfCopies }[] }[] = [];
    let fast_check_passes = true;
    for (const { under, layouts } of sharedLaneRunsOf(config).readings) {
        const facts = laneFactsOfConfig(under);
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
        first.push({ under, taker_ids, alone, runs: layouts.map(layout => ({ layout, run: shortfallsOf(under, lanes, layout, alone, windows, window_cycle_ticks, window_cycles, logger, ends) })) });
    }
    const shortfalls = first.flatMap(it => it.runs.flatMap(({ run }) => run.shortfalls));
    const judged = (losses: Omit<SharedLaneLoss, "text">[], longer_run: boolean): SharedLaneJudgement => ({
        // the worst first: the most items short of the run of one copy
        losses: losses.map(loss => ({ ...loss, text: describeSharedLaneLoss(loss, build) })).sort((a, b) => (b.alone_items - b.items) - (a.alone_items - a.items)),
        fast_check_passes, simulated: true, longer_run, lanes: keys,
    });
    // no taker short, or one short by more than a hand, which the end of the judged span does not make: judged as it is,
    // each run's losses standing where a machine or an output inserter of that run is behind its target
    if (shortfalls.length === 0 || shortfalls.some(it => it.short > it.hand)) {
        return judged(first.flatMap(it => it.runs.flatMap(({ layout, run }) => standing(run, run.shortfalls.map(shortfall => shortfall.loss),
            () => shortfallsOf(withoutOutputBelt(it.under), lanes, layout, it.alone, windows, window_cycle_ticks, window_cycles, logger, ends)))), false);
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
            losses.push(...standing(longer, longer.shortfalls.filter(shortfall => shortfall.short > shortfall.hand).map(shortfall => shortfall.loss),
                () => shortfallsOf(withoutOutputBelt(under), lanes, layout, alone, windows, window_cycle_ticks, 2 * window_cycles, logger, ends)));
        }
    }
    return judged(losses, true);
}
