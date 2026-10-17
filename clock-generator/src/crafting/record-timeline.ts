import { Config } from "../config";
import { EntityId } from "../entities";
import { OpenRange } from "../data-types";
import { Logger } from "../common/logger";
import { SerializableClockWindows } from "./clock";
import { MAX_SIMULATION_TICKS, runBuild, SerializableInserterClock } from "./plan/plan-run";
import { runClockOnBuild } from "./trial";
import { TimelineRecording } from "./timeline-recording";
import { InserterClock } from "./sequence/unplanned-inserter-clock";

export interface RecordTimelineRequest {
    config: Config;
    mode: "clock" | "plan";
    period_ticks: number;
    terminal_swing_count: number;
    windows: SerializableClockWindows;
    inserter_clocks?: Record<string, SerializableInserterClock>;
}

/** Replay the saved build, never the form being edited. This is independent of generation and its assessment. */
export function recordSimulationTimeline(request: RecordTimelineRequest): TimelineRecording {
    if (!Number.isFinite(request.period_ticks) || request.period_ticks <= 0 || request.period_ticks >= MAX_SIMULATION_TICKS) {
        throw new Error("This clock period cannot be recorded safely.");
    }
    const config = { ...request.config, overrides: { ...request.config.overrides, terminal_swing_count: request.terminal_swing_count, derive_clock_windows: false } };
    const logger: Logger = { log() {}, warn() {}, error() {}, debug() {} };
    const options = { logger, timeline_recording: { period_ticks: request.period_ticks }, factorio_states: false };
    const windows = new Map(Object.entries(request.windows).map(([id, ranges]) => [id, ranges.map(range => OpenRange.from(range.start, range.end))]));
    const fuel_clocks = new Map<string, InserterClock>(Object.entries(request.inserter_clocks ?? {}).map(([id, clock]) => [id, {
        ...clock, inserter_id: EntityId.forInserter(Number(id.split(":")[1])), window: OpenRange.from(clock.window.start, clock.window.end),
    }]));
    // The exported run includes circuit latency, explicit controls and the actual independent fuel clocks.
    const recording = request.mode === "clock"
        ? runClockOnBuild(config, windows, request.period_ticks, logger, options, fuel_clocks).timeline_recording
        : runBuild(config, options).timeline_recording;
    if (!recording) throw new Error("The simulator returned no detailed recording.");
    return { ...recording, mode: request.mode };
}
