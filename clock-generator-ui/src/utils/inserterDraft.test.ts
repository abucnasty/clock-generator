import { describe, expect, it } from 'vitest';
import type { BeltFormData, InserterFormData } from './configForm/formData';
import { changedConfigFields, changedFields, MACHINE_FIELDS, BELT_FIELDS, CHEST_FIELDS, DRILL_FIELDS } from './inserterDraft';

const saved: InserterFormData = {
    id: 3,
    _uuid: 'inserter-3',
    source: { type: 'belt', id: 1, near_lane: 2 },
    sink: { type: 'machine', id: 1 },
    stack_size: 16,
    filters: ['iron-plate'],
    overrides: { enable_control: { mode: 'ALWAYS' } },
};

describe('changedConfigFields', () => {
    it('is empty when nothing changed, whatever the order of the keys', () => {
        expect(changedConfigFields({ ...saved }, saved)).toEqual({});
        const reordered = { ...saved, source: { near_lane: 2 as const, id: 1, type: 'belt' as const }, sink: { id: 1, type: 'machine' as const } };
        expect(changedConfigFields(reordered, saved)).toEqual({});
    });

    it('leaves out the fields the Config tab does not edit', () => {
        expect(changedConfigFields({ ...saved, overrides: undefined, _forced_always: true }, saved)).toEqual({});
    });

    it('gives the stack size when it changed', () => {
        expect(changedConfigFields({ ...saved, stack_size: 12 }, saved)).toEqual({ stack_size: 12 });
    });

    it('gives removed filters as undefined, and takes no filters as no filters', () => {
        const removed = changedConfigFields({ ...saved, filters: undefined }, saved);
        expect(removed).toEqual({ filters: undefined });
        expect('filters' in removed).toBe(true);
        const { filters: _f, ...none } = saved;
        void _f;
        expect(changedConfigFields({ ...none, filters: undefined }, none)).toEqual({});
        expect(changedConfigFields({ ...saved, filters: ['copper-plate'] }, saved)).toEqual({ filters: ['copper-plate'] });
    });

    it('gives the source when its entity or its nearest lane changed', () => {
        const withoutLane = { type: 'belt' as const, id: 1 };
        expect(changedConfigFields({ ...saved, source: withoutLane }, saved)).toEqual({ source: withoutLane });
        expect(changedConfigFields({ ...saved, source: { ...withoutLane, near_lane: 1 } }, saved)).toEqual({ source: { ...withoutLane, near_lane: 1 } });
        expect(changedConfigFields({ ...saved, source: { type: 'machine', id: 2 } }, saved)).toEqual({ source: { type: 'machine', id: 2 } });
        expect(changedConfigFields({ ...saved, source: withoutLane }, { ...saved, source: { id: 1, type: 'belt' } })).toEqual({});
    });
});

describe('every Diagram draft', () => {
    it('finds changed machine, chest and drill fields without saving identity or rules', () => {
        const machine = { recipe: 'gear', productivity: 0, crafting_speed: 1, type: 'machine' };
        expect(changedFields({ ...machine, crafting_speed: 2 }, machine, MACHINE_FIELDS)).toEqual({ crafting_speed: 2 });
        expect(changedFields(machine, machine, MACHINE_FIELDS)).toEqual({});
        const chest = { type: 'buffer-chest', storage_size: 2, item_filter: 'coal' };
        expect(changedFields({ ...chest, type: 'infinity-chest' }, chest, CHEST_FIELDS)).toEqual({ type: 'infinity-chest' });
        const drill = { type: 'electric-mining-drill', mined_item_name: 'iron-ore', speed_bonus: 0, target: { type: 'machine', id: 1 } };
        expect(changedFields({ ...drill, target: { type: 'machine', id: 2 } }, drill, DRILL_FIELDS)).toEqual({ target: { type: 'machine', id: 2 } });
    });
    it('deep-compares lanes and saves every field a belt strategy can change', () => {
        const belt: BeltFormData = { id: 1, _uuid: 'belt1', type: 'transport-belt', strategy: 'export', lanes: [{ ingredient: 'coal', stack_size: 4, consumption_per_second: 2 }] };
        expect(changedFields(structuredClone(belt), belt, BELT_FIELDS)).toEqual({});
        expect(changedFields({ ...belt, lanes: [{ ...belt.lanes[0], ingredient: 'iron' }] }, belt, BELT_FIELDS)).toEqual({ lanes: [{ ingredient: 'iron', stack_size: 4, consumption_per_second: 2 }] });
        const normal: BeltFormData = { ...belt, strategy: undefined, lanes: [{ ingredient: 'coal', stack_size: 4 }] };
        expect(changedFields(normal, belt, BELT_FIELDS)).toEqual({ strategy: undefined, lanes: normal.lanes });
    });
});
