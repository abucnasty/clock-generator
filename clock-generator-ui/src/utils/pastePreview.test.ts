import { describe, expect, it } from 'vitest';
import { Option } from 'clock-generator/light';
import type { PastedEntities } from '../worker/types';
import { createDefaultConfig, type ConfigFormData, type InserterFormData } from './configForm/formData';
import { pastePreview, type ImportSelections } from './pastePreview';

const none: ImportSelections = { target: false, machines: false, drills: false, inserters: false, belts: false, chests: false };
const empty = (): PastedEntities => ({ machines: [], drills: [], inserters: [], belts: [], chests: [], guidance: Option.none(), suggested_target: Option.none() });
const current = (): ConfigFormData => ({ ...createDefaultConfig(), machines: [], inserters: [], chests: [], belts: [] });
const machine = (id: number) => ({ id, recipe: '', productivity: 0, crafting_speed: 1 });
const inserter = (id: number, type: 'machine' | 'belt' | 'chest', source = 1, sink = 1) => ({ id, source: { type, id: source }, sink: { type, id: sink } });
const drill = (id: number, target = 1) => ({ id, type: 'electric-mining-drill' as const, mined_item_name: 'iron-ore', speed_bonus: 0, target: { type: 'machine' as const, id: target } });
const formInserter = (id: number, type: 'machine' | 'belt' | 'chest', source = 1, sink = 1): InserterFormData => ({ ...inserter(id, type, source, sink), _uuid: `inserter-${id}` });

describe('selective Paste preview', () => {
    it('refuses to reuse imported drop geometry across a category replacement while allowing a complete related import', () => {
        const form = current(), incoming = empty();
        form.inserters = [{ ...formInserter(3, 'machine'), sink: { type: 'belt', id: 1, drop: { lane: 1, position: 0.5 } } }];
        incoming.belts = [{ id: 1, type: 'fast-transport-belt', lanes: [{ ingredient: 'iron-plate', stack_size: 4 }] }];
        expect(pastePreview(form, incoming, { ...none, belts: true }).geometryProblem).toContain('Inserter 3');
        expect(pastePreview(form, incoming, none).geometryProblem).toBeNull();
        incoming.inserters = [{ id: 3, source: { type: 'machine', id: 1 }, sink: { type: 'belt', id: 1, drop: { lane: 1, position: 0.75 } } }];
        incoming.machines = [machine(1)];
        expect(pastePreview(form, incoming, { ...none, machines: true, inserters: true, belts: true }).geometryProblem).toBeNull();
    });
    it('counts the incomplete raw destination and actual result independently of exportability', () => {
        const form = current(), incoming = empty();
        form.machines = [1, 2, 3, 4].map(id => ({ ...machine(id), _uuid: `${id}` })); incoming.machines = [machine(1), machine(2)];
        const result = pastePreview(form, incoming, { ...none, machines: true });
        expect(result.counts.map(row => row.category)).toEqual(['machines', 'drills', 'inserters', 'belts', 'chests']);
        expect(result.counts[0]).toEqual({ category: 'machines', current: 4, incoming: 2, result: 2, replacing: true });
        expect(form.target_output.recipe).toBe('');
        expect(pastePreview(form, incoming, none).counts[0]).toMatchObject({ current: 4, incoming: 2, result: 4, replacing: false });
    });
    it('retains current entities for selected empty categories and absent raw drills', () => {
        const form = current(); form.inserters = [formInserter(1, 'machine')];
        const preview = pastePreview(form, empty(), { target: true, machines: true, drills: true, inserters: true, belts: true, chests: true });
        expect(preview.counts.find(row => row.category === 'inserters')).toMatchObject({ replacing: false, result: 1 });
        expect(preview.counts.find(row => row.category === 'drills')).toMatchObject({ current: 0, result: 0 });
        expect(preview.crossings).toEqual([]);
    });
    it.each(['machine', 'belt', 'chest'] as const)('warns for both imported %s endpoints pointing to retained categories, including matching IDs', type => {
        const form = current(), incoming = empty();
        if (type === 'machine') form.machines = [{ ...machine(1), _uuid: 'm' }];
        if (type === 'belt') form.belts = [{ id: 1, _uuid: 'b', type: 'turbo-transport-belt', lanes: [{ ingredient: 'iron-plate', stack_size: 4 }] }];
        if (type === 'chest') form.chests = [{ id: 1, _uuid: 'c', type: 'buffer-chest', storage_size: 48, item_filter: 'iron-plate' }];
        incoming.inserters = [inserter(2, type, 1, 99)];
        expect(pastePreview(form, incoming, { ...none, inserters: true }).crossings).toEqual([
            { ownerType: 'inserter', ownerId: 2, slot: 'source', endpointType: type, endpointId: 1, direction: 'incoming-to-retained', destinationExists: true },
            { ownerType: 'inserter', ownerId: 2, slot: 'sink', endpointType: type, endpointId: 99, direction: 'incoming-to-retained', destinationExists: false },
        ]);
    });
    it.each(['machine', 'belt', 'chest'] as const)('warns when retained inserters point to replaced %s endpoints', type => {
        const form = current(), incoming = empty(); form.inserters = [formInserter(1, type, 1, 99)];
        if (type === 'machine') incoming.machines = [machine(1)];
        if (type === 'belt') incoming.belts = [{ id: 1, type: 'turbo-transport-belt', lanes: [{ ingredient: 'iron-plate', stack_size: 4 }] }];
        if (type === 'chest') incoming.chests = [{ id: 1, type: 'buffer-chest', storage_size: 48, item_filter: 'iron-plate' }];
        const category = type === 'machine' ? 'machines' : type === 'belt' ? 'belts' : 'chests';
        const warnings = pastePreview(form, incoming, { ...none, [category]: true }).crossings;
        expect(warnings.map(warning => warning.direction)).toEqual(['retained-to-replaced', 'retained-to-replaced']);
        expect(warnings.map(warning => warning.destinationExists)).toEqual([true, false]);
    });
    it('covers drill targets in each direction, ignoring unchosen id zero', () => {
        const form = current(), incoming = empty(); incoming.drills = [drill(2), drill(1, 0)];
        expect(pastePreview(form, incoming, { ...none, drills: true }).crossings).toEqual([
            { ownerType: 'drill', ownerId: 2, slot: 'target', endpointType: 'machine', endpointId: 1, direction: 'incoming-to-retained', destinationExists: false },
        ]);
        form.drills = { mining_productivity_level: 12, configs: [{ ...drill(1), _uuid: 'd' }] }; incoming.machines = [machine(1)];
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
