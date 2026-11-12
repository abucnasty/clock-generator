import type { Config, RecordTimelineRequest, TimelineRecording } from 'clock-generator/browser';
import type { ClockAlternativeView } from '../worker/types';
import { migrateBeltSupplyOverrides } from 'clock-generator/light';
import { formatNumberText } from './numberText';

/**
 * Reproduce a candidate from its saved inputs. Never use the editable form or guess missing fuel clocks. A clock of this
 * engine (`replayReadsConfig`) replays the saved config as it is, so that each lane has the end its generation gave
 * it; a clock kept before gets the belt setting it was made for, as the switch.
 */
export function timelineRequestFor(config: Config | null | undefined, clock: ClockAlternativeView | null, mode: 'clock' | 'plan'): RecordTimelineRequest | null {
    if (!config || !clock || (mode === 'clock' && clock.inserterClocks === undefined && clock.fuelView)) return null;
    // Read former saved-result spellings only at this compatibility boundary.
    const overrides = migrateBeltSupplyOverrides(config.overrides) as Config['overrides'];
    const legacy = clock as ClockAlternativeView & { nonMovingBelts?: boolean };
    const backedUp = clock.backedUpBelts ?? legacy.nonMovingBelts ?? (['backed-up', 'non-moving'].includes(clock.beltLabel) ? true
        : clock.beltLabel.startsWith('moving') ? false : overrides?.backed_up_belts === true);
    // the clock's replay shows a window cycle the long run judges, not the first after warm-up, where it judges the build later
    const clock_tick = mode === 'clock' ? clock.asBuilt?.clock_tick_at_first_judged : undefined;
    const settle = mode === 'clock' && clock_tick === undefined
        ? Math.floor((clock.asBuilt?.first_judged_tick ?? 0) / clock.simulationDurationTicks) : 0;
    const replayed = !clock.replayReadsConfig ? { ...config, overrides: { ...overrides, backed_up_belts: backedUp } }
        : overrides === config.overrides ? config : { ...config, overrides };
    return { config: replayed, mode,
        window_cycle_ticks: clock.simulationDurationTicks, terminal_swing_count: clock.terminalSwingCount,
        windows: clock.clockWindows, inserter_clocks: clock.inserterClocks,
        ...(clock_tick !== undefined ? { settle_ticks: clock_tick } : settle > 0 ? { settle_window_cycles: settle } : {}) };
}

/** Which window cycle a settled replay shows; nothing where the replay is the first window cycle after the warm-up */
export function settledWindowCycleLabel(request: RecordTimelineRequest | null, recording: Pick<TimelineRecording, 'mode' | 'ticks_before_recording'> | null | undefined): string | null {
    return ((request?.settle_ticks ?? 0) > 0 || (request?.settle_window_cycles ?? 0) > 0) && recording?.mode === 'clock'
        ? `Window cycle from tick ${formatNumberText(recording.ticks_before_recording, { maxDecimals: 0 })}, at steady state` : null;
}
