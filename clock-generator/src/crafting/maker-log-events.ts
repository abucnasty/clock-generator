import type { Config } from "../config";
import type { ClockAlternative, ClockAlternativesResult } from "./alternatives";
import { isNotChecked, type SharedLaneLoss } from "./shared-lane-verdict";
import { modelLanesOf } from "./shared-lane-lanes";
import type { DisturbanceTrialVerdict, TrialCount } from "./disturbance-trial";
import type { Logger } from "../common/logger";
import { clockLanesOf, clockRunOf, MAKER_LOG_FORMAT, reasonOf, reasonOfError, repeatCheckOn, runOfOneCopyOf, timedCheck, type MakerLogEvent, type MakerReason } from "./maker-log";
import { repeatCheckOf } from "./repeat-check";
import { jobLaneLoadsOf } from "./shared-lane-log";
import { wakeUpsCountOf } from "./wake-ledger";

/**
 * The events of a finished generation that are read from its result (`job`, `clock`, `windows`, `not_made`): the clocks it
 * lists, their windows, and the makers that made none. Nothing is computed that the generation did not: a field is read
 * off the result, or the config's own lanes (`modelLanesOf`, a function of the config alone).
 */

/** A lane as the log names it */
interface LaneName {
    belt_id: number;
    lane: number;
    item: string;
}

const laneNameOf = (config: Config, belt_id: number, lane: number): LaneName =>
    ({ belt_id, lane, item: config.belts.find(belt => belt.id === belt_id)?.lanes[lane - 1]?.ingredient ?? "" });

/** The `job` event: the copies, where they stand, the lanes they share and the lanes whose end is not known */
export function jobEvent(config: Config): MakerLogEvent {
    const lanes = modelLanesOf(config);
    return {
        event: "job", format: MAKER_LOG_FORMAT, recipe: config.setpoint.item, copies: config.setpoint.copies ?? 1,
        copy_offset: config.setpoint.copy_offset === undefined ? null : { x: config.setpoint.copy_offset.x, y: config.setpoint.copy_offset.y },
        shared_lanes: lanes.filter(lane => lane.shared).map(lane => laneNameOf(config, lane.belt_id, lane.lane)),
        unknown_end_lanes: lanes.filter(lane => !lane.shared).map(lane => laneNameOf(config, lane.belt_id, lane.lane)),
    };
}

/** The swings the copies lose on each lane: the lane, its item, the copies that lose, the takers that lose and the swings they lose */
function laneLossesOf(config: Config, losses: readonly SharedLaneLoss[]) {
    const rows = new Map<string, { belt_id: number; lane: number; item: string; copies: number[]; takers_losing: number; swings_lost: number }>();
    for (const loss of losses) {
        const key = `${loss.belt_id}/${loss.lane}`;
        const row = rows.get(key) ?? { ...laneNameOf(config, loss.belt_id, loss.lane), item: loss.item, copies: [], takers_losing: 0, swings_lost: 0 };
        row.takers_losing++;
        if (!row.copies.includes(loss.copy)) row.copies.push(loss.copy);
        row.swings_lost += loss.alone_swings - loss.swings;
        rows.set(key, row);
    }
    return [...rows.values()];
}

/** The losses a trial did not get back from, as numbers: the kind and items of the loss, and its trials */
function failedLossesOf(counts: readonly TrialCount[] | undefined) {
    return (counts ?? []).map(count => ({ loss: count.loss.kind, items: count.loss.items, trials_planned: count.planned, trials_run: count.run,
        trials_recovered: count.recovered, cut_at: count.first_not_recovered.cut_at, loss_ticks: count.first_not_recovered.loss_ticks }));
}

/**
 * The loss trials of a clock. `one_copy`: whether the clock gets back from every loss on one copy (null where they could not be
 * tried) and the losses it does not. `copies`: the same on the copies that share a lane, null where they were not made.
 * A copy count is the copy counted from the lanes' entry.
 */
function lossTrialsOf(trial: DisturbanceTrialVerdict | null) {
    if (trial === null) return { one_copy: null, copies: null };
    const copies = trial.on_copies;
    // the trials on the copies are made only for a clock that gets back on one copy, so a verdict with them is one of a clock that did
    const one_copy_survives = copies !== undefined ? true : trial.survives;
    return {
        one_copy: { survives: one_copy_survives, failed: copies !== undefined ? [] : failedLossesOf(trial.trial_counts),
            not_tried: copies !== undefined ? 0 : trial.not_tried?.length ?? 0 },
        copies: copies === undefined ? null : { survives: copies.survives, failed: failedLossesOf(copies.trial_counts),
            copies_short: (copies.short ?? []).map(short => short.copy), tried: copies.not_tried === undefined },
    };
}

/** The `clock` event of a listed clock */
export function clockEvent(config: Config, alternative: ClockAlternative, listed_index: number, selected: boolean): MakerLogEvent {
    const { assessment } = alternative;
    const losses = assessment.shared_lane_losses ?? [];
    const trials = lossTrialsOf(assessment.disturbance_trial);
    return {
        event: "clock", id: alternative.id, maker: alternative.maker, listed_index, selected, verdict: alternative.verdict, holds: assessment.holds,
        meets_target_rate: alternative.ranking.meets_target_rate,
        window_cycle_ticks: alternative.result.subtick?.clock.window_cycle_ticks ?? alternative.result.simulation_duration.ticks,
        wake_ups: alternative.result.stability_check?.as_built?.wake_ups?.wake_ups_per_minute ?? null,
        ranked_wake_ups: alternative.ranking.wake_ups_per_minute,
        shared_lane_losses: laneLossesOf(config, losses.filter((loss): loss is SharedLaneLoss => !isNotChecked(loss))),
        shared_lanes_not_checked: losses.some(isNotChecked),
        loss_trials: { ...trials, one_copy_not_tried: assessment.disturbance_trial === null && assessment.holds },
    };
}

/**
 * The `composition` event of the clock Coordinated Sources made: listed, or made and not listed (`reason`). It carries what the checks
 * found of the clock, as a `clock` event does, whether the clock is listed or not.
 */
export function madeCompositionEvent(config: Config, alternative: ClockAlternative, outcome: "listed" | "dropped", reason: MakerReason | null): MakerLogEvent {
    const { event: _event, id: _id, maker: _maker, listed_index: _index, selected: _selected, window_cycle_ticks, wake_ups, ...found } = clockEvent(config, alternative, 0, false);
    return { event: "composition", outcome, final: true, window_cycle_ticks, wake_ups, parts: alternative.result.coordinated_sources?.parts ?? null, reason, ...found };
}

/** The `windows` event of a listed clock: the windows of each inserter and drill in ticks of the window cycle, and for a Coordinated Sources clock the clock each source's windows came from */
export function windowsEvent(alternative: ClockAlternative): MakerLogEvent {
    const windows = alternative.result.clock_windows;
    return {
        event: "windows", id: alternative.id, window_cycle_ticks: alternative.result.subtick?.clock.window_cycle_ticks ?? alternative.result.simulation_duration.ticks,
        windows: Object.fromEntries(Object.keys(windows).sort().map(id => [id, windows[id].map(range => [range.start, range.end])])),
        ...(alternative.result.coordinated_sources !== undefined && { source_clocks: alternative.result.coordinated_sources.parts }),
    };
}

/** The `not_made` event of a maker that made no clock, with the reason the site gave it (`other` where it gave none) */
export function notMadeEvent(id: string, reason: MakerReason): MakerLogEvent {
    return { event: "not_made", id, reason };
}

/** Whether the check of the shared lanes runs the takers of the copies together on a lane of the config */
const hasSharedLane = (config: Config) => modelLanesOf(config).some(lane => lane.shared);

/**
 * The `job_lanes` event of a job whose copies share a lane: what the config states of the lanes and the copies, and the
 * lane load of each take on a belt, from the config alone (`jobLaneLoadsOf`)
 */
export function jobLanesEvent(config: Config): MakerLogEvent {
    let lane_loads: ReturnType<typeof jobLaneLoadsOf> | null;
    try {
        lane_loads = jobLaneLoadsOf(config);
    } catch {
        // the loads come from the planner's output cycle, which a config it refuses has none of
        lane_loads = null;
    }
    return { event: "job_lanes", output_belt_stated: config.output_belt !== undefined, copy_offset_stated: config.setpoint.copy_offset !== undefined, lane_loads };
}

/** A hash of a clock's windows as the `windows` event gives them (FNV-1a, 32 bits, hex), to join the events of one clock */
export function windowsHashOf(windows: Record<string, readonly (readonly [number, number])[]>): string {
    const text = JSON.stringify(windows);
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
}

/**
 * The `lane_facts` event of a listed clock of a job whose copies share a lane: the facts of its lanes from the runs of its
 * check with the copies, or the reason they were not made (`not_run_with_copies`: the clock does not hold on one copy, the
 * check stopped with an error, or it ran no lane)
 */
export function laneFactsEvent(alternative: ClockAlternative): MakerLogEvent {
    const windows = windowsEvent(alternative);
    const lanes = clockLanesOf(alternative.result);
    const cause = lanes === undefined ? "not_noted" : !lanes.held ? "does_not_hold_one_copy" : lanes.not_checked ? "lanes_not_checked"
        : lanes.for_log === null ? "no_lane_run" : null;
    const head = { event: "lane_facts", id: alternative.id, window_cycle_ticks: windows.window_cycle_ticks,
        windows_hash: windowsHashOf(windows.windows as Record<string, [number, number][]>) };
    if (cause !== null || lanes?.for_log == null) return { ...head, reason: reasonOf("not_run_with_copies", { cause: cause ?? "no_lane_run" }), readings: [], runs: [], errors: [] };
    // the timetable of each run is in the clock's `timetable` event
    return { ...head, reason: null, readings: lanes.for_log.readings, runs: lanes.for_log.runs.map(({ timetable: _timetable, ...run }) => run), errors: lanes.for_log.errors };
}

/** The wakeups the record holds of a listed clock (`AsBuiltStabilityCheck.wake_ups`), the object the log keeps its run of one copy by */
const recordWakeUpsOf = (alternative: ClockAlternative) => alternative.result.stability_check?.as_built?.wake_ups;

/**
 * The `timetable` event of a listed clock: the timetable of its run of one copy whose wakeups the record holds, over the ticks
 * they are counted on, and of each run of the copies the check of the shared lanes judged it by, over its judged span
 */
export function timetableEvent(alternative: ClockAlternative): MakerLogEvent {
    const windows = windowsEvent(alternative);
    const wake_ups = recordWakeUpsOf(alternative);
    const one = wake_ups === undefined ? undefined : runOfOneCopyOf(wake_ups);
    const cause = wake_ups === undefined ? "no_long_run" : one === undefined ? "not_noted" : one.timetable === null ? "not_read" : null;
    const copies = (clockLanesOf(alternative.result)?.for_log?.runs ?? []).flatMap((run, index) => run.timetable === undefined ? []
        : [{ run: index, reading: run.reading, ...run.timetable }]);
    return { event: "timetable", id: alternative.id, window_cycle_ticks: windows.window_cycle_ticks,
        windows_hash: windowsHashOf(windows.windows as Record<string, [number, number][]>),
        reason: cause === null ? null : reasonOf("no_run_of_one_copy", { cause }),
        one_copy: one?.timetable == null ? null : { ...one.timetable, ticks_before_stock: one.ticks_before_stock },
        copies, errors: one?.errors ?? [] };
}

/**
 * The `ledger` event of a listed clock: the wakeups of its run of one copy by inserter, list and cause, the ghosts apart, and
 * whether they add up to the wakeups the record holds (`adds_up`: the same count over the same ticks)
 */
export function ledgerEvent(alternative: ClockAlternative): MakerLogEvent {
    const wake_ups = recordWakeUpsOf(alternative);
    const one = wake_ups === undefined ? undefined : runOfOneCopyOf(wake_ups);
    const ledger = one?.ledger ?? null;
    const cause = wake_ups === undefined ? "no_long_run" : one === undefined ? "not_noted" : ledger === null ? "not_read" : null;
    const record = wake_ups === undefined ? null : { wake_ups: wakeUpsCountOf(wake_ups.wake_ups_per_minute, wake_ups.ticks), ticks: wake_ups.ticks, wake_ups_per_minute: wake_ups.wake_ups_per_minute };
    const adds_up = ledger === null || record === null ? null
        : ledger.ticks === record.ticks && ledger.wake_ups === record.wake_ups && ledger.wake_ups_per_minute === record.wake_ups_per_minute;
    return { event: "ledger", id: alternative.id, reason: cause === null ? null : reasonOf("no_run_of_one_copy", { cause }), record, adds_up,
        ...(ledger === null ? { ledger: null } : { ledger }) };
}

/**
 * The `repeat_check` event of a listed clock, made only where the generation asks for the repeat check: the clock that holds on
 * one copy run again on its windows narrowed to the ticks its run needed (repeat-check.ts)
 */
export function repeatCheckEvent(alternative: ClockAlternative, logger: Logger): MakerLogEvent {
    const head = { event: "repeat_check", id: alternative.id };
    const run = clockRunOf(alternative.result);
    const wake_ups = recordWakeUpsOf(alternative);
    const cause = !alternative.assessment.holds ? "does_not_hold_one_copy" : run === undefined ? "not_noted"
        : !Number.isInteger(run.window_cycle_ticks) ? "window_cycle_not_whole" : null;
    if (cause !== null || run === undefined) return { ...head, reason: reasonOf("not_repeat_checked", { cause: cause ?? "not_noted" }), check: null };
    const timetable = wake_ups === undefined ? null : runOfOneCopyOf(wake_ups)?.timetable ?? null;
    try {
        return { ...head, reason: null, check: timedCheck("repeat_check", () => repeatCheckOf(run, timetable, logger)) };
    } catch (error) {
        return { ...head, reason: reasonOf("not_repeat_checked", { cause: "error" }), check: null, error: error instanceof Error ? error.message : String(reasonOfError(error).code) };
    }
}

/** The `missed_swings` events of a listed clock: one for each loss on a lane the copies share with a record, in the order of its losses */
export function missedSwingsEvents(alternative: ClockAlternative): MakerLogEvent[] {
    const for_log = clockLanesOf(alternative.result)?.for_log ?? null;
    if (for_log === null) return [];
    return for_log.missed_swings.flatMap((missed, loss) => missed === null ? [] : [{ event: "missed_swings", id: alternative.id, loss, ...missed }]);
}

/**
 * The events a finished generation gives: the job, then each listed clock with its windows, its timetable and its ledger; for a
 * job whose copies share a lane, the facts of the lanes too; where the generation asks for it, each clock's repeat check
 */
export function resultEvents(config: Config, result: Pick<ClockAlternativesResult, "alternatives" | "selected_index">, logger: Logger): MakerLogEvent[] {
    const shared = hasSharedLane(config);
    const repeat = repeatCheckOn();
    return [jobEvent(config), ...(shared ? [jobLanesEvent(config)] : []), ...result.alternatives.flatMap((alternative, index) =>
        [clockEvent(config, alternative, index, index === result.selected_index), windowsEvent(alternative),
            ...(shared ? [laneFactsEvent(alternative), ...missedSwingsEvents(alternative)] : []),
            timetableEvent(alternative), ledgerEvent(alternative), ...(repeat ? [repeatCheckEvent(alternative, logger)] : [])])];
}
