import { Config } from "../config";
import { EntityId } from "../entities";
import { OpenRange } from "../data-types";
import { Logger } from "../common/logger";
import { SerializableClockWindows } from "./clock";
import { SIMULATION_BUDGET_TICKS, runBuild, SerializableInserterClock } from "./plan/unclocked-run";
import { runClockOnBuild } from "./trial";
import { TimelineRecording } from "./timeline-recording";
import { InserterClock } from "./sequence/unplanned-inserter-clock";

export interface RecordTimelineRequest {
    config: Config;
    mode: "clock" | "plan";
    window_cycle_ticks: number;
    terminal_swing_count: number;
    windows: SerializableClockWindows;
    inserter_clocks?: Record<string, SerializableInserterClock>;
    /**
     * Periods the clock runs from the cold start before the recorded one (mode "clock"): the clock's first judged tick
     * in periods, `as_built.first_judged_tick`, so that the recording shows a settled period. Absent: the first period
     * after the warm-up.
     */
    settle_window_cycles?: number;
    /**
     * Ticks the clock runs from the cold start before the recorded period (mode "clock"), the warm-up included: the tick
     * the long run judged the build from, `as_built.clock_tick_at_first_judged`, where the check names one (the new
     * dispatch). Takes precedence over `settle_periods`.
     */
    settle_ticks?: number;
}

/** Replay the saved build, never the form being edited. This is independent of generation and its assessment. */
export function recordSimulationTimeline(request: RecordTimelineRequest): TimelineRecording {
    if (!Number.isFinite(request.window_cycle_ticks) || request.window_cycle_ticks <= 0 || request.window_cycle_ticks >= SIMULATION_BUDGET_TICKS) {
        throw new Error("This clock period cannot be recorded safely.");
    }
    if (request.mode === "clock" && request.settle_ticks !== undefined
        && (!Number.isInteger(request.settle_ticks) || request.settle_ticks < 0
            || request.settle_ticks > request.window_cycle_ticks * Math.floor((SIMULATION_BUDGET_TICKS - 1) / request.window_cycle_ticks))) {
        throw new Error("This clock period cannot be recorded safely.");
    }
    const config = { ...request.config, overrides: { ...request.config.overrides, terminal_swing_count: request.terminal_swing_count, derive_clock_windows: false } };
    const logger: Logger = { log() {}, warn() {}, error() {}, debug() {} };
    const settling = request.mode !== "clock" ? {} : request.settle_ticks !== undefined ? {settle_ticks: request.settle_ticks}
        : request.settle_window_cycles !== undefined && request.settle_window_cycles > 0 ? {settle_window_cycles: Math.floor(request.settle_window_cycles)} : {};
    const options = { logger, timeline_recording: { window_cycle_ticks: request.window_cycle_ticks, ...settling }, factorio_states: false };
    const windows = new Map(Object.entries(request.windows).map(([id, ranges]) => [id, ranges.map(range => OpenRange.from(range.start, range.end))]));
    const fuel_clocks = new Map<string, InserterClock>(Object.entries(request.inserter_clocks ?? {}).map(([id, clock]) => [id, {
        ...clock, inserter_id: EntityId.forInserter(Number(id.split(":")[1])), window: OpenRange.from(clock.window.start, clock.window.end),
    }]));
    // The exported run includes circuit latency, explicit controls and the actual independent fuel clocks.
    const recording = request.mode === "clock"
        ? runClockOnBuild(config, windows, request.window_cycle_ticks, logger, options, fuel_clocks).timeline_recording
        : runBuild(config, options).timeline_recording;
    if (!recording) throw new Error("The simulator returned no detailed recording.");
    return { ...recording, mode: request.mode };
}
