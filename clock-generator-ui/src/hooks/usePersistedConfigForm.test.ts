import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChestType } from 'clock-generator/light';
import { createDefaultConfig, type ConfigFormData } from '../utils/configForm/formData';
import { backUpSavedConfig, readSavedConfig, serializeConfig } from './usePersistedConfigForm';

afterEach(() => {
    vi.restoreAllMocks();
});

describe('readSavedConfig', () => {
    it('reads the saved form state with the legacy fields migrated', () => {
        const saved = JSON.stringify({
            target_output: { recipe: 'iron-gear-wheel', items_per_second: 1, copies: 1 },
            machines: [{ id: 1, recipe: 'iron-gear-wheel', productivity: 0, crafting_speed: 1 }],
            inserters: [{ source: { type: 'machine', id: 1 }, sink: { type: 'chest', id: 1 }, stack_size: 16 }],
            chests: [{ id: 1, storage_size: 2, item_filter: 'iron-gear-wheel' }],
        });
        const config = readSavedConfig(saved);
        expect(config?.chests[0]).toMatchObject({ type: ChestType.BUFFER_CHEST, id: 1, storage_size: 2 });
        expect(config?.inserters[0].id).toBe(1);
        expect(config?.machines[0]._uuid).toEqual(expect.any(String));
    });

    it('gives null for what is not the form state', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => { });
        expect(readSavedConfig('{ not json')).toBeNull();
        expect(readSavedConfig('{"machines": []}')).toBeNull();
        expect(readSavedConfig('{"target_output": {}, "machines": [], "chests": 3}')).toBeNull();
    });
});

describe('serializeConfig', () => {
    it('keeps the forced flag of an inserter through a save and a reload, and leaves out the uuids', () => {
        const form: ConfigFormData = {
            ...createDefaultConfig(),
            inserters: [
                {
                    id: 1, _uuid: 'inserter-1', source: { type: 'belt', id: 1 }, sink: { type: 'machine', id: 1 }, stack_size: 16,
                    overrides: { enable_control: { mode: 'ALWAYS' } }, _forced_always: true,
                },
                { id: 2, _uuid: 'inserter-2', source: { type: 'machine', id: 1 }, sink: { type: 'belt', id: 1 }, stack_size: 16 },
            ],
        };
        const text = serializeConfig(form);
        expect(text).not.toContain('_uuid');
        const reloaded = readSavedConfig(text);
        expect(reloaded?.inserters[0]._forced_always).toBe(true);
        expect('_forced_always' in reloaded!.inserters[1]).toBe(false);
    });
});

describe('backUpSavedConfig', () => {
    it('keeps the saved config under the backup key and says where', () => {
        const storage = new Map<string, string>();
        const message = backUpSavedConfig({ setItem: (key, value) => storage.set(key, value) }, '{"broken": true}');
        expect(storage.get('clock-generator-config.backup')).toBe('{"broken": true}');
        expect(message).toContain('could not be loaded');
        expect(message).toContain('"clock-generator-config.backup"');
    });

    it('says so when the copy cannot be kept, and logs the config instead', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => { });
        const message = backUpSavedConfig({ setItem: () => { throw new Error('quota exceeded'); } }, '{"broken": true}');
        expect(message).toContain('could not be kept');
        expect(warn).toHaveBeenCalledWith(expect.any(String), '{"broken": true}', expect.any(Error));
    });
});
