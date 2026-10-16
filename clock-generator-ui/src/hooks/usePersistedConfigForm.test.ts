import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChestType } from 'clock-generator/light';
import { formDataToConfig } from '../utils/configForm/configMapping';
import * as edits from '../utils/configForm/edits';
import { createDefaultConfig, type ConfigFormData } from '../utils/configForm/formData';
import { backupKey } from '../utils/buildLibrary';
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

    it('loads a form saved with next ids, dropping them and keeping its ids as saved', () => {
        const saved = JSON.stringify({
            target_output: { recipe: 'iron-gear-wheel', items_per_second: 1, copies: 1 },
            machines: [1, 3].map((id) => ({ id, recipe: 'iron-gear-wheel', productivity: 0, crafting_speed: 1 })),
            inserters: [1, 4].map((id) => ({ id, source: { type: 'machine', id: 1 }, sink: { type: 'machine', id: 3 }, stack_size: 16 })),
            belts: [],
            chests: [],
            next_ids: { inserters: 9, machines: 7 },
        });
        const config = readSavedConfig(saved)!;
        expect('next_ids' in config).toBe(false);
        expect(config.machines.map((m) => m.id)).toEqual([1, 3]);
        expect(config.inserters.map((ins) => ins.id)).toEqual([1, 4]);
        expect(edits.addInserter(config).inserters.at(-1)!.id).toBe(5);
        expect('next_ids' in formDataToConfig(config)).toBe(false);
        expect(serializeConfig(config)).not.toContain('next_ids');
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
        const message = backUpSavedConfig({ setItem: (key, value) => storage.set(key, value) }, '{"broken": true}', backupKey('default'));
        expect(storage.get('clock-generator-config.backup')).toBe('{"broken": true}');
        expect(message).toContain('could not be loaded');
        expect(message).toContain('"clock-generator-config.backup"');
    });

    it("names a library build's own backup key", () => {
        const storage = new Map<string, string>();
        const message = backUpSavedConfig({ setItem: (key, value) => storage.set(key, value) }, '{"broken": true}', backupKey('abc'));
        expect(storage.get('clock-generator-build:abc.backup')).toBe('{"broken": true}');
        expect(message).toContain('"clock-generator-build:abc.backup"');
    });

    it('says so when the copy cannot be kept, and logs the config instead', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => { });
        const message = backUpSavedConfig({ setItem: () => { throw new Error('quota exceeded'); } }, '{"broken": true}', backupKey('default'));
        expect(message).toContain('could not be kept');
        expect(warn).toHaveBeenCalledWith(expect.any(String), '{"broken": true}', expect.any(Error));
    });
});


describe('fractional library document serialization', () => {
    it.each([5.5, 2.25, 0.5, 0.001, 0.0625, 0.0001, 1 / 3])('retains Copies %s and all metadata distinctions', copies => {
        const form = createDefaultConfig();
        form.target_output.copies = copies;
        form.inserters = ([
            { prototype: 'bulk-inserter', quality: 'normal' },
            { prototype: 'fast-inserter', quality: 'normal' },
            { prototype: 'bulk-inserter', quality: 'normal', stack_size: 8 },
            { prototype: 'bulk-inserter', quality: 'normal', stack_size: 16 },
            { stack_size: 16 },
            {},
        ] as const).map((metadata, i) => ({ ...metadata, id: i + 1, _uuid: `original-${i}`,
            source: { type: 'machine' as const, id: 1 }, sink: { type: 'belt' as const, id: 1 } }));
        const text = serializeConfig(form);
        const saved = JSON.parse(text);
        const reopened = readSavedConfig(text)!;
        const exported = JSON.parse(JSON.stringify(formDataToConfig(reopened)));
        expect(reopened.target_output.copies).toBe(copies);
        expect(exported.target_output.copies).toBe(copies);
        expect(serializeConfig(reopened)).toBe(text);
        for (let i = 0; i < saved.inserters.length; i++) {
            for (const field of ['prototype', 'quality', 'stack_size']) {
                expect(Object.hasOwn(exported.inserters[i], field)).toBe(Object.hasOwn(saved.inserters[i], field));
                expect(exported.inserters[i][field]).toEqual(saved.inserters[i][field]);
            }
            expect(reopened.inserters[i]._uuid).not.toBe(form.inserters[i]._uuid);
        }
        // This reader preserves editable data; the real worker/schema boundary is tested separately.
        expect(serializeConfig(form)).toBe(text);
    });
});
