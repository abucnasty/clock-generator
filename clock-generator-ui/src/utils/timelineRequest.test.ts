import { expect, it } from 'vitest';
import type { Config } from 'clock-generator/browser';
import type { ClockAlternativeView } from '../worker/types';
import { timelineRequestFor } from './timelineRequest';
const config = { overrides: { non_moving_belts: false } } as Config;
const clock = { simulationDurationTicks: 100, terminalSwingCount: 2, clockWindows: {}, beltLabel: 'non-moving', fuelView: null } as ClockAlternativeView;
it('reproduces the other belt choice for legacy results without mutating the saved build', () => {
    expect(timelineRequestFor(config, clock, 'clock')?.config.overrides?.non_moving_belts).toBe(true);
    expect(config.overrides?.non_moving_belts).toBe(false);
    expect(timelineRequestFor(config, { ...clock, nonMovingBelts: false }, 'clock')?.config.overrides?.non_moving_belts).toBe(false);
});
it('requires measured independent fuel clocks for an exact exported replay of older results', () => {
    const fuelClock = { ...clock, fuelView: {} } as ClockAlternativeView;
    expect(timelineRequestFor(config, fuelClock, 'clock')).toBeNull();
    expect(timelineRequestFor(config, { ...fuelClock, inserterClocks: {} }, 'clock')).not.toBeNull();
    expect(timelineRequestFor(config, fuelClock, 'plan')).not.toBeNull();
});
