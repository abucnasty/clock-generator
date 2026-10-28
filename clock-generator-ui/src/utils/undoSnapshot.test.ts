import { describe, expect, it } from 'vitest';
import type { Config, InserterCoverageIssue, SerializableTransferPlan } from 'clock-generator/browser';
import { ChestType, Option } from 'clock-generator/light';
import { readSavedConfig, serializeConfig } from '../hooks/usePersistedConfigForm';
import { build, inserter } from '../test/fixtures';
import { selectionLabel } from './bulkEdit';
import { configToFormData, formDataToConfig } from './configForm/configMapping';
import * as edits from './configForm/edits';
import { createDefaultConfig, type ConfigFormData, type EntityKind } from './configForm/formData';
import { applyInserterFix } from './configForm/inserterFix';
import { applyPaste } from './pastePreview';
import {
    countOf, createUndoEntry, describeBulkEdit, describeChestSwitch, describePaste, describeRemoval, describeReorder, exampleUndoMessage,
    removalMessage, removedDeleteLabel, reorderMessage, settleUndoEntry, undoMessageInput, undoOutcome, UNDO_IMPORT_MESSAGE, UNDO_KEY_HINT,
    UNDO_RESET_MESSAGE, type UndoEntry,
} from './undoSnapshot';

/** Three machines, a belt, two chests, two drills, inserters between them, one with a rule and one forced on */
function form(): ConfigFormData {
    let config = createDefaultConfig();
    config = edits.updateTargetOutput(config, 'recipe', 'electronic-circuit');
    config = edits.addMachine(edits.addMachine(config));
    config = edits.updateMachine(config, 0, 'recipe', 'copper-cable');
    config = edits.addBelt(config);
    config = edits.addChest(edits.addChest(config), ChestType.INFINITY_CHEST);
    config = edits.updateChest(config, 0, { storage_size: 4, item_filter: 'copper-plate' });
    config = edits.addDrill(edits.addDrill(config));
    config = edits.updateDrill(config, 0, { productivity: 30 });
    config = edits.updateDrill(config, 1, { target: { type: 'machine', id: 3 } });
    return {
        ...config,
        inserters: [
            inserter(1, { source: { type: 'belt', id: 1, near_lane: 1 }, sink: { type: 'machine', id: 3 }, stack_size: 16,
                overrides: { enable_control: { mode: 'CLOCKED', ranges: [{ start: 0, end: 10 }], period_duration_ticks: 60 } } }),
            inserter(2, { source: { type: 'machine', id: 3 }, sink: { type: 'chest', id: 2 }, stack_size: 16 }),
            inserter(3, { source: { type: 'machine', id: 1 }, sink: { type: 'machine', id: 2 }, stack_size: 16, overrides: { enable_control: { mode: 'ALWAYS' } }, _forced_always: true }),
        ],
    };
}

type Edit = (config: ConfigFormData) => ConfigFormData;

/** What the page does: an entry made just before the action, then settled with the form the action made */
function act(before: ConfigFormData, action: Edit) {
    const after = action(before);
    const entry = settleUndoEntry(createUndoEntry(1, 'x', before, true), after);
    return { after, entry: entry! };
}

const withoutUuids = (config: ConfigFormData) => JSON.parse(serializeConfig(config));

/** Freezes the object and everything in it */
function deepFreeze<T>(value: T): T {
    if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        Object.values(value).forEach(deepFreeze);
    }
    return value;
}

describe('Undo', () => {
    /** A gear wheel build, as a file or a paste brings one */
    const otherConfig = build() as unknown as Config;

    it.each<{ action: string; edit: Edit }>([
        { action: 'deleting Machine 3', edit: (c) => edits.removeMachine(c, 2) },
        { action: 'deleting Inserter 2', edit: (c) => edits.removeInserter(c, 1) },
        { action: 'deleting Belt 1', edit: (c) => edits.removeBelt(c, 0) },
        { action: 'deleting Chest 2', edit: (c) => edits.removeChest(c, 1) },
        { action: 'deleting Drill 1', edit: (c) => edits.removeDrill(c, 0) },
        { action: 'Reset', edit: () => createDefaultConfig() },
        { action: 'Import', edit: () => configToFormData(otherConfig) },
    ])('puts back the form from before $action, unchanged, with no notice after it: the clocks come back with the build', ({ edit }) => {
        const original = form();
        const copy = structuredClone(original);
        const { after, entry } = act(original, edit);
        expect(after).not.toEqual(original);
        const outcome = undoOutcome(entry)!;
        expect(outcome.form).toBe(original);
        expect(outcome).toEqual({ form: copy, next: null });
    });

    it('brings back the inserter ends and the drill that pointed at a deleted machine', () => {
        const original = form();
        const { after, entry } = act(original, (config) => edits.removeMachine(config, 2));
        expect(after.inserters[0].sink.id).toBe(0);
        const restored = undoOutcome(entry)!.form;
        expect(restored.inserters[0].sink).toEqual({ type: 'machine', id: 3 });
        expect(restored.inserters[1].source).toEqual({ type: 'machine', id: 3 });
        expect(restored.drills!.configs[1].target).toEqual({ type: 'machine', id: 3 });
    });

    it('puts back the form from before an atomic paste, including retained categories', () => {
        const original = form();
        const incoming = { ...otherConfig, chests: [], drills: [], guidance: Option.none(), suggested_target: Option.none() };
        const selections = { target: true, machines: true, drills: true, inserters: true, belts: true, chests: true };
        const { after, entry } = act(original, config => applyPaste(config, incoming, selections, otherConfig.target_output));
        expect(after.target_output).toEqual(otherConfig.target_output);
        expect(after.machines[0].recipe).toBe('iron-gear-wheel');
        expect(after.inserters).toBe(original.inserters);
        expect(after.drills).toBe(original.drills);
        expect(undoOutcome(entry)!.form).toBe(original);
    });

    it('brings back a switched chest\'s old type, storage size and filter', () => {
        const original = form();
        const { after, entry } = act(original, (config) => edits.switchChestType(config, 0, ChestType.INFINITY_CHEST));
        expect(after.chests[0].type).toBe(ChestType.INFINITY_CHEST);
        expect(undoOutcome(entry)!.form.chests[0]).toEqual({
            type: ChestType.BUFFER_CHEST, id: 1, _uuid: original.chests[0]._uuid, storage_size: 4, item_filter: 'copper-plate',
        });
    });

    it('puts back a form that saves as the one from before did, and reloads with its rows, rules and forced flag', () => {
        const original = form();
        const { entry } = act(original, (config) => edits.removeInserter(config, 0));
        const restored = undoOutcome(entry)!.form;
        expect(serializeConfig(restored)).toBe(serializeConfig(original));
        const reloaded = readSavedConfig(serializeConfig(restored))!;
        expect(withoutUuids(reloaded)).toEqual(withoutUuids(original));
        expect(reloaded.inserters[0].overrides?.enable_control).toEqual(original.inserters[0].overrides?.enable_control);
        expect(reloaded.inserters[2]._forced_always).toBe(true);
    });

    it('restores the exact serialized bulk snapshot, including omitted stack and forced rules', () => {
        const before = form();
        delete before.inserters[0].stack_size;
        before.inserters[0].prototype = 'fast-inserter';
        before.inserters[0].quality = 'epic';
        const serialized = JSON.stringify(before);
        const { entry } = act(before, config => edits.updateInserters(config, before.inserters.map(row => row._uuid), { stack_size: 12, filters: ['iron-plate'], overrides: { enable_control: { mode: 'NEVER' } } }));
        expect(JSON.stringify(undoOutcome(entry)!.form)).toBe(serialized);
    });

    it('undoes a second action on its own, leaving the first one done', () => {
        const first = edits.removeInserter(form(), 0);
        const restored = undoOutcome(act(first, (config) => edits.removeInserter(config, 0)).entry)!.form;
        expect(restored).toBe(first);
        expect(restored.inserters).toHaveLength(2);
    });

    it('keeps the form object itself as the snapshot, since no edit ever changes it', () => {
        const original = deepFreeze(form());
        const text = JSON.stringify(original);
        const plan = { computed_lcm: 1, entities: [] } as unknown as SerializableTransferPlan;
        const issue: InserterCoverageIssue = { kind: 'missing_input_inserter', machine_id: 2, recipe: 'electronic-circuit', item_name: 'copper-cable', fix_options: [] };
        const all: ((config: ConfigFormData) => unknown)[] = [
            (c) => edits.updateTargetOutput(c, 'items_per_second', 3),
            (c) => edits.addMachine(c), (c) => edits.updateMachine(c, 0, 'productivity', 10), (c) => edits.removeMachine(c, 0),
            (c) => edits.reorderMachines(c, 0, 2),
            (c) => edits.addInserter(c), (c) => edits.updateInserter(c, 0, { stack_size: 4 }), (c) => edits.removeInserter(c, 0),
            (c) => edits.reorderInserters(c, 0, 2),
            (c) => edits.addBelt(c), (c) => edits.updateBelt(c, 0, { type: 'fast-transport-belt' }), (c) => edits.removeBelt(c, 0),
            (c) => edits.reorderBelts(c, 0, 0),
            (c) => edits.addChest(c), (c) => edits.updateChest(c, 0, { storage_size: 2 }), (c) => edits.removeChest(c, 0),
            (c) => edits.reorderChests(c, 0, 1),
            (c) => edits.switchChestType(c, 0, ChestType.INFINITY_CHEST), (c) => edits.switchChestType(c, 1, ChestType.BUFFER_CHEST),
            (c) => edits.updateDrill(c, 1, { productivity: 10 }),
            (c) => edits.addDrill(c), (c) => edits.updateDrill(c, 0, { speed_bonus: 1 }), (c) => edits.removeDrill(c, 0),
            (c) => edits.reorderDrills(c, 0, 1),
            (c) => edits.updateOverrides(c, 'lcm', 60), (c) => edits.updateIgnoredIngredients(c, ['iron-plate'], plan),
            (c) => applyInserterFix(c, issue, { type: 'machine_to_machine', source_machine_id: 1, item_name: 'copper-cable' }),
            (c) => formDataToConfig(c),
        ];
        all.forEach((edit) => expect(() => edit(original)).not.toThrow());
        expect(JSON.stringify(original)).toBe(text);
    });

    it('has nothing to put back for an entry without Undo', () => {
        const entry = createUndoEntry(1, 'x', form(), false);
        expect(entry.snapshot).toBeNull();
        expect(undoOutcome(entry)).toBeNull();
    });
});

describe('settleUndoEntry', () => {
    // entries made before an action, with and without Undo, and each settled with the form its action made
    const unsettled = createUndoEntry(1, 'x', form(), true);
    const settled = settleUndoEntry(unsettled, edits.removeInserter(unsettled.before, 0))!;
    const unsettledWithoutUndo = createUndoEntry(1, 'x', form(), false);
    const settledWithoutUndo = settleUndoEntry(unsettledWithoutUndo, createDefaultConfig())!;

    it.each<{ why: string; entry: UndoEntry | null; now: ConfigFormData; kept: UndoEntry | null }>([
        { why: 'keeps an entry whose action has not shown yet as it is', entry: unsettled, now: unsettled.before, kept: unsettled },
        { why: 'keeps it as it is for an equal copy of the form', entry: unsettled, now: structuredClone(unsettled.before), kept: unsettled },
        { why: 'keeps a settled entry while the form stays equal to what the action made', entry: settled, now: structuredClone(settled.after!), kept: settled },
        { why: 'withdraws it once the form is edited after the action', entry: settled, now: edits.updateTargetOutput(settled.after!, 'items_per_second', 9), kept: null },
        { why: 'keeps no entry as none', entry: null, now: form(), kept: null },
        { why: 'keeps an entry without Undo whose action has not shown yet as it is', entry: unsettledWithoutUndo, now: unsettledWithoutUndo.before, kept: unsettledWithoutUndo },
        { why: 'withdraws an entry without Undo once the form is edited after its action', entry: settledWithoutUndo, now: edits.addMachine(settledWithoutUndo.after!), kept: null },
    ])('$why', ({ entry, now, kept }) => {
        expect(settleUndoEntry(entry, now)).toBe(kept);
    });

    it.each([{ why: 'with Undo', entry: unsettled }, { why: 'without Undo', entry: unsettledWithoutUndo }])('learns the form the action made, $why', ({ entry }) => {
        const after = edits.removeInserter(entry.before, 0);
        expect(settleUndoEntry(entry, after)).toEqual({ ...entry, after });
    });
});

describe('the messages', () => {
    /** The form with Inserter 1 taking from Machine 3 too, so that two inserters lose the same end */
    const twoFromMachine3 = edits.updateInserter(form(), 0, { source: { type: 'machine', id: 3 }, sink: { type: 'belt', id: 1 } });

    it.each<{ deleting: string; config: ConfigFormData; kind: EntityKind; index: number; message: string | null }>([
        { deleting: 'Machine 1', config: form(), kind: 'machines', index: 0,
            message: 'Deleted Machine 1. Machines 2–3 are now 1–2. Inserter 3 has no Source now. Drill 1 has no Target now.' },
        { deleting: 'Machine 2', config: form(), kind: 'machines', index: 1, message: 'Deleted Machine 2. Machine 3 is now 2. Inserter 3 has no Destination now.' },
        { deleting: 'Machine 3', config: form(), kind: 'machines', index: 2,
            message: 'Deleted Machine 3. Inserter 2 has no Source and Inserter 1 has no Destination now. Drill 2 has no Target now.' },
        { deleting: 'Machine 3, naming the inserters that lost the same end together', config: twoFromMachine3, kind: 'machines', index: 2,
            message: 'Deleted Machine 3. Inserters 1–2 have no Source now. Drill 2 has no Target now.' },
        { deleting: 'Inserter 1', config: form(), kind: 'inserters', index: 0, message: 'Deleted Inserter 1. Inserters 2–3 are now 1–2.' },
        { deleting: 'the last row after the middle of three is deleted, by its stored id', config: edits.removeInserter(form(), 1), kind: 'inserters', index: 1,
            message: 'Deleted Inserter 2.' },
        { deleting: 'Belt 1', config: form(), kind: 'belts', index: 0, message: 'Deleted Belt 1. Inserter 1 has no Source now.' },
        { deleting: 'Chest 2', config: form(), kind: 'chests', index: 1, message: 'Deleted Chest 2. Inserter 2 has no Destination now.' },
        { deleting: 'Drill 1', config: form(), kind: 'drills', index: 0, message: 'Deleted Drill 1. Drill 2 is now 1.' },
        { deleting: 'Drill 2', config: form(), kind: 'drills', index: 1, message: 'Deleted Drill 2.' },
        { deleting: 'a row past the last: nothing', config: form(), kind: 'inserters', index: 3, message: null },
        { deleting: 'row -1: nothing', config: form(), kind: 'machines', index: -1, message: null },
        { deleting: 'a drill of a build without drills: nothing', config: { ...form(), drills: undefined }, kind: 'drills', index: 0, message: null },
    ])('say what deleting $deleting did, by stored ids, in the form\'s words, one sentence per kind', ({ config, kind, index, message }) => {
        expect(removalMessage(config, kind, index)).toBe(message);
    });

    it('say which of the kind were renumbered', () => {
        const before = form();
        const renumbered = (config: ConfigFormData): ConfigFormData =>
            ({ ...config, inserters: config.inserters.filter((_, i) => i !== 0).map((ins, i) => ({ ...ins, id: i + 1 })) });
        expect(describeRemoval(before, renumbered(before), 'inserters', 0)).toBe('Deleted Inserter 1. Inserters 2–3 are now 1–2.');
        const two = renumbered(before);
        expect(describeRemoval(two, renumbered(two), 'inserters', 0)).toBe('Deleted Inserter 1. Inserter 2 is now 1.');
        expect(describeRemoval(before, edits.removeInserter(before, 2), 'inserters', 2)).toBe('Deleted Inserter 3.');
    });

    it('name the delete button that an Undo brings back', () => {
        expect(removedDeleteLabel(form(), 'inserters', 1)).toBe('Delete Inserter 2');
        expect(removedDeleteLabel(form(), 'drills', 0)).toBe('Delete Drill 1');
        expect(removedDeleteLabel(form(), 'chests', 5)).toBeNull();
    });

    it('name a chest switch, and nothing for a switch to the same type', () => {
        expect(describeChestSwitch(form(), 0, ChestType.INFINITY_CHEST)).toBe('Chest 1 changed to Infinity chest.');
        expect(describeChestSwitch(form(), 1, ChestType.BUFFER_CHEST)).toBe('Chest 2 changed to Buffer chest.');
        expect(describeChestSwitch(form(), 0, ChestType.BUFFER_CHEST)).toBeNull();
        expect(describeChestSwitch(form(), 5, ChestType.BUFFER_CHEST)).toBeNull();
    });

    it('describe both move directions and no move', () => {
        const before = edits.addInserter(edits.addInserter(form()));
        expect(reorderMessage(before, 'inserters', 4, 1)).toBe('Moved Inserter 5 to 2. Inserters 2–4 are now 3–5.');
        expect(reorderMessage(before, 'inserters', 2, 1)).toBe('Moved Inserter 3 to 2. Inserter 2 is now 3.');
        expect(reorderMessage(before, 'inserters', 0, 2)).toBe('Moved Inserter 1 to 3. Inserters 2–3 are now 1–2.');
        expect(reorderMessage(before, 'machines', 1, 0)).toBe('Moved Machine 2 to 1. Machine 1 is now 2.');
        expect(describeReorder(before, before, 'inserters', 0, 0)).toBeNull();
    });

    it.each([{ ids: [4] }, { ids: [2, 5, 6, 7] }])('name the selected rows in each bulk action ($ids)', ({ ids }) => {
        const rows = selectionLabel(ids);
        expect(describeBulkEdit('stack', ids, 12)).toBe(`Set Stack size to 12 on ${rows}.`);
        expect(describeBulkEdit('stack', ids)).toBe(`Set Stack size to Automatic on ${rows}.`);
        expect(describeBulkEdit('filters', ids)).toBe(`Set the filters of ${rows}.`);
        expect(describeBulkEdit('auto-filters', ids)).toBe(`${rows} now use automatic filters.`);
        expect(describeBulkEdit('rule', ids, 'Clocked 0–7')).toBe(`Set the enable rule of ${rows} to Clocked 0–7.`);
    });

    it('list what a paste imported, one or many of each', () => {
        expect(describePaste(['3 machines', '2 inserters'])).toBe('Imported 3 machines, 2 inserters from Factorio.');
        expect(describePaste([countOf(1, 'machine', 'machines'), countOf(1, 'belt', 'belts'), countOf(2, 'drill', 'drills')]))
            .toBe('Imported 1 machine, 1 belt, 2 drills from Factorio.');
        expect(describePaste(['Target Output', '1 machine'])).toBe('Imported Target Output, 1 machine from Factorio.');
    });

    it('name a build file, a reset and an example in the words of the menu', () => {
        expect(UNDO_IMPORT_MESSAGE).toBe('Build file opened.');
        expect(UNDO_RESET_MESSAGE).toBe('Build reset.');
        expect(exampleUndoMessage({ recipe: 'logistic-science-pack' }, (id) => id)).toBe('Example loaded: Logistic science pack.');
    });
});

describe('undoMessageInput', () => {
    const extras = { hint: UNDO_KEY_HINT.other, onUndo: () => {}, onClose: () => {}, returnFocus: () => null };

    it.each([
        { why: 'has no timer while it offers Undo: it stays until an edit, another action, Close or Escape', canUndo: true,
            durationMs: null, hint: extras.hint, action: { label: 'Undo', onClick: extras.onUndo, keyShortcuts: 'Control+Z Meta+Z' } },
        { why: 'is a notice for 8 seconds, without Undo or its key, when it does not offer Undo', canUndo: false, durationMs: 8000, hint: undefined, action: undefined },
    ])('$why', ({ canUndo, durationMs, hint, action }) => {
        const input = undoMessageInput(createUndoEntry(1, UNDO_RESET_MESSAGE, form(), canUndo), extras);
        expect(input).toMatchObject({ severity: 'info', text: UNDO_RESET_MESSAGE, onClose: extras.onClose, returnFocus: extras.returnFocus });
        expect(input.durationMs).toBe(durationMs);
        expect(input.hint).toBe(hint);
        expect(input.action).toEqual(action);
    });
});
