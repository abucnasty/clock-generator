import { describe, expect, it } from 'vitest';
import type { InserterFormData } from './configForm/formData';
import { configToFormData, formDataToConfig } from './configForm/configMapping';
import { createDefaultConfig } from './configForm/formData';
import { endpointUpdate } from './inserterMetadata';
import { pickupGeometryOf, pickupTypeOf, unsupportedPickupOf, withPickupType } from './pickupGeometry';
import { configKeyOf, generatedForOf, isStale } from './resultsStaleness';

describe('pickup type edits and saved assumptions', () => {
    const source: InserterFormData['source'] = { type: 'belt', id: 1, near_lane: 2 };
    it('defaults to straight belt and lets underground pickups be selected explicitly', () => {
        expect(pickupTypeOf(source)).toBe('side-straight');
        const underground = withPickupType(source, 'side-exit');
        expect(underground).toEqual({ ...source, pickup_length: 0.5, pickup_layout: 'side-exit' });
        expect(pickupTypeOf(underground)).toBe('side-exit');
        expect(withPickupType(underground, 'side-straight')).toEqual({ ...source, pickup_length: 1, pickup_layout: 'side-straight' });
        expect(source).not.toHaveProperty('pickup_length');
    });
    it('passes straight-belt timing to generation and export for new, imported and saved forms without geometry', () => {
        const form = createDefaultConfig();
        form.inserters = [{ id: 1, _uuid: 'input', source, sink: { type: 'machine', id: 1 } }];
        const config = formDataToConfig(form);
        expect(config.inserters[0].source).toEqual({ ...source, pickup_length: 1 });
        expect(formDataToConfig(configToFormData(config)).inserters[0].source).toEqual(config.inserters[0].source);
        const legacyImport = { ...config, inserters: [{ ...config.inserters[0], source }] };
        expect(formDataToConfig(configToFormData(legacyImport)).inserters[0].source).toEqual(config.inserters[0].source);
        expect(source).not.toHaveProperty('pickup_length');
        expect(isStale(generatedForOf(legacyImport), configKeyOf(config))).toBe(true);
    });
    it('retains unsupported pickup identity across import, save and reload, independently of default geometry', () => {
        const form = createDefaultConfig();
        const capture = {status: 'unsupported' as const, entity_type: 'splitter', entity_name: 'turbo-splitter',
            sidecar_version: '0.11.0', reason: 'splitter'};
        form.inserters = [{id: 1, _uuid: 'input', source: {...source, pickup_capture: capture}, sink: {type: 'machine', id: 1}}];
        const config = formDataToConfig(form);
        const restored = configToFormData(JSON.parse(JSON.stringify(config)));
        expect(restored.inserters[0].source.pickup_capture).toEqual(capture);
        expect(pickupTypeOf(restored.inserters[0].source)).toBe('unverified');
        expect(withPickupType(restored.inserters[0].source, 'side-straight')).toBe(restored.inserters[0].source);
        expect(withPickupType(restored.inserters[0].source, 'side-exit')).toBe(restored.inserters[0].source);
        expect(unsupportedPickupOf(restored.inserters[0].source)).toBe('splitter');
        const geometry = pickupGeometryOf({...config, overrides: {backed_up_belts: true}});
        expect(geometry.known).toBe(0);
        expect(geometry.unverified).toEqual([1]);
        expect(geometry.unsupported).toEqual([1]);
    });
    it('keeps a side-loaded pickup capture as out of scope across import, save and reload', () => {
        const form = createDefaultConfig();
        const capture = {status: 'unsupported' as const, entity_type: 'transport-belt', entity_name: 'turbo-transport-belt',
            sidecar_version: '0.11.0', reason: 'side-loaded'};
        form.inserters = [{id: 1, _uuid: 'input', source: {...source, pickup_capture: capture}, sink: {type: 'machine', id: 1}}];
        const config = formDataToConfig(form);
        const restored = configToFormData(JSON.parse(JSON.stringify(config)));
        expect(restored.inserters[0].source.pickup_capture).toEqual(capture);
        expect(pickupTypeOf(restored.inserters[0].source)).toBe('unverified');
        expect(unsupportedPickupOf(restored.inserters[0].source)).toBe('side-loaded');
        for (const type of ['side-straight', 'side-exit'] as const) {
            expect(withPickupType(restored.inserters[0].source, type)).toBe(restored.inserters[0].source);
        }
        const geometry = pickupGeometryOf(config);
        expect(geometry).toMatchObject({known: 0, unverified: [1], unsupported: [1]});
    });
    it('counts only the reasons the engine refuses as out of scope', () => {
        for (const reason of ['bend', 'inline', 'unsupported', 'merge', 'supply-unknown']) {
            const captured: InserterFormData['source'] = {...source, pickup_capture: {status: 'unsupported', entity_type: 'transport-belt', reason}};
            expect(pickupTypeOf(captured)).toBe('unverified');
            expect(unsupportedPickupOf(captured)).toBeNull();
        }
        for (const reason of ['splitter', 'side-loaded']) {
            expect(unsupportedPickupOf({...source, pickup_capture: {status: 'unclassified', reason}})).toBeNull();
        }
        const supported: InserterFormData['source'] = {...source, pickup_length: 1, pickup_capture: {
            status: 'supported', model: 'belt', model_version: 2, entity_type: 'transport-belt', sidecar_version: '0.11.0',
        }};
        expect(unsupportedPickupOf(source)).toBeNull();
        expect(unsupportedPickupOf(supported)).toBeNull();
    });
    it('makes a deliberate geometry change a manual assumption without fabricating a fresh capture', () => {
        const captured: InserterFormData['source'] = {...source, pickup_length: 1, pickup_capture: {
            status: 'supported', model: 'belt', model_version: 1, entity_type: 'transport-belt', sidecar_version: '0.11.0',
        }};
        expect(withPickupType(captured, 'side-straight').pickup_capture).toEqual(captured.pickup_capture);
        expect(withPickupType(captured, 'side-exit')).not.toHaveProperty('pickup_capture');
        expect(captured.pickup_capture?.status).toBe('supported');
    });
    it('does not attach geometry to a machine or chest source', () => {
        for (const type of ['machine', 'chest'] as const) {
            const source = { type, id: 2 };
            expect(withPickupType(source, 'side-straight')).toBe(source);
        }
    });
    it('preserves a no-op route but clears geometry when its source changes', () => {
        const inserter: InserterFormData = { id: 1, _uuid: 'input', source: withPickupType(source, 'side-exit'), sink: { type: 'machine', id: 1 } };
        expect(endpointUpdate(inserter, 'source', { type: 'belt', id: 1 })).toEqual({});
        expect(endpointUpdate(inserter, 'source', { type: 'belt', id: 2 })).toEqual({ source: { type: 'belt', id: 2 } });
        expect(endpointUpdate(inserter, 'source', { type: 'chest', id: 1 })).toEqual({ source: { type: 'chest', id: 1 } });
    });
    it('preserves manual types through file round trips and makes results stale when geometry or supply changes', () => {
        const form = createDefaultConfig();
        form.inserters = [{ id: 1, _uuid: 'input', source: withPickupType(source, 'side-straight'), sink: { type: 'machine', id: 1 } }];
        const config = formDataToConfig(form);
        const restored = configToFormData(JSON.parse(JSON.stringify(config)));
        expect(restored.inserters[0].source).toEqual(form.inserters[0].source);
        const before = generatedForOf(config);
        restored.inserters[0].source = withPickupType(restored.inserters[0].source, 'side-exit');
        expect(isStale(before, configKeyOf(formDataToConfig(restored)))).toBe(true);
        expect(isStale(before, configKeyOf({ ...config, overrides: { backed_up_belts: true } }))).toBe(true);
        expect(isStale(before, configKeyOf(config))).toBe(false);
    });
    it('lists only missing belt pickups with stable inserter IDs, independently of movement', () => {
        const inserters = [
            { id: 7, source: withPickupType(source, 'side-straight') }, { id: 9, source },
            { source: { type: 'machine' } }, { source: { type: 'belt' } },
        ];
        expect(pickupGeometryOf({ inserters })).toEqual({ total: 3, known: 1, missing: [9, 4], unverified: [], unsupported: [], backedUp: false });
        expect(pickupGeometryOf({ inserters, overrides: { backed_up_belts: true } }).backedUp).toBe(true);
    });
});

it('requires an explicit layout for an old manual underground and retains it through export/reload', () => {
    const source: InserterFormData['source'] = {type: 'belt', id: 1, pickup_length: 0.5};
    expect(pickupTypeOf(source)).toBe('underground');
    for (const layout of ['side-entrance', 'side-exit', 'front-entrance', 'front-exit', 'over-hood-exit'] as const) {
        const selected = withPickupType(source, layout);
        expect(selected).toMatchObject({pickup_length: 0.5, pickup_layout: layout});
        const form = createDefaultConfig();
        form.inserters = [{id: 1, _uuid: 'input', source: selected, sink: {type: 'machine', id: 1}}];
        expect(configToFormData(formDataToConfig(form)).inserters[0].source).toEqual(selected);
    }
});

it('requires recapture for an old positive underground declaration instead of allowing a manual upgrade', () => {
    const source: InserterFormData['source'] = {type: 'belt', id: 1, pickup_length: 0.5, pickup_capture: {
        status: 'supported', model: 'belt', model_version: 1, entity_type: 'underground-belt', sidecar_version: '0.11.0',
    }};
    expect(pickupTypeOf(source)).toBe('unverified');
    expect(withPickupType(source, 'side-entrance')).toBe(source);
    expect(pickupGeometryOf({inserters: [{id: 1, source}]}).unverified).toEqual([1]);
});
