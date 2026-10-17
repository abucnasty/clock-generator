import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from './configForm/formData';
import { readSavedConfig, serializeConfig } from '../hooks/usePersistedConfigForm';
import { contextKeyOf, defaultBuildViewContext, readBuildViewContext, removeBuildViewContext, restoreBuildViewContext, selectBuildEntity, writeBuildViewContext } from './buildViewContext';

describe('per-build working context', () => {
    it('isolates named builds with identical forms and removes only the deleted build', () => {
        const entries = new Map<string, string>();
        const storage = { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value); }, removeItem: (key: string) => { entries.delete(key); } };
        const form = createDefaultConfig();
        writeBuildViewContext(storage, 'one', { ...defaultBuildViewContext(), entityConfigKey: serializeConfig(form), configView: 'diagram', resultDetail: 'timeline' });
        writeBuildViewContext(storage, 'two', { ...defaultBuildViewContext(), entityConfigKey: serializeConfig(form), view: 'results', wakeAsTable: true });
        expect(readBuildViewContext(storage, 'one')).toMatchObject({ configView: 'diagram', resultDetail: 'timeline', wakeAsTable: false });
        expect(readBuildViewContext(storage, 'two')).toMatchObject({ configView: 'list', view: 'results', wakeAsTable: true });
        removeBuildViewContext(storage, 'one');
        expect([...entries.keys()]).toEqual([contextKeyOf('two')]);
    });

    it('rejects unsafe storage values and keeps navigation usable with denied storage', () => {
        const read = (value: unknown) => readBuildViewContext({ getItem: () => JSON.stringify(value) }, 'one');
        expect(read({ version: 2, view: 'results' })).toEqual(defaultBuildViewContext());
        expect(readBuildViewContext({ getItem: () => '{broken' }, 'one')).toEqual(defaultBuildViewContext());
        const loaded = read({ version: 1, view: 'unknown', resultDetail: 'install', sections: { advanced: true, selector: true },
            comparison: { allColumns: 'true', showUnstable: true }, position: { configure: { anchor: 'build', offset: 90000 }, results: { anchor: '#arbitrary', offset: 100 } },
            timeline: { sortMode: 'invented', statuses: { machine: ['WORKING', 'arbitrary'] } } });
        expect(loaded).toMatchObject({ view: 'configure', resultDetail: 'timeline', sections: { advanced: true }, comparison: { allColumns: false, showUnstable: true }, position: { configure: { anchor: 'build', offset: 4000 } }, timeline: { sortMode: 'byType', statuses: { machine: ['WORKING'] } } });
        expect(read({ version: 1, position: { configure: { anchor: 'build', offset: '100' } } }).position).toEqual({});
        const denied = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => { throw new Error('denied'); } };
        expect(readBuildViewContext(denied, 'one')).toEqual(defaultBuildViewContext());
        expect(() => { writeBuildViewContext(denied, 'one', loaded); removeBuildViewContext(denied, 'one'); }).not.toThrow();
    });

    it('restores UUID-regenerated identity, but clears changed/renumbered occupants and unavailable result routes', () => {
        const form = createDefaultConfig();
        form.machines[0].recipe = 'iron-gear-wheel';
        const saved = { ...defaultBuildViewContext(), view: 'results' as const, detailsTab: 'fuel' as const,
            entity: selectBuildEntity(form, { kind: 'machine', id: 1 }), entityConfigKey: serializeConfig(form),
            position: { results: { anchor: 'clock-context' as const, offset: 75 } }, sections: { 'machine-facts:1': true, 'machine-facts:99': true, 'insight:spare-time': true } };
        const reloaded = readSavedConfig(serializeConfig(form))!;
        expect(reloaded.machines[0]._uuid).not.toBe(form.machines[0]._uuid);
        expect(restoreBuildViewContext(saved, reloaded, true, true, ['spare-time'])).toMatchObject({ entity: saved.entity, position: saved.position, sections: { 'machine-facts:1': true, 'insight:spare-time': true } });
        const changed = { ...reloaded, machines: [{ ...reloaded.machines[0], recipe: 'copper-cable' }] };
        expect(restoreBuildViewContext(saved, changed, false, false)).toMatchObject({ view: 'configure', detailsTab: 'insights', entity: null, position: {}, sections: {} });
        // Even an identical new occupant with the same numeric ID cannot borrow the old selection after a structural edit.
        const renumbered = { ...reloaded, machines: [reloaded.machines[0], { ...reloaded.machines[0], id: 2 }] };
        expect(restoreBuildViewContext(saved, renumbered, true, true).entity).toBeNull();
    });
});
