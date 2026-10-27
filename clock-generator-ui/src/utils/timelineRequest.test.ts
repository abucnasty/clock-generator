import { expect, it } from 'vitest';
import type { Config } from 'clock-generator/browser';
import type { ClockAlternativeView } from '../worker/types';
import { settledPeriodLabel, timelineRequestFor } from './timelineRequest';
const config = { overrides: { backed_up_belts: false } } as Config;
const clock = { simulationDurationTicks: 100, terminalSwingCount: 2, clockWindows: {}, beltLabel: 'backed-up', fuelView: null } as ClockAlternativeView;
it('reproduces the other belt choice for legacy results without mutating the saved build', () => {
    expect(timelineRequestFor(config, clock, 'clock')?.config.overrides?.backed_up_belts).toBe(true);
    expect(config.overrides?.backed_up_belts).toBe(false);
    expect(timelineRequestFor(config, { ...clock, backedUpBelts: false }, 'clock')?.config.overrides?.backed_up_belts).toBe(false);
});
it('requires measured independent fuel clocks for an exact exported replay of older results', () => {
    const fuelClock = { ...clock, fuelView: {} } as ClockAlternativeView;
    expect(timelineRequestFor(config, fuelClock, 'clock')).toBeNull();
    expect(timelineRequestFor(config, { ...fuelClock, inserterClocks: {} }, 'clock')).not.toBeNull();
    expect(timelineRequestFor(config, fuelClock, 'plan')).not.toBeNull();
});
it('migrates old config and result names without changing their belt supply assumption', () => {
    const oldConfig = { overrides: { non_moving_belts: true } } as unknown as Config;
    const oldClock = { ...clock, beltLabel: '', nonMovingBelts: false };
    expect(timelineRequestFor(oldConfig, oldClock, 'clock')?.config.overrides).toEqual({ backed_up_belts: false });
    expect(timelineRequestFor(oldConfig, { ...clock, beltLabel: 'non-moving' }, 'clock')?.config.overrides)
        .toEqual({ backed_up_belts: true });
    expect(oldConfig.overrides).toEqual({ non_moving_belts: true });
});
it('asks the clock replay for the period the long run first judges, and no other replay', () => {
    const settled = { ...clock, simulationDurationTicks: 24, asBuilt: { first_judged_tick: 960 } } as ClockAlternativeView;
    expect(timelineRequestFor(config, settled, 'clock')?.settle_periods).toBe(40);
    expect(timelineRequestFor(config, settled, 'plan')).not.toHaveProperty('settle_periods');
    // judged from the first period, or no long run (or a result kept before it was carried): the replay is what it was
    expect(timelineRequestFor(config, { ...settled, asBuilt: { first_judged_tick: 0 } } as ClockAlternativeView, 'clock')).not.toHaveProperty('settle_periods');
    expect(timelineRequestFor(config, { ...settled, asBuilt: null }, 'clock')).not.toHaveProperty('settle_periods');
    expect(timelineRequestFor(config, clock, 'clock')).not.toHaveProperty('settle_periods');
});
it('says which period a settled replay shows, and says nothing of the first one', () => {
    const request = timelineRequestFor(config, { ...clock, simulationDurationTicks: 24, asBuilt: { first_judged_tick: 960 } } as ClockAlternativeView, 'clock');
    expect(settledPeriodLabel(request, { mode: 'clock', ticks_before_recording: 960 })).toBe('Period from tick 960, after the build has settled');
    expect(settledPeriodLabel(request, { mode: 'plan', ticks_before_recording: 240 })).toBeNull();
    expect(settledPeriodLabel(timelineRequestFor(config, clock, 'clock'), { mode: 'clock', ticks_before_recording: 240 })).toBeNull();
    expect(settledPeriodLabel(null, null)).toBeNull();
});
