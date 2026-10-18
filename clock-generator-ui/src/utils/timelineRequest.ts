import type { Config, RecordTimelineRequest } from 'clock-generator/browser';
import type { ClockAlternativeView } from '../worker/types';
import { migrateBeltSupplyOverrides } from 'clock-generator/light';

/** Reproduce a candidate from its saved inputs. Never use the editable form or guess missing fuel clocks. */
export function timelineRequestFor(config: Config | null | undefined, clock: ClockAlternativeView | null, mode: 'clock' | 'plan'): RecordTimelineRequest | null {
    if (!config || !clock || (mode === 'clock' && clock.inserterClocks === undefined && clock.fuelView)) return null;
    // Read former saved-result spellings only at this compatibility boundary.
    const overrides = migrateBeltSupplyOverrides(config.overrides) as Config['overrides'];
    const legacy = clock as ClockAlternativeView & { nonMovingBelts?: boolean };
    const backedUp = clock.backedUpBelts ?? legacy.nonMovingBelts ?? (['backed-up', 'non-moving'].includes(clock.beltLabel) ? true
        : clock.beltLabel.startsWith('moving') ? false : overrides?.backed_up_belts === true);
    return { config: { ...config, overrides: { ...overrides, backed_up_belts: backedUp } }, mode,
        period_ticks: clock.simulationDurationTicks, terminal_swing_count: clock.terminalSwingCount,
        windows: clock.clockWindows, inserter_clocks: clock.inserterClocks };
}
