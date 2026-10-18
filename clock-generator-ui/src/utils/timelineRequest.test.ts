import { expect, it } from 'vitest';
import type { Config } from 'clock-generator/browser';
import type { ClockAlternativeView } from '../worker/types';
import { timelineRequestFor } from './timelineRequest';
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
