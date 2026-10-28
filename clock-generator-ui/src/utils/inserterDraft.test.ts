import { describe, expect, it } from 'vitest';
import { belt, bufferChest, drill, inserter, machine } from '../test/fixtures';
import type { InserterFormData } from './configForm/formData';
import { changedConfigFields, changedFields, MACHINE_FIELDS, BELT_FIELDS, CHEST_FIELDS, DRILL_FIELDS } from './inserterDraft';

/** Inserter 3 as the Config tab saved it, without filters: from belt 1, its lane 2 nearest, into machine 1 */
const unfiltered = inserter(3, { source: { type: 'belt', id: 1, near_lane: 2 }, sink: { type: 'machine', id: 1 }, stack_size: 16,
    overrides: { enable_control: { mode: 'ALWAYS' } } });
const saved: InserterFormData = { ...unfiltered, filters: ['iron-plate'] };
/** Belt 1 as a source, without a nearest lane */
const belt1 = { type: 'belt' as const, id: 1 };

// each draft is its saved row with `edit` made to it
describe('changedConfigFields', () => {
    it.each<{ why: string; saved?: InserterFormData; edit: Partial<InserterFormData>; changed: Partial<InserterFormData> }>([
        { why: 'nothing when nothing changed', edit: {}, changed: {} },
        { why: 'nothing when only the order of the keys changed', edit: { source: { near_lane: 2, id: 1, type: 'belt' }, sink: { id: 1, type: 'machine' } }, changed: {} },
        { why: 'nothing of the fields the Config tab does not edit', edit: { overrides: undefined, _forced_always: true }, changed: {} },
        { why: 'the stack size when it changed', edit: { stack_size: 12 }, changed: { stack_size: 12 } },
        { why: 'removed filters, there as undefined', edit: { filters: undefined }, changed: { filters: undefined } },
        { why: 'nothing for no filters, saved without filters', saved: unfiltered, edit: { filters: undefined }, changed: {} },
        { why: 'the filters when they changed', edit: { filters: ['copper-plate'] }, changed: { filters: ['copper-plate'] } },
        { why: 'the source when its nearest lane was removed', edit: { source: belt1 }, changed: { source: belt1 } },
        { why: 'the source when its nearest lane changed', edit: { source: { ...belt1, near_lane: 1 } }, changed: { source: { type: 'belt', id: 1, near_lane: 1 } } },
        { why: 'the source when its entity changed', edit: { source: { type: 'machine', id: 2 } }, changed: { source: { type: 'machine', id: 2 } } },
        { why: 'nothing for a source without a lane, saved without one', saved: { ...saved, source: { id: 1, type: 'belt' } }, edit: { source: belt1 }, changed: {} },
    ])('gives $why', (row) => {
        const from = row.saved ?? saved;
        expect(changedConfigFields({ ...from, ...row.edit }, from)).toStrictEqual(row.changed);
    });
});

describe('changedFields of every Diagram draft', () => {
    const recycler = machine(1, { result_target: { type: 'chest', id: 1 } });
    const chest = bufferChest(1, { item_filter: 'coal' });
    const exporting = belt(1, { strategy: 'export', lanes: [{ ingredient: 'coal', stack_size: 4, consumption_per_second: 2 }] });
    it.each<{ why: string; fields: readonly string[]; saved: object; edit: object; changed: object }>([
        { why: 'a machine\'s crafting speed', fields: MACHINE_FIELDS, saved: machine(), edit: { crafting_speed: 2 }, changed: { crafting_speed: 2 } },
        { why: 'a machine\'s prototype, with where it came from', fields: MACHINE_FIELDS, saved: machine(), edit: { prototype: 'electric-furnace', _prototype_source: 'hand' },
            changed: { prototype: 'electric-furnace', _prototype_source: 'hand' } },
        { why: 'nothing of an unchanged machine', fields: MACHINE_FIELDS, saved: recycler, edit: {}, changed: {} },
        { why: 'the container a recycler puts its results into', fields: MACHINE_FIELDS, saved: recycler, edit: { result_target: { type: 'chest', id: 2 } },
            changed: { result_target: { type: 'chest', id: 2 } } },
        { why: 'the removal of that container, there as undefined', fields: MACHINE_FIELDS, saved: recycler, edit: { result_target: undefined }, changed: { result_target: undefined } },
        { why: 'a chest\'s type', fields: CHEST_FIELDS, saved: chest, edit: { type: 'infinity-chest' }, changed: { type: 'infinity-chest' } },
        { why: 'a chest\'s removal of unfiltered items', fields: CHEST_FIELDS, saved: chest, edit: { remove_unfiltered_items: true }, changed: { remove_unfiltered_items: true } },
        { why: 'a drill\'s target', fields: DRILL_FIELDS, saved: drill(), edit: { target: { type: 'machine', id: 2 } }, changed: { target: { type: 'machine', id: 2 } } },
        { why: 'nothing of a belt whose lanes are equal, though not the same', fields: BELT_FIELDS, saved: exporting, edit: { lanes: structuredClone(exporting.lanes) }, changed: {} },
        { why: 'a belt\'s lanes', fields: BELT_FIELDS, saved: exporting, edit: { lanes: [{ ...exporting.lanes[0], ingredient: 'iron' }] },
            changed: { lanes: [{ ingredient: 'iron', stack_size: 4, consumption_per_second: 2 }] } },
        { why: 'every field a belt strategy can change', fields: BELT_FIELDS, saved: exporting, edit: { strategy: undefined, lanes: [{ ingredient: 'coal', stack_size: 4 }] },
            changed: { strategy: undefined, lanes: [{ ingredient: 'coal', stack_size: 4 }] } },
    ])('gives $why', ({ fields, saved, edit, changed }) => {
        // the rows are of every kind, each compared on the fields of its own kind
        expect(changedFields({ ...saved, ...edit }, saved, fields as readonly never[])).toStrictEqual(changed);
    });
});
