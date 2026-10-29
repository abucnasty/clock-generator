import { describe, expect, it } from 'vitest';
import type { Config } from 'clock-generator/browser';
import { build, inserter } from '../test/fixtures';
import type { InserterFormData } from './configForm/formData';
import { configToFormData, formDataToConfig } from './configForm/configMapping';
import { endpointUpdate } from './inserterMetadata';
import { pickupGeometryOf, pickupTypeOf, unsupportedPickupOf, withPickupType } from './pickupGeometry';
import { configKeyOf, generatedForOf, isStale } from './resultsStaleness';

type Source = InserterFormData['source'];
type Supported = Extract<NonNullable<Source['pickup_capture']>, { status: 'supported' }>;

/** A build whose one inserter takes from `source` into machine 1 */
const buildFrom = (source: Source) => build({ inserters: [inserter(1, { source, sink: { type: 'machine', id: 1 } })] });
/** The config saved to a file and opened again */
const reloaded = (config: Config) => configToFormData(JSON.parse(JSON.stringify(config)));
/** Sidecar's capture of a straight belt pickup it supports */
const supported = (model_version: Supported['model_version'], fields: Partial<Supported> = {}): Supported =>
    ({ status: 'supported', model: 'belt', model_version, entity_type: 'transport-belt', sidecar_version: '0.11.0', ...fields });

describe('pickup type edits and saved assumptions', () => {
    const source: Source = { type: 'belt', id: 1, near_lane: 2 };
    it('defaults to straight belt and lets underground pickups be selected explicitly', () => {
        expect(pickupTypeOf(source)).toBe('side-straight');
        const underground = withPickupType(source, 'side-exit');
        expect(underground).toEqual({ ...source, pickup_length: 0.5, pickup_layout: 'side-exit' });
        expect(pickupTypeOf(underground)).toBe('side-exit');
        expect(withPickupType(underground, 'side-straight')).toEqual({ ...source, pickup_length: 1, pickup_layout: 'side-straight' });
        expect(source).not.toHaveProperty('pickup_length');
    });
    it('passes straight-belt timing to generation and export for new, imported and saved forms without geometry', () => {
        const config = formDataToConfig(buildFrom(source));
        expect(config.inserters[0].source).toEqual({ ...source, pickup_length: 1 });
        expect(formDataToConfig(configToFormData(config)).inserters[0].source).toEqual(config.inserters[0].source);
        const legacyImport = { ...config, inserters: [{ ...config.inserters[0], source }] };
        expect(formDataToConfig(configToFormData(legacyImport)).inserters[0].source).toEqual(config.inserters[0].source);
        expect(source).not.toHaveProperty('pickup_length');
        expect(isStale(generatedForOf(legacyImport), configKeyOf(config))).toBe(true);
    });
    it.each([
        ['splitter', 'splitter', 'turbo-splitter'],
        ['side-loaded', 'transport-belt', 'turbo-transport-belt'],
    ] as const)('keeps a %s pickup capture as out of scope across import, save and reload, independently of default geometry', (reason, entity_type, entity_name) => {
        const capture = { status: 'unsupported' as const, entity_type, entity_name, sidecar_version: '0.11.0', reason };
        const config = formDataToConfig(buildFrom({ ...source, pickup_capture: capture }));
        const restored = reloaded(config).inserters[0].source;
        expect(restored.pickup_capture).toEqual(capture);
        expect(pickupTypeOf(restored)).toBe('unverified');
        expect(unsupportedPickupOf(restored)).toBe(reason);
        for (const type of ['side-straight', 'side-exit'] as const) {
            expect(withPickupType(restored, type)).toBe(restored);
        }
        expect(pickupGeometryOf({ ...config, overrides: { backed_up_belts: true } })).toMatchObject({ known: 0, unverified: [1], unsupported: [1] });
    });
    it('counts only the reasons the engine refuses as out of scope', () => {
        for (const reason of ['bend', 'inline', 'unsupported', 'merge', 'supply-unknown']) {
            const captured: Source = { ...source, pickup_capture: { status: 'unsupported', entity_type: 'transport-belt', reason } };
            expect(pickupTypeOf(captured)).toBe('unverified');
            expect(unsupportedPickupOf(captured)).toBeNull();
        }
        for (const reason of ['splitter', 'side-loaded']) {
            expect(unsupportedPickupOf({ ...source, pickup_capture: { status: 'unclassified', reason } })).toBeNull();
        }
        expect(unsupportedPickupOf(source)).toBeNull();
        expect(unsupportedPickupOf({ ...source, pickup_capture: supported(2) })).toBeNull();
    });
    it('makes a deliberate geometry change a manual assumption without fabricating a fresh capture', () => {
        const captured: Source = { ...source, pickup_length: 1, pickup_capture: supported(1) };
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
        const underground = inserter(1, { source: withPickupType(source, 'side-exit'), sink: { type: 'machine', id: 1 } });
        expect(endpointUpdate(underground, 'source', { type: 'belt', id: 1 })).toEqual({});
        expect(endpointUpdate(underground, 'source', { type: 'belt', id: 2 })).toEqual({ source: { type: 'belt', id: 2 } });
        expect(endpointUpdate(underground, 'source', { type: 'chest', id: 1 })).toEqual({ source: { type: 'chest', id: 1 } });
    });
    it('preserves manual types through file round trips and makes results stale when geometry or supply changes', () => {
        const form = buildFrom(withPickupType(source, 'side-straight'));
        const config = formDataToConfig(form);
        const restored = reloaded(config);
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
    const source: Source = { type: 'belt', id: 1, pickup_length: 0.5 };
    expect(pickupTypeOf(source)).toBe('underground');
    for (const layout of ['side-entrance', 'side-exit', 'front-entrance', 'front-exit', 'over-hood-exit'] as const) {
        const selected = withPickupType(source, layout);
        expect(selected).toMatchObject({ pickup_length: 0.5, pickup_layout: layout });
        expect(configToFormData(formDataToConfig(buildFrom(selected))).inserters[0].source).toEqual(selected);
    }
});

it('requires recapture for an old positive underground declaration instead of allowing a manual upgrade', () => {
    const source: Source = { type: 'belt', id: 1, pickup_length: 0.5, pickup_capture: supported(1, { entity_type: 'underground-belt' }) };
    expect(pickupTypeOf(source)).toBe('unverified');
    expect(withPickupType(source, 'side-entrance')).toBe(source);
    expect(pickupGeometryOf({ inserters: [{ id: 1, source }] }).unverified).toEqual([1]);
});

describe('measured right-bend pickup', () => {
    const measured = supported(3, { entity_name: 'turbo-transport-belt', sidecar_version: '0.15.0' });
    const captured: Source = { type: 'belt', id: 1, near_lane: 1, pickup_length: 1, pickup_layout: 'bend-right-upstream', pickup_capture: measured };

    it('retains measured geometry and capture provenance through file save and reload', () => {
        const restored = reloaded(formDataToConfig(buildFrom(captured)));
        expect(restored.inserters[0].source).toEqual(captured);
        expect(pickupTypeOf(restored.inserters[0].source)).toBe('bend-right-upstream');
        expect(pickupGeometryOf(restored)).toMatchObject({ known: 1, missing: [], unverified: [] });
        expect(withPickupType(captured, 'bend-right-upstream').pickup_capture).toEqual(captured.pickup_capture);
    });

    it('sets the measured lane on manual selection without retaining a different physical capture', () => {
        const straight: Source = { ...captured, near_lane: 2, pickup_layout: 'side-straight', pickup_capture: { ...measured, model_version: 2 } };
        const bend = withPickupType(straight, 'bend-right-upstream');
        expect(bend).toEqual({ type: 'belt', id: 1, near_lane: 1, pickup_length: 1, pickup_layout: 'bend-right-upstream' });
        expect(straight.near_lane).toBe(2);
        expect(withPickupType(captured, 'side-straight')).not.toHaveProperty('pickup_capture');
    });

    it('requires recapture of a saved unsupported bend before it can use the supported layout', () => {
        const source: Source = { ...captured, pickup_capture: { status: 'unsupported', entity_type: 'transport-belt', reason: 'bend', sidecar_version: '0.14.0' } };
        expect(withPickupType(source, 'bend-right-upstream')).toBe(source);
        expect(pickupTypeOf(source)).toBe('unverified');
        expect(pickupGeometryOf({ inserters: [{ id: 4, source }] })).toMatchObject({ known: 0, unverified: [4] });
    });
});
