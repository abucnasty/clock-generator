import { describe, expect, it } from 'vitest';
import type { InserterFormData } from './configForm/formData';
import { changedConfigFields } from './inserterDraft';

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
