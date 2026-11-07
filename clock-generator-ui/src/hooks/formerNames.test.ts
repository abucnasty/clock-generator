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
