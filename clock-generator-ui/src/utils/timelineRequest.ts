import type { Config, RecordTimelineRequest } from 'clock-generator/browser';
import type { ClockAlternativeView } from '../worker/types';

/** Reproduce a candidate from its saved inputs. Never use the editable form or guess missing fuel clocks. */
export function timelineRequestFor(config: Config | null | undefined, clock: ClockAlternativeView | null, mode: 'clock' | 'plan'): RecordTimelineRequest | null {
    if (!config || !clock || (mode === 'clock' && clock.inserterClocks === undefined && clock.fuelView)) return null;
    // Older saved results have the explicit technical belt label but predate nonMovingBelts.
    const nonMoving = clock.nonMovingBelts ?? (clock.beltLabel === 'non-moving' ? true
        : clock.beltLabel.startsWith('moving') ? false : config.overrides?.non_moving_belts === true);
    return { config: { ...config, overrides: { ...config.overrides, non_moving_belts: nonMoving } }, mode,
        period_ticks: clock.simulationDurationTicks, terminal_swing_count: clock.terminalSwingCount,
        windows: clock.clockWindows, inserter_clocks: clock.inserterClocks };
}
