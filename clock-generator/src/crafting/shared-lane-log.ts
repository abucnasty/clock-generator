import { Config } from "../config";
import { laneLoads, sharedLaneSupplyOf } from "../config/lane-capacity-validator";
import Fraction, { fraction } from "../data-types/fraction";
import { laneFactsOfConfig } from "../entities/traits/build-traits";
import { AtClose, HandCondition, handStartsOf, HAND_CONDITIONS, openingsOf, TakerConditions, waitedFor } from "./hand-conditions";
import type { HandDropped, LaneRow } from "./shared-lane-model";

/**
 * The facts of the lanes the copies share that the maker log gives beside each clock (scripts/blast/MAKER-LOG.md, format
 * `maker-log-2`): read from the runs the check of the shared lanes makes, only where a log asks for them. Nothing here
 * changes what the check finds, and nothing of it reaches a result.
 *
 * - Lane load: the copies times what one copy takes from a lane in a window cycle, over what the supply brings in one.
 *   Above 1 the lane cannot feed the copies.
 * - Fill: for each opening of the lane's windows, the ticks the supply takes to bring back what every copy took, against
 *   the ticks to the next opening (the refill arithmetic of the check, `fast_check_passes`, in detail).
 * - Claimed stacks: a stack that passes a taker of copy j at tick t passes a taker of copy k downstream at t plus the
 *   travel between their reaches. Copy k claims a stack copy j also claims where one of its pickups falls within one
 *   stack's passing time of a pickup of copy j moved on by that travel, on the window cycle. It binds only where the lane
 *   moves at copy k's reach: the share of its open ticks in which it moved is given beside it.
 * - Missed swings: for each taker of a copy that loses swings, its pickups in the judged span, and for each window cycle
 *   with a missed swing what the hand waited for when its window closed (hand-conditions.ts).
 */

/** The window cycle a tick is in, for a window cycle that need not be a whole number of ticks (as shared-lane-verdict.ts) */
export const cycleStartOf = (k: number, window_cycle_ticks: number) => Math.ceil(k * window_cycle_ticks - 1e-9);

export const cycleOfTick = (tick: number, window_cycle_ticks: number) => {
    let k = Math.floor(tick / window_cycle_ticks);
    while (k > 0 && cycleStartOf(k, window_cycle_ticks) > tick) k--;
    while (cycleStartOf(k + 1, window_cycle_ticks) <= tick) k++;
    return k;
};

/** A number against 1: exactly 1 only where it is exactly 1 */
export type AgainstOne = "below" | "exactly" | "above";

const againstOne = (value: Fraction): AgainstOne => {
    const over = value.subtract(1).getNumerator;
    return over > 0 ? "above" : over < 0 ? "below" : "exactly";
};

/** A number exact where it can be: a fraction of a decimal with few places, else a float compared with no allowance */
function exactOf(value: number): Fraction | null {
    try {
        return fraction(value);
    } catch {
        return null;
    }
}

/** The lane load of the config: one load of the lane capacity validator's that a belt taker takes, for every copy */
export interface JobLaneLoad {
    belt_id: number;
    lanes: number[];
    items: string[];
    /** Whether each lane of it is per copy: each copy has a lane of its own, and the load is one copy's */
    per_copy: boolean;
    copies: number;
    /** Items a second one copy's takers take from it at the setpoint */
    items_per_second: number;
    /** Items a second the lanes get for every copy */
    supply_per_second: number;
    load: number;
    against_one: AgainstOne;
}

/** The lane loads of a config, from the config alone (`laneLoads`, `sharedLaneSupplyOf`): every take on a belt */
export function jobLaneLoadsOf(config: Config): JobLaneLoad[] {
    const facts = laneFactsOfConfig(config);
    const copies = fraction(config.setpoint.copies);
    return laneLoads(config).filter(load => load.kind === "take").map(load => {
        const supply = sharedLaneSupplyOf(config, load);
        const per_copy = load.lanes.every(lane => facts.lanesOf(load.belt_id)[lane - 1]?.sharing === "per_copy");
        const belt = config.belts.find(it => it.id === load.belt_id)!;
        const value = supply.getNumerator === 0 ? null : load.items_per_second.multiply(copies).divide(supply);
        return { belt_id: load.belt_id, lanes: [...load.lanes], items: load.lanes.map(lane => belt.lanes[lane - 1]?.ingredient ?? ""), per_copy,
            copies: config.setpoint.copies, items_per_second: load.items_per_second.toDecimal(), supply_per_second: supply.toDecimal(),
            load: value === null ? Number.POSITIVE_INFINITY : value.toDecimal(), against_one: value === null ? "above" as const : againstOne(value) };
    });
}

/** The lane load of a clock on one item of one belt: from the run of one copy alone */
export interface ClockLaneLoad {
    belt_id: number;
    item: string;
    lanes: number[];
    copies: number;
    /** Items one copy's takers took of the item in a window cycle of the run of one copy, over its judged window cycles */
    items_per_window_cycle: number;
    /** Items the lanes bring in a window cycle at their supply rate */
    supply_per_window_cycle: number;
    load: number;
    against_one: AgainstOne;
    window_cycles: number;
}

/**
 * The lane load of a clock: `copies` times the items its takers took of `item` in the run of one copy alone, a window cycle
 * on average over the window cycles from `first_cycle` up to, not including, `end_cycle`, over the items the supply
 * brings in a window cycle
 */
export function clockLaneLoadOf(input: { belt_id: number; item: string; lanes: number[]; copies: number; supply_per_second: Fraction;
    taker_pickups: readonly (readonly HandDropped[])[]; window_cycle_ticks: number; first_cycle: number; end_cycle: number }): ClockLaneLoad | null {
    const { window_cycle_ticks: T, first_cycle, end_cycle } = input;
    const cycles = end_cycle - first_cycle;
    if (!(cycles > 0) || input.supply_per_second.getNumerator === 0) return null;
    const from = cycleStartOf(first_cycle, T), to = cycleStartOf(end_cycle, T);
    const items = input.taker_pickups.reduce((sum, pickups) => sum + pickups.reduce((of, it) => it.item === input.item && it.tick >= from && it.tick < to ? of + it.items : of, 0), 0);
    const supply_per_cycle = input.supply_per_second.toDecimal() * T / 60;
    const exact_T = exactOf(T), exact_copies = exactOf(input.copies);
    const value = exact_T === null || exact_copies === null ? null
        : exact_copies.multiply(items).multiply(60).divide(input.supply_per_second.multiply(exact_T).multiply(cycles));
    const load = value === null ? input.copies * items / cycles / supply_per_cycle : value.toDecimal();
    return { belt_id: input.belt_id, item: input.item, lanes: input.lanes, copies: input.copies, items_per_window_cycle: items / cycles,
        supply_per_window_cycle: supply_per_cycle, load, window_cycles: cycles,
        against_one: value !== null ? againstOne(value) : load > 1 ? "above" : load < 1 ? "below" : "exactly" };
}

/** The fill of the lanes of one item of one belt after the openings of its takers' windows (`fillAfterOpenings`), by window */
export interface LaneFill {
    belt_id: number;
    item: string;
    lanes: number[];
    /** Whether every opening is filled again before the next: the check's `fast_check_passes` for these lanes */
    fills_in_time: boolean;
    windows: {
        /** The tick of the window cycle the window opens on */
        opens: number;
        /** Ticks from it opening to the next window opening */
        gap_ticks: number;
        /** Openings of it in the judged span with a take */
        openings: number;
        /** The most ticks the supply took to bring back what one opening took */
        longest_fill_ticks: number;
        /** Openings not filled again before the next window opens */
        openings_not_filled: number;
    }[];
}

/** One opening of a lane's windows: what every copy took in it, and the ticks the supply takes to bring that back */
export interface FillOfOpening {
    window: number;
    opens: number;
    gap_ticks: number;
    fill_ticks: number;
    in_time: boolean;
}

/** The fill of each window of a lane from the fill of each of its openings */
export function laneFillOf(belt_id: number, item: string, lanes: number[], openings: readonly FillOfOpening[], fills_in_time: boolean): LaneFill {
    const by_window = new Map<number, LaneFill["windows"][number]>();
    for (const it of openings) {
        const known = by_window.get(it.window) ?? { opens: it.opens, gap_ticks: it.gap_ticks, openings: 0, longest_fill_ticks: 0, openings_not_filled: 0 };
        known.openings++;
        known.longest_fill_ticks = Math.max(known.longest_fill_ticks, round(it.fill_ticks));
        if (!it.in_time) known.openings_not_filled++;
        by_window.set(it.window, known);
    }
    return { belt_id, item, lanes, fills_in_time, windows: [...by_window].sort(([a], [b]) => a - b).map(([, it]) => it) };
}

const round = (value: number) => Math.round(value * 1000) / 1000;

/** How the copies stand along a lane in the run: `copy_offset`, the length of a copy from its positions, or its width */
export type CopySpacing = "copy_offset" | "copy_length" | "copy_width";

/** The stacks the copies claim on one lane they share */
export interface ClaimedStacks {
    belt_id: number;
    lane: number;
    item: string;
    spacing: CopySpacing;
    /** The ticks a stack of a full lane takes to pass a point: within that, two pickups claim the same stack */
    stack_ticks: number;
    /** The takers of the lane that have no window: always enabled */
    takers_without_windows: string[];
    copies: {
        /** The copy, counted from the lane's entry: 1 is the config's own */
        copy: number;
        /** Ticks an item takes from the reach of the lane's first taker of copy 1 to the same taker of this copy */
        travel_ticks: number;
        /** The ticks of the window cycle on which its takers take the item in the run of one copy, over the judged span */
        pickups: number;
        /** Of them, those within a stack's passing time of a pickup of an earlier copy, moved on by the travel between them */
        claimed: number;
        /** Ticks in the judged span in which a window of its takers on the lane was open, and in which the lane moved at their reach then */
        open_ticks: number;
        moved_ticks: number;
    }[];
}

/** The distance of two ticks on a window cycle, either way round */
const onCycle = (ticks: number, window_cycle_ticks: number) => {
    const d = ((ticks % window_cycle_ticks) + window_cycle_ticks) % window_cycle_ticks;
    return Math.min(d, window_cycle_ticks - d);
};

/**
 * The stacks the copies claim on one row of the copies' run. `phases` gives, for each of the config's takers of the row,
 * the ticks of the window cycle on which it takes the row's item in the run of one copy alone; `tiles_per_tick` is the
 * belt's speed. A copy's pickup collides with an earlier copy's where the tick it is at, less the earlier pickup's tick
 * and the travel between their reaches, is within `stack_ticks` of 0 on the window cycle.
 */
export function claimedStacksOf(input: { row: LaneRow; item: string; spacing: CopySpacing; tiles_per_tick: number; window_cycle_ticks: number;
    phases: ReadonlyMap<string, readonly number[]>; takers_without_windows: string[];
    moved: (copy: number) => { open_ticks: number; moved_ticks: number } }): ClaimedStacks {
    const { row, tiles_per_tick, window_cycle_ticks: T } = input;
    const stack_ticks = 0.25 / tiles_per_tick;
    const copies = [...new Set(row.takers.map(taker => taker.copy))].sort((a, b) => a - b);
    const first = row.takers.filter(taker => taker.copy === 0)[0];
    const placed = (copy: number) => row.takers.filter(taker => taker.copy === copy)
        .map(taker => ({ edge: taker.edge_tiles, phases: input.phases.get(taker.inserter_id) ?? [] }));
    return { belt_id: row.belt_id, lane: row.lane, item: input.item, spacing: input.spacing, stack_ticks: round(stack_ticks),
        takers_without_windows: input.takers_without_windows,
        copies: copies.map(copy => {
            const own = placed(copy);
            const earlier = copies.filter(it => it < copy).flatMap(placed);
            let pickups = 0, claimed = 0;
            for (const taker of own) {
                for (const q of taker.phases) {
                    pickups++;
                    const travel = (other: { edge: number }) => (taker.edge - other.edge) / tiles_per_tick;
                    if (earlier.some(other => other.phases.some(p => onCycle(q - p - travel(other), T) < stack_ticks - 1e-9))) claimed++;
                }
            }
            const same = row.takers.find(taker => taker.copy === copy && taker.inserter_id === first?.inserter_id);
            return { copy: copy + 1, travel_ticks: same === undefined || first === undefined ? 0 : round((same.edge_tiles - first.edge_tiles) / tiles_per_tick),
                pickups, claimed, ...input.moved(copy) };
        }) };
}

/** The ticks of the window cycle on which pickups of an item fall, from tick `from` up to, not including, `to`, once each */
export function pickupPhasesOf(pickups: readonly HandDropped[], item: string, from: number, to: number, window_cycle_ticks: number): number[] {
    const phases = new Set<number>();
    for (const it of pickups) {
        if (it.item !== item || it.tick < from || it.tick >= to) continue;
        phases.add(it.tick - cycleStartOf(cycleOfTick(it.tick, window_cycle_ticks), window_cycle_ticks));
    }
    return [...phases].sort((a, b) => a - b);
}

/** The ticks in which a window of a copy's takers was open, and in which the lane moved at their reach then */
export function movedAtReach(records: readonly TakerConditions[], lane: 1 | 2, from: number, to: number): { open_ticks: number; moved_ticks: number } {
    let open_ticks = 0, moved_ticks = 0;
    for (const record of records) {
        for (let tick = Math.max(from, record.first_tick); tick < Math.min(to, record.last_tick + 1); tick++) {
            if (!record.windowOpen(tick)) continue;
            open_ticks++;
            if (record.movedAt(tick, lane)) moved_ticks++;
        }
    }
    return { open_ticks, moved_ticks };
}

/** What a missed swing is given as its reason: the condition the hand waited for when its window closed, or none (`left_over`) */
export type MissedSwingCondition = HandCondition | "left_over";

/** The missed swings of one taker of one copy that loses swings, with its pickups and what each window cycle's hand waited for */
export interface MissedSwings {
    /** The copy, counted from the lane's entry: 1 is the config's own */
    copy: number;
    inserter_id: number;
    belt_id: number;
    lanes: number[];
    item: string;
    /** What the loss is put down to: the lane, or the copy's side belt full at its join onto the output belt (`SharedLaneLoss.join_full`) */
    cause?: "lane" | "join_full";
    /** Its pickups in the judged span: [window cycle of the span from 1, tick of the window cycle, lane (0 where no lane says)] */
    pickups: [number, number, number][];
    /** Each window cycle with a missed swing */
    window_cycles: {
        window_cycle: number;
        missed: number;
        /** What the hand waited for at the close of the last opening of the window cycle that closed on a wait; `left_over` where none did */
        condition: MissedSwingCondition;
        /** What it waited for at the close of each opening of the window cycle */
        at_close: AtClose[];
        /** The class the result's rows give the window cycle (`MissedSwingCause`) */
        stop_class: string;
    }[];
    /** Missed swings by their condition */
    by_condition: Partial<Record<MissedSwingCondition, number>>;
    /** Its hand starts in the judged span by their last condition */
    starts_by_last: Partial<Record<HandCondition, number>>;
}

/**
 * The missed swings of one taker of one copy from its record. `missed` gives, for each window cycle of the span (from 1)
 * with a missed swing, the swings missed and the class the result gives it. The openings of a window cycle are those that
 * open in it. A taker whose window is always open (or not read) has no close in the window cycle: what its hand waited for
 * at the window cycle's last tick is taken.
 */
export function missedSwingsOf(input: { record: TakerConditions; copy: number; inserter_id: number; belt_id: number; lanes: number[]; item: string;
    first_cycle: number; end_cycle: number; window_cycle_ticks: number;
    missed: readonly { window_cycle: number; missed: number; cause: string }[] }): MissedSwings {
    const { record, first_cycle, end_cycle, window_cycle_ticks: T } = input;
    const from = cycleStartOf(first_cycle, T), to = cycleStartOf(end_cycle, T);
    const pickups: [number, number, number][] = [];
    for (let tick = Math.max(from, record.first_tick); tick < Math.min(to, record.last_tick + 1); tick++) {
        const lane = record.tookFrom(tick);
        if (lane === null) continue;
        const k = cycleOfTick(tick, T);
        pickups.push([k - first_cycle + 1, tick - cycleStartOf(k, T), lane]);
    }
    const openings = openingsOf(record, from, to);
    const by_condition: MissedSwings["by_condition"] = {};
    const window_cycles = input.missed.map(({ window_cycle, missed, cause }) => {
        const k = first_cycle + window_cycle - 1;
        const start = cycleStartOf(k, T), end = cycleStartOf(k + 1, T);
        const of_cycle = openings.filter(it => it.opens >= start && it.opens < end);
        const at_close = of_cycle.length > 0 ? of_cycle.map(it => it.at_close) : [waitedFor(record, end - 1)];
        const waits = at_close.filter((it): it is HandCondition => (HAND_CONDITIONS as readonly string[]).includes(it));
        const condition: MissedSwingCondition = waits.length > 0 ? waits[waits.length - 1] : "left_over";
        by_condition[condition] = (by_condition[condition] ?? 0) + missed;
        return { window_cycle, missed, condition, at_close, stop_class: cause };
    });
    const starts_by_last: MissedSwings["starts_by_last"] = {};
    for (const start of handStartsOf(record, from, to)) starts_by_last[start.last] = (starts_by_last[start.last] ?? 0) + 1;
    return { copy: input.copy, inserter_id: input.inserter_id, belt_id: input.belt_id, lanes: input.lanes, item: input.item, pickups, window_cycles, by_condition, starts_by_last };
}

/** One run of the copies the check judged by, as the log gives it */
export interface LoggedRun {
    /** The reading of the lanes of unknown end: 0 a dead end, 1 an infinite end */
    reading: number;
    /** The way the items of the first row move, as a map direction */
    flow: [number, number];
    /** Window cycles of the run; its judged span from `first_cycle` up to, not including, `end_cycle` */
    window_cycles: number;
    first_cycle: number;
    end_cycle: number;
    /** Losses that stood in it */
    losses: number;
    claimed_stacks: ClaimedStacks[];
}

/** What the check of the shared lanes kept for the log, beside the judgement: `for_log` of `SharedLaneJudgement` */
export interface SharedLanesForLog {
    /** For each reading of the lanes of unknown end, from the run of one copy alone: the lane load and the fill of each item of each belt */
    readings: { reading: number; lane_load: ClockLaneLoad[]; fill: LaneFill[] }[];
    /** The runs of the copies the check judged by */
    runs: LoggedRun[];
    /** For each loss of the judgement, in its order: its missed swings, with the run it was found in (an index of `runs`); null where no record was made */
    missed_swings: ({ run: number } & MissedSwings | null)[];
    /** What could not be read for the log, by its error: the parts it left out. Nothing of the judgement depends on them */
    errors: string[];
}
