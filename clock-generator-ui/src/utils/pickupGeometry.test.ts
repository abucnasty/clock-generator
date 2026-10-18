import { describe, expect, it } from 'vitest';
import type { InserterFormData } from './configForm/formData';
import { configToFormData, formDataToConfig } from './configForm/configMapping';
import { createDefaultConfig } from './configForm/formData';
import { endpointUpdate } from './inserterMetadata';
import { pickupGeometryOf, pickupTypeOf, withPickupType } from './pickupGeometry';
import { configKeyOf, generatedForOf, isStale } from './resultsStaleness';

describe('pickup type edits and saved assumptions', () => {
    const source: InserterFormData['source'] = { type: 'belt', id: 1, near_lane: 2 };
    it('defaults to straight belt and lets underground pickups be selected explicitly', () => {
        expect(pickupTypeOf(source)).toBe('straight');
        const underground = withPickupType(source, 'underground');
        expect(underground).toEqual({ ...source, pickup_length: 0.5 });
        expect(pickupTypeOf(underground)).toBe('underground');
        expect(withPickupType(underground, 'straight')).toEqual({ ...source, pickup_length: 1 });
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
    it('does not attach geometry to a machine or chest source', () => {
        for (const type of ['machine', 'chest'] as const) {
            const source = { type, id: 2 };
            expect(withPickupType(source, 'straight')).toBe(source);
        }
    });
    it('preserves a no-op route but clears geometry when its source changes', () => {
        const inserter: InserterFormData = { id: 1, _uuid: 'input', source: withPickupType(source, 'underground'), sink: { type: 'machine', id: 1 } };
        expect(endpointUpdate(inserter, 'source', { type: 'belt', id: 1 })).toEqual({});
        expect(endpointUpdate(inserter, 'source', { type: 'belt', id: 2 })).toEqual({ source: { type: 'belt', id: 2 } });
        expect(endpointUpdate(inserter, 'source', { type: 'chest', id: 1 })).toEqual({ source: { type: 'chest', id: 1 } });
    });
    it('preserves manual types through file round trips and makes results stale when geometry or supply changes', () => {
        const form = createDefaultConfig();
        form.inserters = [{ id: 1, _uuid: 'input', source: withPickupType(source, 'straight'), sink: { type: 'machine', id: 1 } }];
        const config = formDataToConfig(form);
        const restored = configToFormData(JSON.parse(JSON.stringify(config)));
        expect(restored.inserters[0].source).toEqual(form.inserters[0].source);
        const before = generatedForOf(config);
        restored.inserters[0].source = withPickupType(restored.inserters[0].source, 'underground');
        expect(isStale(before, configKeyOf(formDataToConfig(restored)))).toBe(true);
        expect(isStale(before, configKeyOf({ ...config, overrides: { backed_up_belts: true } }))).toBe(true);
        expect(isStale(before, configKeyOf(config))).toBe(false);
    });
    it('lists only missing belt pickups with stable inserter IDs, independently of movement', () => {
        const inserters = [
            { id: 7, source: withPickupType(source, 'straight') }, { id: 9, source },
            { source: { type: 'machine' } }, { source: { type: 'belt' } },
        ];
        expect(pickupGeometryOf({ inserters })).toEqual({ total: 3, known: 1, missing: [9, 4], backedUp: false });
        expect(pickupGeometryOf({ inserters, overrides: { backed_up_belts: true } }).backedUp).toBe(true);
    });
});
