import { describe, expect, it } from 'vitest';
import type { SerializableTransferPlan } from 'clock-generator/browser';
import { ChestType } from 'clock-generator/light';
import { belt, bufferChest, build, inserter, machine } from '../../test/fixtures';
import * as edits from './edits';
import {
    createDefaultConfig, type ConfigFormData, type EntityKind, type EnableControlOverride, type InfinityChestFormData, type InserterFormData,
} from './formData';

type End = InserterFormData['source'];
type Edit = (config: ConfigFormData) => ConfigFormData;
/** The rows of one kind in a form */
type Rows = (config: ConfigFormData) => { id: number; _uuid: string }[];

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
    it.each<{ why: string; config: ConfigFormData; kind: EntityKind; id: number }>([
        { why: 'no belts', config: createDefaultConfig(), kind: 'belts', id: 1 },
        { why: 'the one machine a new build has', config: createDefaultConfig(), kind: 'machines', id: 2 },
        { why: 'two drills', config: form(), kind: 'drills', id: 3 },
        { why: 'no drills entry at all', config: createDefaultConfig(), kind: 'drills', id: 1 },
    ])('is one past the highest id, or 1 when there is none: $id with $why', ({ config, kind, id }) => {
        expect(edits.nextId(config, kind)).toBe(id);
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

describe('rows of each kind', () => {
    it.each<{ what: string; before: ConfigFormData; add: Edit; rows: Rows; added: object }>([
        { what: 'a machine of Normal quality', before: form(), add: edits.addMachine, rows: (c) => c.machines,
            added: { id: 4, recipe: '', productivity: 0, crafting_speed: 1, quality: 'normal' } },
        { what: 'an inserter from machine 1 to belt 1', before: form(), add: edits.addInserter, rows: (c) => c.inserters,
            added: { id: 4, source: { type: 'machine', id: 1 }, sink: { type: 'belt', id: 1 }, stack_size: 16 } },
        { what: 'a turbo belt with one empty lane', before: form(), add: edits.addBelt, rows: (c) => c.belts,
            added: { id: 3, type: 'turbo-transport-belt', lanes: [{ ingredient: '', stack_size: 4 }] } },
        { what: 'a buffer chest by default', before: form(), add: edits.addChest, rows: (c) => c.chests,
            added: { id: 3, type: ChestType.BUFFER_CHEST, storage_size: 1, item_filter: '' } },
        { what: 'an infinity chest when asked', before: form(), add: (c) => edits.addChest(c, ChestType.INFINITY_CHEST), rows: (c) => c.chests,
            added: { id: 3, type: ChestType.INFINITY_CHEST, item_filter: [{ item_name: '', request_count: 1 }] } },
        { what: 'the first drill, enabling drills', before: createDefaultConfig(), add: edits.addDrill, rows: (c) => c.drills?.configs ?? [],
            added: { id: 1, type: 'electric-mining-drill', mined_item_name: '', speed_bonus: 0, productivity: 0, target: { type: 'machine', id: 1 } } },
    ])('adds $what after the others, with the next id, a fresh uuid and its default values', ({ before, add, rows, added }) => {
        const after = rows(add(before));
        expect(after.slice(0, -1)).toEqual(rows(before));
        expect(after.at(-1)).toEqual({ ...added, _uuid: expect.any(String) });
        expect(rows(before).map((row) => row._uuid)).not.toContain(after.at(-1)!._uuid);
    });

    it('starts a build with a machine of Normal quality, as every entity in the game is unless built otherwise', () => {
        expect(createDefaultConfig().machines.map((m) => m.quality)).toEqual(['normal']);
    });

    it('keeps drills on with none left', () => {
        // the stored build keeps an empty drills entry, which the generator reads as no drills
        expect(edits.removeDrill(edits.addDrill(createDefaultConfig()), 0).drills).toEqual({ configs: [] });
    });

    it.each<{ kind: string; edit: Edit; rows: Rows; expected: object[] }>([
        { kind: 'machine', edit: (c) => edits.updateMachine(c, 1, 'recipe', 'copper-cable'), rows: (c) => c.machines,
            expected: [{ recipe: '' }, { recipe: 'copper-cable' }, { recipe: '' }] },
        { kind: 'inserter', edit: (c) => edits.updateInserter(c, 2, { stack_size: 4, filters: ['iron-plate'] }), rows: (c) => c.inserters,
            expected: [{ stack_size: 16 }, { stack_size: 16 }, { id: 3, stack_size: 4, filters: ['iron-plate'], source: { type: 'machine', id: 1 } }] },
        { kind: 'belt', edit: (c) => edits.updateBelt(c, 0, { type: 'transport-belt' }), rows: (c) => c.belts,
            expected: [{ type: 'transport-belt' }, { type: 'turbo-transport-belt' }] },
        { kind: 'chest', edit: (c) => edits.updateChest(c, 0, { item_filter: 'iron-plate' }), rows: (c) => c.chests,
            expected: [{ item_filter: 'iron-plate', storage_size: 1 }, { item_filter: [{ item_name: '', request_count: 1 }] }] },
        { kind: 'drill', edit: (c) => edits.updateDrill(c, 1, { productivity: 490 }), rows: (c) => c.drills!.configs,
            expected: [{ productivity: 0 }, { productivity: 490 }] },
    ])('merges an update into the $kind at an index, keeping its other fields, and leaves the others', ({ edit, rows, expected }) => {
        expect(rows(edit(form()))).toMatchObject(expected);
    });

    it.each<{ why: string; before: ConfigFormData; edit: Edit }>([
        { why: 'no machine past the last', before: form(), edit: (c) => edits.removeMachine(c, 3) },
        { why: 'no machine at index -1', before: form(), edit: (c) => edits.removeMachine(c, -1) },
        { why: 'no drills at all', before: createDefaultConfig(), edit: (c) => edits.removeDrill(c, 0) },
    ])('leaves the form as it is when a remove finds $why', ({ before, edit }) => {
        expect(edit(before)).toBe(before);
    });
});

describe('inserters', () => {
    describe('marked as side-loading onto another belt', () => {
        const marked = (): InserterFormData['sink'] => ({ type: 'belt', id: 1, drop_capture: { status: 'side-loaded', tiles: 3 } });
        const updated = (update: Partial<InserterFormData>) => edits.updateInserter(form({ 2: { sink: marked() } }), 2, update).inserters[2].sink;

        it.each<{ what: string; update: Partial<InserterFormData> }>([
            { what: 'other fields change', update: { stack_size: 4 } },
            { what: 'the sink is picked again as it is', update: { sink: marked() } },
        ])('keeps the mark when $what', ({ update }) => {
            expect(updated(update)).toEqual(marked());
        });

        it.each<{ what: string; sink: InserterFormData['sink'] }>([
            { what: 'another belt', sink: { type: 'belt', id: 2 } },
            { what: 'a machine', sink: { type: 'machine', id: 2 } },
            { what: 'a chest', sink: { type: 'chest', id: 1 } },
        ])('loses the mark when the sink is pointed at $what', ({ sink }) => {
            expect(updated({ sink })).toEqual(sink);
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

describe('chests', () => {
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

    it.each<{ what: string; source: End }>([
        { what: 'an id no machine has', source: { type: 'machine', id: 9 } },
        { what: 'no machine yet (unset)', source: { type: 'machine', id: 0 } },
    ])('points a machine end at no machine after a remove and after a reorder, when it named $what', ({ source }) => {
        const config = { ...form(), inserters: [linked(1, source, { type: 'belt', id: 1 })] };
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
     * Every reference is still held, by every entity but the removed one, and still names the entity it named before the edit,
     * with its lane and all else but its id as it was, unless it named the removed entity; then it is unset, `{ type, id: 0 }` with no lane
     */
    function expectFollowed(before: ConfigFormData, after: ConfigFormData, removed?: string) {
        const was = references(before);
        expect([...references(after).keys()].sort()).toEqual([...was.keys()].filter((key) => !key.startsWith(`${removed} `)).sort());
        for (const [key, now] of references(after)) {
            const old = was.get(key)!;
            if (old.target !== null && old.target === removed) {
                expect(now.end, key).toEqual({ type: old.end.type, id: 0 });
            } else {
                expect(now.target, key).toBe(old.target);
                expect(now.end, key).toEqual({ ...old.end, id: now.end.id });
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

    it.each(kinds)('puts the $name in their new order, each as it was but numbered 1 to n, and keeps every reference on its entity after any remove or reorder', ({ remove, reorder, list }) => {
        const before = form();
        const rows = list(before);
        /** The rows in the order given, each numbered by its place and otherwise as it was */
        const numbered = <T extends { id: number }>(order: T[]) => order.map((row, k) => ({ ...row, id: k + 1 }));
        for (let i = 0; i < rows.length; i++) {
            const rest = rows.filter((_, k) => k !== i);
            const removed = remove(before, i);
            expectNumbered(removed);
            expect(list(removed)).toEqual(numbered(rest));
            expectFollowed(before, removed, rows[i]._uuid);
            for (let j = 0; j < rows.length; j++) {
                const reordered = reorder(before, i, j);
                expectNumbered(reordered);
                // the row taken from i is put in at j, the rest keep their order around it
                expect(list(reordered)).toEqual(numbered([...rest.slice(0, j), rows[i], ...rest.slice(j)]));
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
    /** The form with an inserter that has every optional field but a stack size, which it leaves to its prototype */
    function full() {
        const config = form({ 0: { prototype: 'bulk-inserter', quality: 'epic', overrides: { enable_control: { mode: 'ALWAYS' } }, _forced_always: true, filters: ['iron-plate'] } });
        delete config.inserters[0].stack_size;
        return config;
    }

    it.each<EntityKind>(['machines', 'inserters', 'belts', 'chests', 'drills'])('appends a copy of %s without changing references', kind => {
        const before = full();
        const original = structuredClone(before);
        const after = edits.duplicateEntity(before, kind, 0);
        const oldRows = kind === 'drills' ? before.drills!.configs : before[kind];
        const newRows = kind === 'drills' ? after.drills!.configs : after[kind];
        const copy = newRows.at(-1)!;
        expect(newRows).toHaveLength(oldRows.length + 1);
        expect(copy.id).toBe(edits.nextId(before, kind));
        expect(copy._uuid).not.toBe(oldRows[0]._uuid);
        // strict: no field is added to the copy, not even an undefined one (the inserter gets no stack size)
        expect({ ...copy, id: oldRows[0].id, _uuid: oldRows[0]._uuid }).toStrictEqual(oldRows[0]);
        expect(newRows.slice(0, -1)).toEqual(oldRows);
        expect(after.inserters.slice(0, before.inserters.length)).toEqual(before.inserters);
        expect(before).toEqual(original);
        expect(edits.duplicateEntity(before, kind, -1)).toBe(before);
        expect(edits.duplicateEntity(before, kind, oldRows.length)).toBe(before);
    });

    it.each<{ what: string; kind: EntityKind; index: number; change: (after: ConfigFormData) => void }>([
        { what: 'the lane of a belt', kind: 'belts', index: 0, change: (c) => { c.belts.at(-1)!.lanes[0].ingredient = 'changed'; } },
        { what: 'the filters and source of an inserter', kind: 'inserters', index: 0, change: (c) => {
            c.inserters.at(-1)!.filters!.push('changed');
            c.inserters.at(-1)!.source.near_lane = 2;
        } },
        { what: 'the filters of an infinity chest', kind: 'chests', index: 1, change: (c) => {
            (c.chests.at(-1) as InfinityChestFormData).item_filter[0].item_name = 'changed';
        } },
    ])('makes the copy deep: changing $what on it leaves the original as it was', ({ kind, index, change }) => {
        const before = full();
        const original = structuredClone(before);
        change(edits.duplicateEntity(before, kind, index));
        expect(before).toEqual(original);
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

    it.each<{ how: string; edit: Edit; gone: (keyof InserterFormData)[] }>([
        { how: 'cleared', edit: (c) => edits.updateInserter(c, 0, { filters: undefined }), gone: ['filter_mode'] },
        { how: 'emptied', edit: (c) => edits.updateInserter(c, 0, { filters: [] }), gone: ['filter_mode'] },
        { how: 'cleared in a bulk edit', edit: (c) => edits.updateInserters(c, [c.inserters[0]._uuid, c.inserters[1]._uuid], { filters: undefined }),
            gone: ['filter_mode', 'filters'] },
    ])('loses its mode with its filters when they are $how, back to automatic filters', ({ edit, gone }) => {
        const before = blacklisted();
        const after = edit(before);
        for (const key of gone) expect(after.inserters[0]).not.toHaveProperty(key);
        // filters picked by hand afterwards are the items to move, not a blacklist the engine refuses
        expect(edits.updateInserter(after, 0, { filters: ['iron-gear-wheel'] }).inserters[0]).not.toHaveProperty('filter_mode');
        expect(before.inserters[0].filter_mode).toBe('blacklist');
    });

    it.each<{ how: string; edit: Edit }>([
        { how: 'more items', edit: (c) => edits.updateInserter(c, 0, { filters: ['iron-plate', 'copper-plate'] }) },
        { how: 'other items, in a bulk edit', edit: (c) => edits.updateInserters(c, [c.inserters[0]._uuid], { filters: ['copper-plate'] }) },
        { how: 'its items, as another field changes', edit: (c) => edits.updateInserter(c, 0, { stack_size: 4 }) },
    ])('keeps its mode while it still names items, so it stays refused as captured: $how', ({ edit }) => {
        expect(edit(blacklisted()).inserters[0].filter_mode).toBe('blacklist');
    });
});
