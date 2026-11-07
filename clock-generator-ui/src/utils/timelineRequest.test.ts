import { expect, it } from 'vitest';
import type { Config } from 'clock-generator/browser';
import type { ClockAlternativeView } from '../worker/types';
import { settledWindowCycleLabel, timelineRequestFor } from './timelineRequest';
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
    expect(timelineRequestFor(config, settled, 'clock')?.settle_window_cycles).toBe(40);
    expect(timelineRequestFor(config, settled, 'plan')).not.toHaveProperty('settle_window_cycles');
    // judged from the first period, or no long run (or a result kept before it was carried): the replay is what it was
    expect(timelineRequestFor(config, { ...settled, asBuilt: { first_judged_tick: 0 } } as ClockAlternativeView, 'clock')).not.toHaveProperty('settle_window_cycles');
    expect(timelineRequestFor(config, { ...settled, asBuilt: null }, 'clock')).not.toHaveProperty('settle_window_cycles');
    expect(timelineRequestFor(config, clock, 'clock')).not.toHaveProperty('settle_window_cycles');
});
it('uses the measured clock origin rather than the judged stock index when both are available', () => {
    const measured = { ...clock, simulationDurationTicks: 24,
        asBuilt: { first_judged_tick: 960, clock_tick_at_first_judged: 1200 } } as ClockAlternativeView;
    expect(timelineRequestFor(config, measured, 'clock')?.settle_ticks).toBe(1200);
    expect(timelineRequestFor(config, measured, 'plan')).not.toHaveProperty('settle_window_cycles');
    expect(timelineRequestFor(config, measured, 'plan')).not.toHaveProperty('settle_ticks');
    expect(timelineRequestFor(config, { ...measured, asBuilt: { clock_tick_at_first_judged: 1201 } } as ClockAlternativeView, 'clock')?.settle_ticks).toBe(1201);
    expect(settledWindowCycleLabel(timelineRequestFor(config, measured, 'clock'), { mode: 'clock', ticks_before_recording: 1200 }))
        .toBe('Window cycle from tick 1200, at steady state');
});
it('says which period a settled replay shows, and says nothing of the first one', () => {
    const request = timelineRequestFor(config, { ...clock, simulationDurationTicks: 24, asBuilt: { first_judged_tick: 960 } } as ClockAlternativeView, 'clock');
    expect(settledWindowCycleLabel(request, { mode: 'clock', ticks_before_recording: 960 })).toBe('Window cycle from tick 960, at steady state');
    expect(settledWindowCycleLabel(request, { mode: 'plan', ticks_before_recording: 240 })).toBeNull();
    expect(settledWindowCycleLabel(timelineRequestFor(config, clock, 'clock'), { mode: 'clock', ticks_before_recording: 240 })).toBeNull();
    expect(settledWindowCycleLabel(null, null)).toBeNull();
});
