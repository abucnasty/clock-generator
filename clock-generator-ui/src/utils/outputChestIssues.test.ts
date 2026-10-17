import { expect, it } from 'vitest';
import { ChestType } from 'clock-generator/light';
import { outputChestIssues, coverageHandledByChestIssue } from './outputChestIssues';
import type { InserterCoverageIssue } from 'clock-generator/browser';
import { createDefaultConfig, type ChestFormData, type InserterFormData } from './configForm/formData';
import { switchChestType } from './configForm/edits';

const chest = (id: number): ChestFormData => ({ id, _uuid: `chest-${id}`, type: ChestType.BUFFER_CHEST, storage_size: 48, item_filter: 'iron-gear-wheel' });
const route = (id: number, from: number | null, to: number | null): InserterFormData => ({
    id, _uuid: `inserter-${id}`, stack_size: 16,
    source: from === null ? { type: 'machine', id: 1 } : { type: 'chest', id: from },
    sink: to === null ? { type: 'machine', id: 2 } : { type: 'chest', id: to },
});

it('warns for every finite terminal sink, including legacy chests, using the current row index', () => {
    const chests: ChestFormData[] = [
        { id: 4, _uuid: 'infinite', type: ChestType.INFINITY_CHEST, item_filter: [{ item_name: 'iron-gear-wheel', request_count: 1 }] },
        chest(9), { ...chest(7), type: undefined } as unknown as ChestFormData,
    ];
    const matches = outputChestIssues(chests, [route(1, null, 4), route(2, null, 9), route(3, null, 7), route(4, null, 9)]);
    expect(matches.map(({ chest, index }) => [chest.id, index])).toEqual([[9, 1], [7, 2]]);
});

it('leaves isolated chests, input sources and buffers with a downstream inserter alone', () => {
    expect(outputChestIssues([chest(1), chest(2), chest(3)], [route(1, 2, null), route(2, null, 3), route(3, 3, null)])).toEqual([]);
    expect(outputChestIssues([], [])).toEqual([]);
});

it('offers the same warning for a terminal chest reached through other containers', () => {
    expect(outputChestIssues([chest(1), chest(2)], [route(1, null, 1), route(2, 1, 2)]).map(({ chest }) => chest.id)).toEqual([2]);
});

it('the output repair creates a disposal chest while retaining identity, routes and saved buffer settings', () => {
    const before = { ...createDefaultConfig(), chests: [chest(9)], inserters: [route(1, null, 9)] };
    const [{ index }] = outputChestIssues(before.chests, before.inserters);
    const after = switchChestType(before, index, ChestType.INFINITY_CHEST, true);
    expect(outputChestIssues(after.chests, after.inserters)).toEqual([]);
    expect(after.chests[0]).toMatchObject({ id: 9, _uuid: 'chest-9', item_filter: [], remove_unfiltered_items: true, _chest_settings: { storage_size: 48, buffer_filter: 'iron-gear-wheel' } });
    expect(switchChestType(after, index, ChestType.BUFFER_CHEST).chests[0]).toMatchObject({ item_filter: 'iron-gear-wheel', storage_size: 48 });
    expect(after.inserters).toBe(before.inserters);
    expect(before.chests[0].type).toBe(ChestType.BUFFER_CHEST);
});

it('diagnoses an empty infinity destination without flagging valid stock filters or isolated chests', () => {
    const empty: ChestFormData = { id: 4, _uuid: 'chest-4', type: ChestType.INFINITY_CHEST, item_filter: [], remove_unfiltered_items: false };
    const routes = [route(1, null, 4)];
    expect(outputChestIssues([empty], routes)).toEqual([{ kind: 'removal-disabled', chest: empty, index: 0 }]);
    expect(outputChestIssues([{ ...empty, item_filter: [{ item_name: '', request_count: 1 }] }], routes)[0].kind).toBe('removal-disabled');
    expect(outputChestIssues([{ ...empty, remove_unfiltered_items: true }], routes)).toEqual([]);
    expect(outputChestIssues([{ ...empty, item_filter: [{ item_name: 'iron-gear-wheel', request_count: 100 }] }], routes)).toEqual([]);
    expect(outputChestIssues([empty], [])).toEqual([]);
});

it('replaces only coverage errors that enabling removal on the existing route fixes', () => {
    const empty: ChestFormData = { id: 4, _uuid: 'chest-4', type: ChestType.INFINITY_CHEST, item_filter: [] };
    const routes = [route(1, null, 4)];
    const warnings = outputChestIssues([empty], routes);
    const issue: InserterCoverageIssue = { kind: 'missing_output_inserter', machine_id: 1, recipe: 'iron-gear-wheel', item_name: 'iron-gear-wheel', fix_options: [] };
    expect(coverageHandledByChestIssue(issue, warnings, routes)).toBe(true);
    expect(coverageHandledByChestIssue({ ...issue, machine_id: 2 }, warnings, routes)).toBe(false);
    expect(coverageHandledByChestIssue({ ...issue, kind: 'missing_input_inserter' }, warnings, routes)).toBe(false);
    expect(coverageHandledByChestIssue(issue, warnings, [{ ...routes[0], filters: ['copper-plate'] }])).toBe(false);
    expect(coverageHandledByChestIssue(issue, outputChestIssues([chest(4)], routes), routes)).toBe(false);
});
