import { describe, expect, it } from 'vitest';
import { Option } from 'clock-generator/light';
import { belt, bufferChest, drill as formDrill, infinityChest, inserter as formInserter, machine as formMachine } from '../test/fixtures';
import type { PastedEntities } from '../worker/types';
import { createDefaultConfig, type ConfigFormData } from './configForm/formData';
import { applyPaste, pastePreview, type ImportSelections, type PasteCategory } from './pastePreview';

const none: ImportSelections = { target: false, machines: false, drills: false, inserters: false, belts: false, chests: false };
const all: ImportSelections = { target: true, machines: true, drills: true, inserters: true, belts: true, chests: true };
const empty = (): PastedEntities => ({ machines: [], drills: [], inserters: [], belts: [], chests: [], guidance: Option.none, suggested_target: Option.none });
const current = (): ConfigFormData => ({ ...createDefaultConfig(), machines: [], inserters: [], chests: [], belts: [] });
// pasted rows, which have no `_uuid` yet
const machine = (id: number) => ({ id, recipe: '', productivity: 0, crafting_speed: 1 });
const inserter = (id: number, type: 'machine' | 'belt' | 'chest', source = 1, sink = 1) => ({ id, source: { type, id: source }, sink: { type, id: sink } });
const drill = (id: number, target = 1) => ({ id, type: 'electric-mining-drill' as const, mined_item_name: 'iron-ore', speed_bonus: 0, productivity: 0, target: { type: 'machine' as const, id: target } });

/** Per endpoint type: its category and its row 1, in the form or in a paste (whose `_uuid` the preview never reads) */
const endpoints = [['machine', 'machines', formMachine(1, { recipe: '' })], ['belt', 'belts', belt(1)], ['chest', 'chests', bufferChest(1)]] as const;

describe('selective Paste preview', () => {
    it('refuses to reuse imported drop geometry across a category replacement while allowing a complete related import', () => {
        const form = current(), incoming = empty();
        form.inserters = [formInserter(3, { sink: { type: 'belt', id: 1, drop: { lane: 1, position: 0.5 } } })];
        incoming.belts = [{ id: 1, type: 'fast-transport-belt', lanes: [{ ingredient: 'iron-plate', stack_size: 4 }] }];
        expect(pastePreview(form, incoming, { ...none, belts: true }).geometryProblem).toContain('Inserter 3');
        expect(pastePreview(form, incoming, none).geometryProblem).toBeNull();
        incoming.inserters = [{ id: 3, source: { type: 'machine', id: 1 }, sink: { type: 'belt', id: 1, drop: { lane: 1, position: 0.75 } } }];
        incoming.machines = [machine(1)];
        expect(pastePreview(form, incoming, { ...none, machines: true, inserters: true, belts: true }).geometryProblem).toBeNull();
    });
    it('counts the incomplete raw destination and actual result independently of exportability', () => {
        const form = current(), incoming = empty();
        form.machines = [1, 2, 3, 4].map(id => formMachine(id, { recipe: '' })); incoming.machines = [machine(1), machine(2)];
        const result = pastePreview(form, incoming, { ...none, machines: true });
        expect(result.counts.map(row => row.category)).toEqual(['machines', 'drills', 'inserters', 'belts', 'chests']);
        expect(result.counts[0]).toEqual({ category: 'machines', current: 4, incoming: 2, result: 2, replacing: true });
        expect(form.setpoint.item).toBe('');
        expect(pastePreview(form, incoming, none).counts[0]).toMatchObject({ current: 4, incoming: 2, result: 4, replacing: false });
    });
    it('retains current entities for selected empty categories and absent raw drills', () => {
        const form = current(); form.inserters = [formInserter(1)];
        const preview = pastePreview(form, empty(), all);
        expect(preview.counts.find(row => row.category === 'inserters')).toMatchObject({ replacing: false, result: 1 });
        expect(preview.counts.find(row => row.category === 'drills')).toMatchObject({ current: 0, result: 0 });
        expect(preview.crossings).toEqual([]);
    });
    it.each(endpoints)('warns for both imported %s endpoints pointing to retained categories, including matching IDs', (type, category, row) => {
        const form = { ...current(), [category]: [row] }, incoming = { ...empty(), inserters: [inserter(2, type, 1, 99)] };
        expect(pastePreview(form, incoming, { ...none, inserters: true }).crossings).toEqual([
            { ownerType: 'inserter', ownerId: 2, slot: 'source', endpointType: type, endpointId: 1, direction: 'incoming-to-retained', destinationExists: true },
            { ownerType: 'inserter', ownerId: 2, slot: 'sink', endpointType: type, endpointId: 99, direction: 'incoming-to-retained', destinationExists: false },
        ]);
    });
    it.each(endpoints)('warns when retained inserters point to replaced %s endpoints', (type, category, row) => {
        const form = { ...current(), inserters: [formInserter(1, { source: { type, id: 1 }, sink: { type, id: 99 } })] }, incoming = { ...empty(), [category]: [row] };
        const warnings = pastePreview(form, incoming, { ...none, [category]: true }).crossings;
        expect(warnings.map(warning => warning.direction)).toEqual(['retained-to-replaced', 'retained-to-replaced']);
        expect(warnings.map(warning => warning.destinationExists)).toEqual([true, false]);
    });
    it('covers drill targets in each direction, ignoring unchosen id zero', () => {
        const form = current(), incoming = empty(); incoming.drills = [drill(2), drill(1, 0)];
        expect(pastePreview(form, incoming, { ...none, drills: true }).crossings).toEqual([
            { ownerType: 'drill', ownerId: 2, slot: 'target', endpointType: 'machine', endpointId: 1, direction: 'incoming-to-retained', destinationExists: false },
        ]);
        form.drills = { configs: [formDrill(1)] }; incoming.machines = [machine(1)];
        expect(pastePreview(form, incoming, { ...none, machines: true }).crossings[0]).toMatchObject({ ownerType: 'drill', direction: 'retained-to-replaced', destinationExists: true });
    });
    it('uses the existing import adapter’s index fallback for an incoming inserter without an id', () => {
        const incoming = empty(), form = current();
        incoming.inserters = [{ source: { type: 'machine', id: 1 }, sink: { type: 'chest', id: 0 } }];
        expect(pastePreview(form, incoming, { ...none, inserters: true }).crossings[0]).toMatchObject({ ownerId: 1, slot: 'source' });
    });
    it('orders by dialog owner category, id and source before sink, without mutating inputs', () => {
        const form = current(), incoming = empty(); incoming.inserters = [inserter(3, 'machine'), inserter(1, 'machine')]; incoming.drills = [drill(2), drill(1)];
        const before = structuredClone({ form, incoming });
        const warnings = pastePreview(form, incoming, { ...none, inserters: true, drills: true }).crossings;
        expect(warnings.map(warning => `${warning.ownerType}:${warning.ownerId}:${warning.slot}`)).toEqual(['drill:1:target', 'drill:2:target', 'inserter:1:source', 'inserter:1:sink', 'inserter:3:source', 'inserter:3:sink']);
        expect({ form, incoming }).toEqual(before);
    });
    it('has no crossings when all related categories replace or all are retained', () => {
        const form = current(), incoming = empty(); incoming.machines = [machine(1)]; incoming.inserters = [inserter(1, 'machine')]; incoming.drills = [drill(1)];
        expect(pastePreview(form, incoming, { ...none, machines: true, inserters: true, drills: true }).crossings).toEqual([]);
        expect(pastePreview(form, incoming, none).crossings).toEqual([]);
    });
});

describe('atomic selective Paste', () => {
    const categories: PasteCategory[] = ['machines', 'drills', 'inserters', 'belts', 'chests'];
    const populated = (): PastedEntities => ({
        ...empty(),
        machines: [{ ...machine(7), fuel: 'coal' }],
        drills: [drill(8, 7)],
        inserters: [{ source: { type: 'machine', id: 7 }, sink: { type: 'belt', id: 9, drop: { lane: 2, position: 0.75 } },
            prototype: 'bulk-inserter', quality: 'rare', filters: ['iron-plate'] }, inserter(12, 'machine')],
        belts: [{ id: 9, type: 'fast-transport-belt', strategy: 'export', lanes: [{ ingredient: 'iron-plate', stack_size: 4, consumption_per_second: 2 }] }],
        chests: [{ id: 10, type: 'infinity-chest', item_filter: [], remove_unfiltered_items: true }],
    });
    const rows = (form: ConfigFormData, category: PasteCategory) => category === 'drills' ? form.drills?.configs ?? [] : form[category];

    it('matches the preview replacement policy for every category selection without mutating the raw destination', () => {
        const incoming = populated(), form: ConfigFormData = {
            ...current(), machines: [formMachine(1, { recipe: '' })], inserters: [formInserter(2, { _forced_always: true })],
            belts: [belt(4, { lanes: [{ ingredient: '', stack_size: 1 }] })], drills: { configs: [formDrill(3)] },
            chests: [infinityChest(5, { _chest_settings: { buffer_filter: 'coal', storage_size: 2 } })],
            setpoint: { item: '', copies: 0, items_per_second: 0 }, overrides: { kick_start_items: 3 },
        };
        const before = structuredClone({ form, incoming });
        for (let mask = 0; mask < 32; mask++) {
            const selections = { ...none };
            categories.forEach((category, index) => { selections[category] = (mask & (1 << index)) !== 0; });
            const next = applyPaste(form, incoming, selections);
            for (const count of pastePreview(form, incoming, selections).counts) {
                expect(rows(next, count.category)).toHaveLength(count.result);
                if (count.replacing) expect(rows(next, count.category)).not.toBe(rows(form, count.category));
                else expect(rows(next, count.category)).toBe(rows(form, count.category));
            }
            expect(next.setpoint).toBe(form.setpoint);
            expect(next.overrides).toBe(form.overrides);
        }
        expect({ form, incoming }).toEqual(before);
    });

    it('assigns fresh unique UUIDs and fallback inserter IDs while preserving imported settings and geometry', () => {
        const incoming = populated();
        const selections = { ...all, target: false };
        const next = applyPaste(current(), incoming, selections);
        const uuids = categories.flatMap(category => rows(next, category).map(row => row._uuid));
        expect(uuids.every(uuid => typeof uuid === 'string' && uuid.length > 0)).toBe(true);
        expect(new Set(uuids).size).toBe(uuids.length);
        expect(next.inserters.map(row => row.id)).toEqual([1, 12]);
        expect(next.inserters[0]).toMatchObject(incoming.inserters[0]);
        expect(next.machines[0]).toMatchObject(incoming.machines[0]);
        expect(next.belts[0]).toMatchObject(incoming.belts[0]);
        expect(next.chests[0]).toMatchObject(incoming.chests[0]);
        expect(next.drills!.configs[0]).toMatchObject(incoming.drills[0]);
        const again = applyPaste(current(), incoming, selections);
        expect(again.inserters[0]._uuid).not.toBe(next.inserters[0]._uuid);
    });

    it('retains selected empty categories and does not create absent drills', () => {
        const form = { ...current(), inserters: [formInserter(1)] };
        const next = applyPaste(form, empty(), all);
        for (const category of categories) {
            if (category !== 'drills') expect(next[category]).toBe(form[category]);
        }
        expect(next).not.toHaveProperty('drills');
        expect(next.setpoint).toBe(form.setpoint);
    });

    it('replaces Target Output only when both selected and supplied', () => {
        const form = current(), target = { item: 'iron-plate', copies: 2, items_per_second: 10 };
        expect(applyPaste(form, empty(), none, target).setpoint).toBe(form.setpoint);
        expect(applyPaste(form, empty(), { ...none, target: true }).setpoint).toBe(form.setpoint);
        expect(applyPaste(form, empty(), { ...none, target: true }, target).setpoint).toBe(target);
    });

    it("takes each imported drill's own productivity, and keeps the drills when they are not replaced", () => {
        const form = current(), incoming = populated();
        incoming.drills = [{ ...drill(8, 7), productivity: 490 }];
        form.drills = { configs: [formDrill(1, { productivity: 120 })] };
        expect(applyPaste(form, incoming, { ...none, drills: true }).drills?.configs.map(row => row.productivity)).toEqual([490]);
        expect(applyPaste(form, incoming, none).drills).toBe(form.drills);
        expect(applyPaste(form, empty(), { ...none, drills: true }).drills).toBe(form.drills);
    });
});

it('retains an exact rate unless the suggested numeric setpoint is selected', () => {
    const form = current();
    form.setpoint = { item: 'iron-gear-wheel', items_per_second: { numerator: 16, denominator: 7 }, copies: 2.25 };
    const suggested = { item: 'iron-gear-wheel', items_per_second: 2.5, copies: 1 };
    expect(applyPaste(form, empty(), none, suggested).setpoint).toEqual(form.setpoint);
    expect(applyPaste(form, empty(), { ...none, target: true }, suggested).setpoint).toEqual(suggested);
});

describe('a pasted blueprint', () => {
    const bonuses = { mining_drill_productivity_bonus: 100, inserter_stack_size_bonus: 3, bulk_inserter_capacity_bonus: 11, belt_stack_size_bonus: 3, recipes: {} };
    const research = {
        profile: 'Mine', template: null, bonuses,
        base: { machines: [{ id: 1, recipe: '', productivity: 0 }, { id: 2, recipe: '', productivity: 0 }], drills: [{ id: 1, productivity: 0 }],
            silos: [], inserters: [{ id: 1 }, { id: 2, stack_size: 3 }], belts: [{ id: 1 }] },
    };
    const pasted = (): PastedEntities => ({ ...empty(), machines: [machine(1), machine(2)], drills: [drill(1)], inserters: [inserter(1, 'machine'), inserter(2, 'machine')],
        belts: [{ id: 1, type: 'turbo-transport-belt', lanes: [{ ingredient: 'iron-plate', stack_size: 4 }] }] });

    it('writes its research block, the step between copies and the machines as the blueprint\'s', () => {
        const next = applyPaste(current(), pasted(), all, { item: 'iron-gear-wheel', items_per_second: 2, copies: 3 }, { research, copy_offset: { x: 0, y: 7 } });
        expect(next.research).toEqual(research);
        expect(next.setpoint).toEqual({ item: 'iron-gear-wheel', items_per_second: 2, copies: 3, copy_offset: { x: 0, y: 7 } });
        expect(next.machines.map(row => row._prototype_source)).toEqual([undefined, undefined]);
        const named = applyPaste(current(), { ...pasted(), machines: [{ ...machine(1), prototype: 'assembling-machine-3' }] }, all, undefined, { research, copy_offset: null });
        expect(named.machines[0]._prototype_source).toBe('blueprint');
        expect(named.setpoint).toEqual(current().setpoint);
    });

    it('names in the base only the rows it writes, so a later profile leaves the rows the user kept as they are', () => {
        const form = current();
        form.inserters = [formInserter(1), formInserter(2)];
        const next = applyPaste(form, pasted(), { ...all, inserters: false }, undefined, { research, copy_offset: null });
        expect(next.inserters).toBe(form.inserters);
        expect(next.research!.base).toEqual({ ...research.base, inserters: [] });
        // rows a simplification took out are not named
        const fewer = applyPaste(current(), { ...pasted(), machines: [machine(2)] }, all, undefined, { research, copy_offset: null });
        expect(fewer.research!.base.machines).toEqual([{ id: 2, recipe: '', productivity: 0 }]);
    });

    it('writes no block where it writes none of the rows research gives a value', () => {
        const form = { ...current(), research };
        const next = applyPaste(form, pasted(), { ...none, target: true }, { item: 'iron-gear-wheel', items_per_second: 2, copies: 1 }, { research: { ...research, profile: 'Other' }, copy_offset: null });
        expect(next.research).toBe(research);
    });

    it('writes no block for a paste of the Sidecar mod', () => {
        expect(applyPaste(current(), pasted(), all)).not.toHaveProperty('research');
    });

    it('takes the block off a build made from a blueprint when the paste of the Sidecar mod replaces its rows', () => {
        const form = { ...current(), research };
        expect(applyPaste(form, pasted(), all)).not.toHaveProperty('research');
        expect(applyPaste(form, pasted(), { ...none, inserters: true })).not.toHaveProperty('research');
        // a paste that replaces none of the rows leaves the rows, and the block that describes them
        expect(applyPaste(form, pasted(), { ...none, target: true }, { item: 'iron-gear-wheel', items_per_second: 2, copies: 1 }).research).toBe(research);
        expect(applyPaste(form, empty(), all).research).toBe(research);
    });

    it('leaves no step between copies of the build it replaces when the blueprint has one copy', () => {
        const form = current();
        form.setpoint = { item: 'iron-gear-wheel', items_per_second: 2, copies: 3, copy_offset: { x: 0, y: 7 } };
        // the setpoint is kept (not selected), and the blueprint gives no step
        const single = applyPaste(form, pasted(), { ...all, target: false }, undefined, { research, copy_offset: null });
        expect(single.setpoint).toEqual({ item: 'iron-gear-wheel', items_per_second: 2, copies: 3 });
        expect(form.setpoint.copy_offset).toEqual({ x: 0, y: 7 });
        // a blueprint with a step gives its own
        const several = applyPaste(form, pasted(), { ...all, target: false }, undefined, { research, copy_offset: { x: 4, y: 0 } });
        expect(several.setpoint.copy_offset).toEqual({ x: 4, y: 0 });
        // the paste of the Sidecar mod keeps the setpoint as it is
        expect(applyPaste(form, pasted(), { ...all, target: false }).setpoint).toBe(form.setpoint);
    });
});
