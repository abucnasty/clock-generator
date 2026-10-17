import { expect, it } from 'vitest';
import { ChestType } from 'clock-generator/light';
import { finiteOutputChests } from './finiteOutputChests';
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
    const matches = finiteOutputChests(chests, [route(1, null, 4), route(2, null, 9), route(3, null, 7), route(4, null, 9)]);
    expect(matches.map(({ chest, index }) => [chest.id, index])).toEqual([[9, 1], [7, 2]]);
});

it('leaves isolated chests, input sources and buffers with a downstream inserter alone', () => {
    expect(finiteOutputChests([chest(1), chest(2), chest(3)], [route(1, 2, null), route(2, null, 3), route(3, 3, null)])).toEqual([]);
    expect(finiteOutputChests([], [])).toEqual([]);
});

it('offers the same warning for a terminal chest reached through other containers', () => {
    expect(finiteOutputChests([chest(1), chest(2)], [route(1, null, 1), route(2, 1, 2)]).map(({ chest }) => chest.id)).toEqual([2]);
});

it('the existing chest conversion fixes the warning while retaining filters, identity, routes and saved capacity', () => {
    const before = { ...createDefaultConfig(), chests: [chest(9)], inserters: [route(1, null, 9)] };
    const [{ index }] = finiteOutputChests(before.chests, before.inserters);
    const after = switchChestType(before, index, ChestType.INFINITY_CHEST);
    expect(finiteOutputChests(after.chests, after.inserters)).toEqual([]);
    expect(after.chests[0]).toMatchObject({ id: 9, _uuid: 'chest-9', item_filter: [{ item_name: 'iron-gear-wheel', request_count: 1 }], _chest_settings: { storage_size: 48 } });
    expect(after.inserters).toBe(before.inserters);
    expect(before.chests[0].type).toBe(ChestType.BUFFER_CHEST);
});
