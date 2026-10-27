import type { Config, RecordTimelineRequest, TimelineRecording } from 'clock-generator/browser';
import type { ClockAlternativeView } from '../worker/types';
import { migrateBeltSupplyOverrides } from 'clock-generator/light';
import { formatNumberText } from './numberText';

/** Reproduce a candidate from its saved inputs. Never use the editable form or guess missing fuel clocks. */
export function timelineRequestFor(config: Config | null | undefined, clock: ClockAlternativeView | null, mode: 'clock' | 'plan'): RecordTimelineRequest | null {
    if (!config || !clock || (mode === 'clock' && clock.inserterClocks === undefined && clock.fuelView)) return null;
    // Read former saved-result spellings only at this compatibility boundary.
    const overrides = migrateBeltSupplyOverrides(config.overrides) as Config['overrides'];
    const legacy = clock as ClockAlternativeView & { nonMovingBelts?: boolean };
    const backedUp = clock.backedUpBelts ?? legacy.nonMovingBelts ?? (['backed-up', 'non-moving'].includes(clock.beltLabel) ? true
        : clock.beltLabel.startsWith('moving') ? false : overrides?.backed_up_belts === true);
    // the clock's replay shows a period the long run judges, not the first after warm-up, where it judges the build later
    const settle = mode === 'clock' ? Math.floor((clock.asBuilt?.first_judged_tick ?? 0) / clock.simulationDurationTicks) : 0;
    return { config: { ...config, overrides: { ...overrides, backed_up_belts: backedUp } }, mode,
        period_ticks: clock.simulationDurationTicks, terminal_swing_count: clock.terminalSwingCount,
        windows: clock.clockWindows, inserter_clocks: clock.inserterClocks, ...(settle > 0 && { settle_periods: settle }) };
}

/** Which period a settled replay shows; nothing where the replay is the first period after the warm-up */
export function settledPeriodLabel(request: RecordTimelineRequest | null, recording: Pick<TimelineRecording, 'mode' | 'ticks_before_recording'> | null | undefined): string | null {
    return request?.settle_periods && recording?.mode === 'clock'
        ? `Period from tick ${formatNumberText(recording.ticks_before_recording, { maxDecimals: 0 })}, after the build has settled` : null;
}
