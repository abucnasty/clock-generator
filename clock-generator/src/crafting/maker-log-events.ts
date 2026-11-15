import type { Config } from "../config";
import type { ClockAlternative, ClockAlternativesResult } from "./alternatives";
import { isNotChecked, type SharedLaneLoss } from "./shared-lane-verdict";
import { modelLanesOf } from "./shared-lane-lanes";
import type { DisturbanceTrialVerdict, TrialCount } from "./disturbance-trial";
import { MAKER_LOG_FORMAT, type MakerLogEvent, type MakerReason } from "./maker-log";

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
        event: "job", format: MAKER_LOG_FORMAT, recipe: config.setpoint.recipe, copies: config.setpoint.copies ?? 1,
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

/** The events a finished generation gives: the job, then each listed clock with its windows */
export function resultEvents(config: Config, result: Pick<ClockAlternativesResult, "alternatives" | "selected_index">): MakerLogEvent[] {
    return [jobEvent(config), ...result.alternatives.flatMap((alternative, index) =>
        [clockEvent(config, alternative, index, index === result.selected_index), windowsEvent(alternative)])];
}
