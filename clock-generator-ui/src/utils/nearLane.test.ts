import { describe, expect, it } from 'vitest';
import type { Config } from 'clock-generator/browser';
import * as edits from './configForm/edits';
import { configToFormData, formDataToConfig } from './configForm/configMapping';
import { createDefaultConfig, type BeltFormData, type InserterFormData } from './configForm/formData';
import { nearLaneItems, withNearLane } from './nearLane';
import { endpointUpdate } from './inserterMetadata';

const lane = (ingredient: string) => ({ ingredient, stack_size: 4 });

const belts: BeltFormData[] = [
    { id: 1, _uuid: 'belt-1', type: 'turbo-transport-belt', lanes: [lane('bioflux'), lane('nutrients')] },
    { id: 2, _uuid: 'belt-2', type: 'turbo-transport-belt', lanes: [lane('bioflux')] },
    { id: 3, _uuid: 'belt-3', type: 'turbo-transport-belt', lanes: [lane('bioflux'), lane('bioflux')] },
    { id: 4, _uuid: 'belt-4', type: 'turbo-transport-belt', lanes: [lane('bioflux'), lane('')] },
];

describe('nearLaneItems', () => {
    it('gives the two items of a belt whose lanes carry different items', () => {
        expect(nearLaneItems({ type: 'belt', id: 1 }, belts)).toEqual(['bioflux', 'nutrients']);
    });

    it('is null for any other source', () => {
        expect(nearLaneItems({ type: 'machine', id: 1 }, belts)).toBeNull();
        expect(nearLaneItems({ type: 'chest', id: 1 }, belts)).toBeNull();
        expect(nearLaneItems({ type: 'belt', id: 2 }, belts)).toBeNull();
        expect(nearLaneItems({ type: 'belt', id: 3 }, belts)).toBeNull();
        expect(nearLaneItems({ type: 'belt', id: 4 }, belts)).toBeNull();
        expect(nearLaneItems({ type: 'belt', id: 9 }, belts)).toBeNull();
    });
});

describe('withNearLane', () => {
    it('sets the lane and keeps the source', () => {
        expect(withNearLane({ type: 'belt', id: 1 }, 2)).toEqual({ type: 'belt', id: 1, near_lane: 2 });
        expect(withNearLane({ type: 'belt', id: 1, near_lane: 2 }, 1)).toEqual({ type: 'belt', id: 1, near_lane: 1 });
    });

    it('removes the key for Not set, and leaves the source it was given alone', () => {
        const source: InserterFormData['source'] = { type: 'belt', id: 1, near_lane: 2 };
        const cleared = withNearLane(source, 0);
        expect('near_lane' in cleared).toBe(false);
        expect(cleared).toEqual({ type: 'belt', id: 1 });
        expect(source).toEqual({ type: 'belt', id: 1, near_lane: 2 });
    });

    it('makes the update a List row and the diagram dialog both make, which survives an export and an import', () => {
        let config = edits.addBelt(createDefaultConfig());
        config = { ...config, belts: [{ ...config.belts[0], lanes: [lane('bioflux'), lane('nutrients')] }] };
        config = edits.addInserter(config);
        const update = { source: withNearLane({ type: 'belt', id: config.belts[0].id }, 1) };
        config = edits.updateInserter(config, 0, update);
        const exported = formDataToConfig(config);
        expect(exported.inserters[0].source).toEqual({ type: 'belt', id: config.belts[0].id, near_lane: 1, pickup_length: 1 });
        const imported = configToFormData(JSON.parse(JSON.stringify(exported)) as Config);
        expect(imported.inserters[0].source.near_lane).toBe(1);

        const reselected = edits.updateInserter(config, 0, endpointUpdate(config.inserters[0], 'source', { type: 'belt', id: config.belts[0].id }));
        expect(reselected.inserters[0].source.near_lane).toBe(1);

        const cleared = formDataToConfig(edits.updateInserter(config, 0, { source: withNearLane(config.inserters[0].source, 0) }));
        expect(JSON.stringify(cleared.inserters[0])).not.toContain('near_lane');
    });
});


it('keeps the measured bend lane fixed while allowing an imported mismatch to be corrected', () => {
    const source: InserterFormData['source'] = {type: 'belt', id: 1, pickup_layout: 'bend-right-upstream', pickup_length: 1, near_lane: 1};
    expect(withNearLane(source, 0)).toBe(source);
    expect(withNearLane(source, 2)).toBe(source);
    expect(withNearLane({...source, near_lane: 2}, 1)).toEqual(source);
});
