import { describe, expect, it } from 'vitest';
import type { SerializableTransferPlan } from 'clock-generator/browser';
import { ChestType } from 'clock-generator/light';
import { belt, bufferChest, build, inserter, machine } from '../../test/fixtures';
import * as edits from './edits';
import { createDefaultConfig, type ConfigFormData, type EntityKind, type EnableControlOverride, type InserterFormData } from './formData';

type End = InserterFormData['source'];

const ids = (items: { id: number }[]) => items.map((item) => item.id);

/** An inserter of the stack size an added one has */
const linked = (id: number, source: End, sink: InserterFormData['sink']) => inserter(id, { source, sink, stack_size: 16 });

/** Three machines, two belts, two chests, two drills and inserters between them, with the inserter fields given by index */
function form(changed: Record<number, Partial<InserterFormData>> = {}): ConfigFormData {
    let config = createDefaultConfig();
    config = edits.addMachine(edits.addMachine(config));
    config = edits.addBelt(edits.addBelt(config));
    config = edits.addChest(edits.addChest(config), ChestType.INFINITY_CHEST);
    config = edits.addDrill(edits.addDrill(config));
    config = edits.updateDrill(config, 1, { target: { type: 'machine', id: 3 } });
    return {
        ...config,
        inserters: [
            linked(1, { type: 'belt', id: 2, near_lane: 1 }, { type: 'machine', id: 3 }),
            linked(2, { type: 'machine', id: 3 }, { type: 'chest', id: 2 }),
            linked(3, { type: 'machine', id: 1 }, { type: 'belt', id: 1 }),
        ].map((ins, i) => ({ ...ins, ...changed[i] })),
    };
}

/** A transfer plan in which each inserter (by id) moves the given items */
const plan = (transfers: Record<number, string[]>) => ({
    computed_lcm: 1,
    entities: Object.entries(transfers).map(([id, items]) => ({
        entity_id: `inserter:${id}`,
        entity_type: 'inserter',
        entity_number: Number(id),
        item_transfers: items.map((item_name) => ({ item_name })),
    })),
}) as unknown as SerializableTransferPlan;

describe('nextId', () => {
    it('is one past the highest id, or 1 when there is none', () => {
        expect(edits.nextId(createDefaultConfig(), 'belts')).toBe(1);
        expect(edits.nextId(createDefaultConfig(), 'machines')).toBe(2);
        expect(edits.nextId(form(), 'drills')).toBe(3);
        expect(edits.nextId(createDefaultConfig(), 'drills')).toBe(1);
    });
});

describe('ids', () => {
    it('give the removed number back to the next entity added, as the rest move down', () => {
        const config = edits.addInserter(edits.removeInserter(form(), 1));
        expect(ids(config.inserters)).toEqual([1, 2, 3]);
        expect(config.inserters.at(-1)!._uuid).not.toBe('inserter-2');
    });

    it('are past those of entities that were put in without taking an id', () => {
        expect(ids(edits.addBelt(build({ belts: [belt(9)] })).belts)).toEqual([9, 10]);
    });
});

describe('target output', () => {
    it('sets one field, and leaves an optional one, the gap between copies, out when it is cleared', () => {
        const set = edits.updateTargetOutput(edits.updateTargetOutput(createDefaultConfig(), 'recipe', 'iron-gear-wheel'), 'copy_offset', { x: -12, y: 0 });
        expect(set.target_output).toEqual({ recipe: 'iron-gear-wheel', items_per_second: 1, copies: 1, copy_offset: { x: -12, y: 0 } });
        const cleared = edits.updateTargetOutput(set, 'copy_offset', undefined);
        expect(cleared.target_output).toEqual({ recipe: 'iron-gear-wheel', items_per_second: 1, copies: 1 });
        expect('copy_offset' in cleared.target_output).toBe(false);
    });
});

describe('machines', () => {
    it('adds a machine with the next id and default values, of Normal quality as every entity in the game is unless built otherwise', () => {
        const config = edits.addMachine(createDefaultConfig());
        expect(ids(config.machines)).toEqual([1, 2]);
        expect(config.machines[1]).toMatchObject({ recipe: '', productivity: 0, crafting_speed: 1 });
        expect(config.machines[1]._uuid).not.toBe(config.machines[0]._uuid);
        expect(config.machines.map((m) => m.quality)).toEqual(['normal', 'normal']);
    });

    it('updates one field of the machine at an index', () => {
        const config = edits.updateMachine(form(), 1, 'recipe', 'copper-cable');
        expect(config.machines.map((m) => m.recipe)).toEqual(['', 'copper-cable', '']);
    });

    it('removes the machine at an index and renumbers the rest', () => {
        const before = form();
        const config = edits.removeMachine(before, 0);
        expect(ids(config.machines)).toEqual([1, 2]);
        expect(config.machines.map((m) => m._uuid)).toEqual([before.machines[1]._uuid, before.machines[2]._uuid]);
        // machine 3 is now 2; the ends at machine 1 are unset
        expect(config.inserters.map((ins) => [ins.source, ins.sink])).toEqual([
            [{ type: 'belt', id: 2, near_lane: 1 }, { type: 'machine', id: 2 }],
            [{ type: 'machine', id: 2 }, { type: 'chest', id: 2 }],
            [{ type: 'machine', id: 0 }, { type: 'belt', id: 1 }],
        ]);
        expect(config.drills!.configs.map((d) => d.target)).toEqual([{ type: 'machine', id: 0 }, { type: 'machine', id: 2 }]);
    });

    it('leaves the form as it is when there is no machine at the index', () => {
        const before = form();
        expect(edits.removeMachine(before, 3)).toBe(before);
        expect(edits.removeMachine(before, -1)).toBe(before);
    });

    it('unsets the inserter ends and drill targets at a removed machine', () => {
        const config = edits.removeMachine(form(), 2);
        expect(config.inserters.map((ins) => [ins.source, ins.sink])).toEqual([
            [{ type: 'belt', id: 2, near_lane: 1 }, { type: 'machine', id: 0 }],
            [{ type: 'machine', id: 0 }, { type: 'chest', id: 2 }],
            [{ type: 'machine', id: 1 }, { type: 'belt', id: 1 }],
        ]);
        expect(config.drills!.configs.map((d) => d.target)).toEqual([{ type: 'machine', id: 1 }, { type: 'machine', id: 0 }]);
        // and they stay unset when the machines are renumbered
        expect(edits.reorderMachines(config, 1, 0).inserters[1].source).toEqual({ type: 'machine', id: 0 });
    });

    it('renumbers the machines on reorder and follows them in inserters and drills', () => {
        const before = form();
        const config = edits.reorderMachines(before, 2, 0);
        expect(config.machines.map((m) => m._uuid)).toEqual([2, 0, 1].map((i) => before.machines[i]._uuid));
        expect(ids(config.machines)).toEqual([1, 2, 3]);
        // machine 3 is now 1 and machine 1 is now 2
        expect(config.inserters.map((ins) => [ins.source, ins.sink])).toEqual([
            [{ type: 'belt', id: 2, near_lane: 1 }, { type: 'machine', id: 1 }],
            [{ type: 'machine', id: 1 }, { type: 'chest', id: 2 }],
            [{ type: 'machine', id: 2 }, { type: 'belt', id: 1 }],
        ]);
        expect(config.drills!.configs.map((d) => d.target.id)).toEqual([2, 1]);
    });
});

describe('inserters', () => {
    it('adds an inserter with the next id from machine 1 to belt 1', () => {
        const config = edits.addInserter(form());
        expect(config.inserters[3]).toMatchObject({ id: 4, source: { type: 'machine', id: 1 }, sink: { type: 'belt', id: 1 }, stack_size: 16 });
    });

    it('merges updates into the inserter at an index', () => {
        const config = edits.updateInserter(form(), 2, { stack_size: 4, filters: ['iron-plate'] });
        expect(config.inserters[2]).toMatchObject({ id: 3, stack_size: 4, filters: ['iron-plate'], source: { type: 'machine', id: 1 } });
    });

    describe('marked as side-loading onto another belt', () => {
        const mark = { status: 'side-loaded', tiles: 3 } as const;
        const marked = () => form({ 2: { sink: { type: 'belt', id: 1, drop_capture: mark } } });

        it('keeps the mark when the sink is picked again as it is, and when other fields change', () => {
            expect(edits.updateInserter(marked(), 2, { stack_size: 4 }).inserters[2].sink).toEqual({ type: 'belt', id: 1, drop_capture: mark });
            expect(edits.updateInserter(marked(), 2, { sink: { type: 'belt', id: 1, drop_capture: mark } }).inserters[2].sink)
                .toEqual({ type: 'belt', id: 1, drop_capture: mark });
        });

        it('loses the mark when the sink is pointed at another belt, a machine or a chest', () => {
            for (const sink of [{ type: 'belt', id: 2 }, { type: 'machine', id: 2 }, { type: 'chest', id: 1 }] as const) {
                expect(edits.updateInserter(marked(), 2, { sink }).inserters[2].sink).toEqual(sink);
            }
        });
    });

    it('keeps the uuid, rule and forced flag on an inserter it renumbers', () => {
        const rule: EnableControlOverride = { mode: 'CLOCKED', ranges: [{ start: 0, end: 10 }], period_duration_ticks: 60 };
        const config = edits.removeInserter(form({ 2: { overrides: { enable_control: rule }, _forced_always: true } }), 0);
        expect(ids(config.inserters)).toEqual([1, 2]);
        expect(config.inserters.map((ins) => ins._uuid)).toEqual(['inserter-2', 'inserter-3']);
        expect(config.inserters[1]).toMatchObject({ id: 2, _forced_always: true, overrides: { enable_control: rule } });
        expect('_forced_always' in config.inserters[0]).toBe(false);
    });
});

describe('belts', () => {
    it('adds a turbo belt with one empty lane', () => {
        const config = edits.addBelt(createDefaultConfig());
        expect(config.belts).toEqual([
            { id: 1, _uuid: expect.any(String), type: 'turbo-transport-belt', lanes: [{ ingredient: '', stack_size: 4 }] },
        ]);
    });

    it('merges updates into the belt at an index', () => {
        const config = edits.updateBelt(form(), 0, { type: 'transport-belt' });
        expect(config.belts.map((b) => b.type)).toEqual(['transport-belt', 'turbo-transport-belt']);
    });

    it('removes the belt at an index and renumbers the rest, keeping the lane of the ends it moves', () => {
        const config = edits.removeBelt(form(), 0);
        expect(ids(config.belts)).toEqual([1]);
        expect(config.inserters[0].source).toEqual({ type: 'belt', id: 1, near_lane: 1 });
        expect(config.inserters[2].sink).toEqual({ type: 'belt', id: 0 });
    });

    it('unsets the inserter ends at a removed belt, with the lane they took from first', () => {
        const config = edits.removeBelt(form(), 1);
        expect(config.inserters.map((ins) => [ins.source, ins.sink])).toEqual([
            [{ type: 'belt', id: 0 }, { type: 'machine', id: 3 }],
            [{ type: 'machine', id: 3 }, { type: 'chest', id: 2 }],
            [{ type: 'machine', id: 1 }, { type: 'belt', id: 1 }],
        ]);
    });

    it('renumbers the belts on reorder and follows them in inserters', () => {
        const config = edits.reorderBelts(form(), 1, 0);
        expect(config.inserters[0].source).toEqual({ type: 'belt', id: 1, near_lane: 1 });
        expect(config.inserters[2].sink).toEqual({ type: 'belt', id: 2 });
    });
});

describe('chests', () => {
    it('adds a buffer chest by default and an infinity chest when asked', () => {
        const config = form();
        expect(config.chests).toEqual([
            { type: ChestType.BUFFER_CHEST, id: 1, _uuid: expect.any(String), storage_size: 1, item_filter: '' },
            { type: ChestType.INFINITY_CHEST, id: 2, _uuid: expect.any(String), item_filter: [{ item_name: '', request_count: 1 }] },
        ]);
    });

    it('merges updates into the chest at an index', () => {
        const config = edits.updateChest(form(), 0, { item_filter: 'iron-plate' });
        expect(config.chests[0]).toMatchObject({ item_filter: 'iron-plate', storage_size: 1 });
    });

    it('switches the type of a chest, keeping its id and uuid', () => {
        const before = form();
        const config = edits.switchChestType(before, 1, ChestType.BUFFER_CHEST);
        expect(config.chests[1]).toEqual({ type: ChestType.BUFFER_CHEST, id: 2, _uuid: before.chests[1]._uuid, storage_size: 1, item_filter: '',
            _chest_settings: { buffer_filter: '', infinity_filters: [{ item_name: '', request_count: 1 }] } });
        expect(config.chests[0]).toBe(before.chests[0]);
    });

    it('preserves filter slots and counts through type changes, including edits made as a buffer chest', () => {
        const filters = [{ item_name: 'iron-plate', request_count: 64 }, { item_name: 'copper-plate', request_count: 32 }];
        const before = edits.updateChest(form(), 1, { item_filter: filters });
        const buffer = edits.switchChestType(before, 1, ChestType.BUFFER_CHEST);
        expect(buffer.chests[1]).toMatchObject({ item_filter: 'iron-plate', _chest_settings: { infinity_filters: filters } });
        const edited = edits.updateChest(buffer, 1, { storage_size: 24, item_filter: 'steel-plate' });
        const infinity = edits.switchChestType(edited, 1, ChestType.INFINITY_CHEST);
        expect(infinity.chests[1]).toMatchObject({ item_filter: [
            { item_name: 'steel-plate', request_count: 1 }, filters[1],
        ] });
        expect(edits.switchChestType(infinity, 1, ChestType.BUFFER_CHEST).chests[1])
            .toMatchObject({ storage_size: 24, item_filter: 'steel-plate' });
        expect(before.chests[1]).toMatchObject({ item_filter: filters });
    });

    it('switches a dialog draft with the same conversion as the saved form in both directions, keeping identity', () => {
        const buffer = bufferChest(7, { item_filter: 'coal', storage_size: 3 });
        const infinity = edits.switchedChest(buffer, ChestType.INFINITY_CHEST);
        expect(edits.switchChestType(build({ chests: [buffer] }), 0, ChestType.INFINITY_CHEST).chests[0]).toEqual(infinity);
        expect(infinity).toMatchObject({ id: 7, _uuid: 'chest-7', type: ChestType.INFINITY_CHEST });
        expect(edits.switchedChest(infinity, ChestType.BUFFER_CHEST)).toEqual(edits.switchChestType(build({ chests: [infinity] }), 0, ChestType.BUFFER_CHEST).chests[0]);
    });

    it('removes the chest at an index, unsetting the inserter ends at it, and renumbers the rest with their type and fields', () => {
        const before = form();
        expect(edits.removeChest(before, 1).inserters[1].sink).toEqual({ type: 'chest', id: 0 });
        const removed = edits.removeChest(before, 0);
        expect(removed.chests).toEqual([{ ...before.chests[1], id: 1 }]);
        expect(removed.chests[0].type).toBe(ChestType.INFINITY_CHEST);
    });

    it('renumbers the chests on reorder and follows them in inserters', () => {
        const config = edits.reorderChests(form(), 1, 0);
        expect(config.inserters[1].sink).toEqual({ type: 'chest', id: 1 });
    });
});

describe('drills', () => {
    it('adds an electric drill for machine 1, enabling drills first, and keeps them on with none left', () => {
        const config = edits.addDrill(createDefaultConfig());
        expect(config.drills).toEqual({
            configs: [{ id: 1, _uuid: expect.any(String), type: 'electric-mining-drill', mined_item_name: '', speed_bonus: 0, productivity: 0, target: { type: 'machine', id: 1 } }],
        });
        // the stored build keeps an empty drills entry, which the generator reads as no drills
        expect(edits.removeDrill(config, 0).drills).toEqual({ configs: [] });
    });

    it('sets a drill\'s own productivity', () => {
        const updated = edits.updateDrill(form(), 1, { productivity: 490 });
        expect(updated.drills!.configs.map(drill => drill.productivity)).toEqual([0, 490]);
    });

    it('removes the drill at an index, renumbering the rest', () => {
        const before = form();
        const config = edits.removeDrill(before, 0);
        expect(ids(config.drills!.configs)).toEqual([1]);
        expect(config.drills!.configs[0]._uuid).toBe(before.drills!.configs[1]._uuid);
        expect(config.drills!.configs[0].target).toEqual({ type: 'machine', id: 3 });
        const none = createDefaultConfig();
        expect(edits.removeDrill(none, 0)).toBe(none);
    });

    it('renumbers the drills on reorder', () => {
        const config = edits.reorderDrills(form(), 1, 0);
        expect(config.drills!.configs.map((d) => [d.id, d.target.id])).toEqual([[1, 3], [2, 1]]);
    });
});

describe('renumbering', () => {
    it('follows ids that were out of order or had a hole, and unsets the ends at the removed machine', () => {
        const config = {
            ...form(),
            machines: [machine(5), machine(1), machine(2)],
            inserters: [
                linked(1, { type: 'machine', id: 5 }, { type: 'machine', id: 1 }),
                linked(2, { type: 'machine', id: 2 }, { type: 'belt', id: 1 }),
            ],
        };
        const removed = edits.removeMachine(config, 1);
        expect(ids(removed.machines)).toEqual([1, 2]);
        expect(removed.inserters.map((ins) => [ins.source.id, ins.sink.id])).toEqual([[1, 0], [2, 1]]);

        // a reorder that moves nothing maps them as before
        const reordered = edits.reorderMachines(config, 0, 0);
        expect(ids(reordered.machines)).toEqual([1, 2, 3]);
        expect(reordered.inserters.map((ins) => [ins.source.id, ins.sink.id])).toEqual([[1, 2], [3, 1]]);
    });

    it('unsets a reference to an id no entity has, after a remove and after a reorder', () => {
        const config = { ...form(), inserters: [linked(1, { type: 'machine', id: 9 }, { type: 'belt', id: 1 })] };
        expect(edits.removeMachine(config, 0).inserters[0].source).toEqual({ type: 'machine', id: 0 });
        expect(edits.reorderMachines(config, 0, 1).inserters[0].source).toEqual({ type: 'machine', id: 0 });
    });

    /** Every id of each kind is 1 to n */
    function expectNumbered(config: ConfigFormData) {
        for (const list of [config.machines, config.belts, config.chests, config.inserters, config.drills?.configs ?? []].map(ids)) {
            expect(list).toEqual(list.map((_, i) => i + 1));
        }
    }

    /** Every reference, by the uuid of the entity holding it and its role, with the uuid of the entity it names (null if none) */
    function references(config: ConfigFormData): Map<string, { end: End; target: string | null }> {
        const pool = { machine: config.machines, belt: config.belts, chest: config.chests };
        const target = (end: End) => pool[end.type].find((e) => e.id === end.id)?._uuid ?? null;
        const refs = new Map<string, { end: End; target: string | null }>();
        for (const ins of config.inserters) {
            refs.set(`${ins._uuid} source`, { end: ins.source, target: target(ins.source) });
            refs.set(`${ins._uuid} sink`, { end: ins.sink, target: target(ins.sink) });
        }
        for (const drill of config.drills?.configs ?? []) {
            refs.set(`${drill._uuid} target`, { end: drill.target, target: target(drill.target) });
        }
        return refs;
    }

    /**
     * Every reference still names the entity it named before the edit, with its lane, unless it named the removed entity;
     * then it is unset, `{ type, id: 0 }` with no lane
     */
    function expectFollowed(before: ConfigFormData, after: ConfigFormData, removed?: string) {
        const was = references(before);
        for (const [key, now] of references(after)) {
            const old = was.get(key)!;
            expect(old, key).toBeDefined();
            if (old.target !== null && old.target === removed) {
                expect(now.end, key).toEqual({ type: old.end.type, id: 0 });
            } else {
                expect(now.target, key).toBe(old.target);
                expect(now.end.near_lane, key).toBe(old.end.near_lane);
            }
        }
    }

    const kinds = [
        { name: 'machines', remove: edits.removeMachine, reorder: edits.reorderMachines, list: (c: ConfigFormData) => c.machines },
        { name: 'inserters', remove: edits.removeInserter, reorder: edits.reorderInserters, list: (c: ConfigFormData) => c.inserters },
        { name: 'belts', remove: edits.removeBelt, reorder: edits.reorderBelts, list: (c: ConfigFormData) => c.belts },
        { name: 'chests', remove: edits.removeChest, reorder: edits.reorderChests, list: (c: ConfigFormData) => c.chests },
        { name: 'drills', remove: edits.removeDrill, reorder: edits.reorderDrills, list: (c: ConfigFormData) => c.drills!.configs },
    ];

    it.each(kinds)('numbers the $name 1 to n and keeps every reference on its entity after any remove or reorder', ({ remove, reorder, list }) => {
        const before = form();
        const count = list(before).length;
        for (let i = 0; i < count; i++) {
            const removed = remove(before, i);
            expectNumbered(removed);
            expect(list(removed).map((e) => e._uuid)).toEqual(list(before).filter((_, k) => k !== i).map((e) => e._uuid));
            expectFollowed(before, removed, list(before)[i]._uuid);
            for (let j = 0; j < count; j++) {
                const reordered = reorder(before, i, j);
                expectNumbered(reordered);
                expectFollowed(before, reordered);
            }
        }
    });
});

describe('overrides', () => {
    it('sets an override and drops the overrides once none is left', () => {
        const config = edits.updateOverrides(createDefaultConfig(), 'lcm', 120);
        expect(config.overrides).toEqual({ lcm: 120 });
        expect('overrides' in edits.updateOverrides(config, 'lcm', undefined)).toBe(false);
    });

    const ironPlan = plan({ 1: ['iron-plate'] });

    /** Forced to ALWAYS by Exclude from LCM, and flagged so */
    function expectForced(ins: InserterFormData, overrides: InserterFormData['overrides'] = { enable_control: { mode: 'ALWAYS' } }) {
        expect(ins.overrides).toEqual(overrides);
        expect(ins._forced_always).toBe(true);
    }

    /** Not flagged, with the overrides given or none at all */
    function expectUnforced(ins: InserterFormData, overrides?: InserterFormData['overrides']) {
        expect('_forced_always' in ins).toBe(false);
        if (overrides) expect(ins.overrides).toEqual(overrides);
        else expect('overrides' in ins).toBe(false);
    }

    it.each<[string, Partial<InserterFormData>, InserterFormData['overrides']]>([
        ['no rule', {}, undefined],
        ['an explicit AUTO rule', { overrides: { enable_control: { mode: 'AUTO' } } }, undefined],
        ['other overrides', { overrides: { animation: { pickup_duration_ticks: 12 } } }, { animation: { pickup_duration_ticks: 12 } }],
    ])('forces an inserter with %s to ALWAYS once all its items are ignored, and takes back only that ALWAYS once they are not', (_name, fields, kept) => {
        const config = form({ 0: fields });
        const ignored = edits.updateIgnoredIngredients(config, ['iron-plate'], ironPlan);
        expect(ignored.overrides).toEqual({ ignored_lcm_ingredients: ['iron-plate'] });
        expectForced(ignored.inserters[0], { ...kept, enable_control: { mode: 'ALWAYS' } });
        expect(ignored.inserters[1]).toBe(config.inserters[1]);
        const reverted = edits.updateIgnoredIngredients(ignored, [], ironPlan);
        expect('overrides' in reverted).toBe(false);
        expectUnforced(reverted.inserters[0], kept);
    });

    it.each<EnableControlOverride>([
        { mode: 'CLOCKED', ranges: [{ start: 0, end: 10 }], period_duration_ticks: 60 },
        { mode: 'CONDITIONAL', rule_set: { operator: 'AND', rules: [] } },
        { mode: 'NEVER' },
        { mode: 'ALWAYS' },
    ])('leaves the $mode rule the player set alone when its items are excluded and included again', (rule) => {
        const config = form({ 0: { overrides: { enable_control: rule } } });
        const ignored = edits.updateIgnoredIngredients(config, ['iron-plate'], ironPlan);
        expect(ignored.inserters[0]).toBe(config.inserters[0]);
        expect('_forced_always' in ignored.inserters[0]).toBe(false);
        expect(edits.updateIgnoredIngredients(ignored, [], ironPlan).inserters[0]).toBe(config.inserters[0]);
    });

    it('forces an inserter with two items only once both are excluded, and reverts it when one is included', () => {
        const twoItems = plan({ 1: ['iron-plate', 'copper-plate'] });
        const config = form();
        const one = edits.updateIgnoredIngredients(config, ['iron-plate'], twoItems);
        expect(one.inserters[0]).toBe(config.inserters[0]);
        const both = edits.updateIgnoredIngredients(one, ['iron-plate', 'copper-plate'], twoItems);
        expectForced(both.inserters[0]);
        expectUnforced(edits.updateIgnoredIngredients(both, ['copper-plate'], twoItems).inserters[0]);
    });

    it('leaves a forced inserter forced when run again with the same items', () => {
        const ignored = edits.updateIgnoredIngredients(form(), ['iron-plate'], ironPlan);
        const again = edits.updateIgnoredIngredients(ignored, ['iron-plate'], ironPlan);
        expect(again.inserters[0]).toBe(ignored.inserters[0]);
        expect(again.inserters[0]._forced_always).toBe(true);
    });

    it('drops the flag but keeps the rule of a flagged inserter whose rule is not ALWAYS', () => {
        const config = form({ 0: { overrides: { enable_control: { mode: 'NEVER' } }, _forced_always: true } });
        expectUnforced(edits.updateIgnoredIngredients(config, [], ironPlan).inserters[0], { enable_control: { mode: 'NEVER' } });
    });

    it('unflags an inserter whose rule is replaced, and keeps the flag through other edits', () => {
        const forced = edits.updateIgnoredIngredients(form(), ['iron-plate'], ironPlan);
        const replaced = edits.updateInserter(forced, 0, { overrides: { enable_control: { mode: 'ALWAYS' } } });
        expectUnforced(replaced.inserters[0], { enable_control: { mode: 'ALWAYS' } });
        expect(edits.updateInserter(forced, 0, { stack_size: 12 }).inserters[0]).toMatchObject({ _forced_always: true, stack_size: 12 });
    });

    it('keeps the flag on the inserter, not its id, through a reorder', () => {
        const forced = edits.updateIgnoredIngredients(form(), ['iron-plate'], ironPlan);
        const reordered = edits.reorderInserters(forced, 0, 2);
        expect(reordered.inserters.map((ins) => [ins._uuid, ins.id, ins._forced_always])).toEqual([
            ['inserter-2', 1, undefined],
            ['inserter-3', 2, undefined],
            ['inserter-1', 3, true],
        ]);
    });

    it('finds the inserters by their ids as they are now, after a remove', () => {
        const config = edits.addInserter(edits.removeInserter(edits.addInserter(form()), 0));
        expect(ids(config.inserters)).toEqual([1, 2, 3, 4]);
        const ignored = edits.updateIgnoredIngredients(config, ['iron-plate'], plan({ 3: ['iron-plate'] }));
        expect(ignored.inserters.map((ins) => ins._forced_always ?? false)).toEqual([false, false, true, false]);
        // the inserter now numbered 3 was inserter 4 before the remove
        expect(ignored.inserters[2]._uuid).toBe(config.inserters[2]._uuid);
    });
});

describe('duplicateEntity', () => {
    it.each<EntityKind>(['machines', 'inserters', 'belts', 'chests', 'drills'])('appends a deep copy of %s without changing references', kind => {
        const before = form({ 0: { prototype: 'bulk-inserter', quality: 'epic', overrides: { enable_control: { mode: 'ALWAYS' } }, _forced_always: true, filters: ['iron-plate'] } });
        delete before.inserters[0].stack_size;
        const original = structuredClone(before);
        const after = edits.duplicateEntity(before, kind, 0);
        const oldRows = kind === 'drills' ? before.drills!.configs : before[kind];
        const newRows = kind === 'drills' ? after.drills!.configs : after[kind];
        const copy = newRows.at(-1)!;
        expect(newRows).toHaveLength(oldRows.length + 1);
        expect(copy.id).toBe(edits.nextId(before, kind));
        expect(copy._uuid).not.toBe(oldRows[0]._uuid);
        expect({ ...copy, id: oldRows[0].id, _uuid: oldRows[0]._uuid }).toEqual(oldRows[0]);
        expect(newRows.slice(0, -1)).toEqual(oldRows);
        expect(after.inserters.slice(0, before.inserters.length)).toEqual(before.inserters);
        if (kind === 'belts') after.belts.at(-1)!.lanes[0].ingredient = 'changed';
        if (kind === 'inserters') {
            after.inserters.at(-1)!.filters!.push('changed');
            after.inserters.at(-1)!.source.near_lane = 2;
            expect(after.inserters.at(-1)).not.toHaveProperty('stack_size');
        }
        if (kind === 'chests') {
            const infinity = edits.duplicateEntity(before, kind, 1).chests.at(-1)!;
            if (infinity.type === ChestType.INFINITY_CHEST) infinity.item_filter[0].item_name = 'changed';
        }
        expect(before).toEqual(original);
        expect(edits.duplicateEntity(before, kind, -1)).toBe(before);
        expect(edits.duplicateEntity(before, kind, oldRows.length)).toBe(before);
    });
});

describe('updateInserters', () => {
    it('changes only selected rows and preserves untouched metadata and rules', () => {
        const before = form({ 0: { overrides: { enable_control: { mode: 'ALWAYS' } }, _forced_always: true, prototype: 'fast-inserter', quality: 'legendary' } });
        const after = edits.updateInserters(before, [before.inserters[0]._uuid, before.inserters[2]._uuid], { stack_size: 12 });
        expect(after.inserters.map(row => row.stack_size)).toEqual([12, 16, 12]);
        expect(after.inserters[1]).toBe(before.inserters[1]);
        expect(after.inserters[0].source).toBe(before.inserters[0].source);
        expect(after.inserters[0]).toMatchObject({ prototype: 'fast-inserter', quality: 'legendary', _forced_always: true });
        expect(after.inserters[0].overrides).toBe(before.inserters[0].overrides);
        expect(edits.updateInserters(before, [], { stack_size: 3 })).toBe(before);
    });
    it('merges rules with each row’s own other overrides and removes the forced flag', () => {
        const before = form({ 0: { overrides: { animation: { pickup_duration_ticks: 4 }, enable_control: { mode: 'ALWAYS' } }, _forced_always: true },
            2: { overrides: { animation: { pickup_duration_ticks: 8 } } } });
        const after = edits.updateInserters(before, before.inserters.map(row => row._uuid), { overrides: { enable_control: { mode: 'NEVER' } } });
        expect(after.inserters[0].overrides).toEqual({ animation: { pickup_duration_ticks: 4 }, enable_control: { mode: 'NEVER' } });
        expect(after.inserters[2].overrides).toEqual({ animation: { pickup_duration_ticks: 8 }, enable_control: { mode: 'NEVER' } });
        expect(after.inserters[0]).not.toHaveProperty('_forced_always');
        expect(before.inserters[0]._forced_always).toBe(true);
    });
    it('applies Auto to mixed rules and clears only selected forced flags', () => {
        const before = form({ 0: { overrides: { animation: { pickup_duration_ticks: 4 }, enable_control: { mode: 'ALWAYS' } }, _forced_always: true },
            1: { overrides: { enable_control: { mode: 'NEVER' } } }, 2: { overrides: { enable_control: { mode: 'ALWAYS' } }, _forced_always: true } });
        const after = edits.updateInserters(before, before.inserters.slice(0, 2).map(row => row._uuid), { overrides: { enable_control: undefined } });
        expect(after.inserters.slice(0, 2).every(row => row.overrides?.enable_control === undefined && row._forced_always === undefined)).toBe(true);
        expect(after.inserters[0].overrides?.animation).toEqual({ pickup_duration_ticks: 4 });
        expect(after.inserters[2]).toBe(before.inserters[2]);
    });
    it('removes filter and stack keys for Automatic only on selected UUIDs', () => {
        const before = form({ 0: { filters: ['iron-plate'] }, 1: { filters: ['copper-plate'] } });
        const after = edits.updateInserters(before, [before.inserters[0]._uuid], { filters: undefined, stack_size: undefined });
        expect(after.inserters[0]).not.toHaveProperty('filters');
        expect(after.inserters[0]).not.toHaveProperty('stack_size');
        expect(after.inserters[1]).toBe(before.inserters[1]);
    });
});

describe('a captured blacklist', () => {
    /** The form with its first inserter's filters captured as a blacklist of iron plates */
    const blacklisted = () => form({ 0: { filters: ['iron-plate'], filter_mode: 'blacklist' } });

    it('loses its mode with its filters when the row goes back to automatic filters', () => {
        const before = blacklisted();
        for (const filters of [undefined, []]) {
            const after = edits.updateInserter(before, 0, { filters });
            expect(after.inserters[0]).not.toHaveProperty('filter_mode');
            // filters picked by hand afterwards are the items to move, not a blacklist the engine refuses
            expect(edits.updateInserter(after, 0, { filters: ['iron-gear-wheel'] }).inserters[0]).not.toHaveProperty('filter_mode');
        }
        expect(before.inserters[0].filter_mode).toBe('blacklist');
    });

    it('loses its mode with its filters in a bulk edit back to automatic filters', () => {
        const before = blacklisted();
        const after = edits.updateInserters(before, [before.inserters[0]._uuid, before.inserters[1]._uuid], { filters: undefined });
        expect(after.inserters[0]).not.toHaveProperty('filter_mode');
        expect(after.inserters[0]).not.toHaveProperty('filters');
    });

    it('keeps its mode while it still names items, so it stays refused as captured', () => {
        const before = blacklisted();
        expect(edits.updateInserter(before, 0, { filters: ['iron-plate', 'copper-plate'] }).inserters[0].filter_mode).toBe('blacklist');
        expect(edits.updateInserters(before, [before.inserters[0]._uuid], { filters: ['copper-plate'] }).inserters[0].filter_mode).toBe('blacklist');
        expect(edits.updateInserter(before, 0, { stack_size: 4 }).inserters[0].filter_mode).toBe('blacklist');
    });
});
