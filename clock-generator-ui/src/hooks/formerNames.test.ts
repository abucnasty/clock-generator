import { describe, expect, it } from 'vitest';
import { readConfigFile, readSavedConfig } from './usePersistedConfigForm';
import { readSidecarExport } from '../utils/sidecarExport';

// A build saved by the site before the setpoint was named so keeps its `target_output`, and `loop_seed_items` in its overrides.
const former = (extra: object = {}) => JSON.stringify({
    target_output: { recipe: 'iron-gear-wheel', items_per_second: 2, copies: 1 },
    machines: [{ id: 1, recipe: 'iron-gear-wheel', productivity: 0, crafting_speed: 1.25 }],
    inserters: [], belts: [], chests: [], overrides: { loop_seed_items: 40 }, ...extra,
});

describe('a build saved or exported under the former names', () => {
    it('is read from the browser\'s storage with its setpoint and its kick start', () => {
        const form = readSavedConfig(former())!;
        expect(form.setpoint).toMatchObject({ recipe: 'iron-gear-wheel', items_per_second: 2 });
        expect(form.overrides).toEqual({ kick_start_items: 40 });
        expect('target_output' in form).toBe(false);
    });

    it('is read from an imported file with its setpoint and its kick start', () => {
        expect(readConfigFile(former())).toMatchObject({ setpoint: { recipe: 'iron-gear-wheel' }, overrides: { kick_start_items: 40 } });
    });

    it('is told for a build file, not read as an export of the mod', () => {
        expect(readSidecarExport(former())).toEqual({ kind: 'problem', problem: 'build-file' });
    });
});

// A build saved or exported before the window cycle time was named so keeps `period_duration_ticks` in each Clocked override.
const clockedBefore = (extra: object = {}) => ({ mode: 'CLOCKED', ranges: [{ start: 0, end: 10 }], period_duration_ticks: 120, ...extra });
const withClocked = (inserter: object, drill: object) => JSON.stringify({
    setpoint: { recipe: 'iron-gear-wheel', items_per_second: 2, copies: 1 },
    machines: [{ id: 1, recipe: 'iron-gear-wheel', productivity: 0, crafting_speed: 1.25 }],
    inserters: [{ source: { type: 'machine', id: 1 }, sink: { type: 'chest', id: 1 }, stack_size: 16, overrides: { enable_control: inserter } }],
    belts: [], chests: [],
    drills: { configs: [{ id: 1, type: 'electric-mining-drill', mined_item_name: 'iron-ore', speed_bonus: 0, productivity: 0,
        target: { type: 'chest', id: 1 }, overrides: { enable_control: drill } }] },
});
type Overridden = { inserters: { overrides: { enable_control: object } }[]; drills: { configs: { overrides: { enable_control: object } }[] } };
const cycleOf = (config: unknown) => { const { inserters, drills } = config as Overridden; return [inserters[0].overrides.enable_control, drills.configs[0].overrides.enable_control]; };

describe('a build saved or exported under the former period_duration_ticks', () => {
    const text = withClocked(clockedBefore(), clockedBefore({ period_duration_ticks: 240 }));

    it('is read from the browser\'s storage in each inserter and each drill', () => {
        const [inserter, drill] = cycleOf(readSavedConfig(text));
        expect(inserter).toMatchObject({ window_cycle_ticks: 120 });
        expect(drill).toMatchObject({ window_cycle_ticks: 240 });
        expect(inserter).not.toHaveProperty('period_duration_ticks');
        expect(drill).not.toHaveProperty('period_duration_ticks');
    });

    it('is read from an imported file in each inserter and each drill', () => {
        const [inserter, drill] = cycleOf(readConfigFile(text));
        expect(inserter).toMatchObject({ window_cycle_ticks: 120 });
        expect(drill).toMatchObject({ window_cycle_ticks: 240 });
        expect(inserter).not.toHaveProperty('period_duration_ticks');
    });

    it('keeps the window_cycle_ticks of an override that carries both', () => {
        const both = withClocked(clockedBefore({ window_cycle_ticks: 60 }), clockedBefore({ window_cycle_ticks: 90 }));
        const [inserter, drill] = cycleOf(readConfigFile(both));
        expect(inserter).toMatchObject({ window_cycle_ticks: 60 });
        expect(drill).toMatchObject({ window_cycle_ticks: 90 });
        expect(inserter).not.toHaveProperty('period_duration_ticks');
    });
});
