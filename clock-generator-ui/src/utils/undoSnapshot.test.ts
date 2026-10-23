import { describe, expect, it } from 'vitest';
import type { Config, InserterCoverageIssue, SerializableTransferPlan } from 'clock-generator/browser';
import { ChestType, Option } from 'clock-generator/light';
import { readSavedConfig, serializeConfig } from '../hooks/usePersistedConfigForm';
import { configToFormData, formDataToConfig } from './configForm/configMapping';
import * as edits from './configForm/edits';
import { createDefaultConfig, type ConfigFormData, type EntityKind, type InserterFormData } from './configForm/formData';
import { applyInserterFix } from './configForm/inserterFix';
import { applyPaste } from './pastePreview';
import {
    createUndoEntry,
    describeChestSwitch,
    describePaste,
    describeRemoval,
    describeReorder,
    describeBulkEdit,
    reorderMessage,
    countOf,
    exampleUndoMessage,
    removalMessage,
    removedDeleteLabel,
    settleUndoEntry,
    undoMessageInput,
    undoOutcome,
    UNDO_IMPORT_MESSAGE,
    UNDO_RESET_MESSAGE,
} from './undoSnapshot';

const inserter = (id: number, source: InserterFormData['source'], sink: InserterFormData['sink']): InserterFormData =>
    ({ id, _uuid: `inserter-${id}`, source, sink, stack_size: 16 });

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
            { ...inserter(1, { type: 'belt', id: 1, near_lane: 1 }, { type: 'machine', id: 3 }), overrides: { enable_control: { mode: 'CLOCKED', ranges: [{ start: 0, end: 10 }], period_duration_ticks: 60 } } },
            inserter(2, { type: 'machine', id: 3 }, { type: 'chest', id: 2 }),
            { ...inserter(3, { type: 'machine', id: 1 }, { type: 'machine', id: 2 }), overrides: { enable_control: { mode: 'ALWAYS' } }, _forced_always: true },
        ],
    };
}

/** What the page does: an entry made just before the action, then settled with the form the action made */
function act(before: ConfigFormData, action: (form: ConfigFormData) => ConfigFormData) {
    const after = action(before);
    const entry = settleUndoEntry(createUndoEntry(1, 'x', before, true), after);
    return { after, entry: entry! };
}

const withoutUuids = (config: ConfigFormData) => JSON.parse(serializeConfig(config));

const REMOVE: Record<EntityKind, (form: ConfigFormData, index: number) => ConfigFormData> = {
    machines: edits.removeMachine,
    inserters: edits.removeInserter,
    belts: edits.removeBelt,
    chests: edits.removeChest,
    drills: edits.removeDrill,
};

describe('Undo after a delete', () => {
    it.each<[EntityKind, number]>([
        ['machines', 2],
        ['inserters', 1],
        ['belts', 0],
        ['chests', 1],
        ['drills', 0],
    ])('puts back the form from before deleting from %s', (kind, index) => {
        const original = form();
        const copy = structuredClone(original);
        const { after, entry } = act(original, (config) => REMOVE[kind](config, index));
        expect(after).not.toEqual(original);
        const outcome = undoOutcome(entry)!;
        expect(outcome.form).toBe(original);
        expect(outcome.form).toEqual(copy);
        expect(outcome.next).toBeNull();
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
});

describe('Undo after Reset, Import and Paste', () => {
    const otherConfig = {
        target_output: { recipe: 'iron-gear-wheel', items_per_second: 2, copies: 1 },
        machines: [{ id: 1, recipe: 'iron-gear-wheel', productivity: 0, crafting_speed: 1 }],
        inserters: [],
        belts: [],
        chests: [],
    } as unknown as Config;

    it.each<[string, (config: ConfigFormData) => ConfigFormData]>([
        ['Reset', () => createDefaultConfig()],
        ['Import', () => configToFormData(otherConfig)],
    ])('puts back the form from before %s', (_, action) => {
        const original = form();
        const { entry } = act(original, action);
        expect(undoOutcome(entry)!.form).toBe(original);
    });

    it('puts back the form from before an atomic paste, including retained categories', () => {
        const original = form();
        const incoming = { ...otherConfig, chests: otherConfig.chests ?? [], drills: [], guidance: Option.none(), suggested_target: Option.none() };
        const selections = { target: true, machines: true, drills: true, inserters: true, belts: true, chests: true };
        const { after, entry } = act(original, config => applyPaste(config, incoming, selections, otherConfig.target_output));
        expect(after.target_output).toEqual(otherConfig.target_output);
        expect(after.machines[0].recipe).toBe('iron-gear-wheel');
        expect(after.inserters).toBe(original.inserters);
        expect(after.drills).toBe(original.drills);
        expect(undoOutcome(entry)!.form).toBe(original);
    });
});

describe('Undo after a chest switch', () => {
    it('brings back the chest\'s old type, storage size and filter', () => {
        const original = form();
        const { after, entry } = act(original, (config) => edits.switchChestType(config, 0, ChestType.INFINITY_CHEST));
        expect(after.chests[0].type).toBe(ChestType.INFINITY_CHEST);
        expect(undoOutcome(entry)!.form.chests[0]).toEqual({
            type: ChestType.BUFFER_CHEST, id: 1, _uuid: original.chests[0]._uuid, storage_size: 4, item_filter: 'copper-plate',
        });
    });
});

describe('the form put back', () => {
    it('saves as the form from before did, and reloads with its rows, rules and forced flag', () => {
        const original = form();
        const { entry } = act(original, (config) => edits.removeInserter(config, 0));
        const restored = undoOutcome(entry)!.form;
        expect(serializeConfig(restored)).toBe(serializeConfig(original));
        const reloaded = readSavedConfig(serializeConfig(restored))!;
        expect(withoutUuids(reloaded)).toEqual(withoutUuids(original));
        expect(reloaded.inserters[0].overrides?.enable_control).toEqual(original.inserters[0].overrides?.enable_control);
        expect(reloaded.inserters[2]._forced_always).toBe(true);
    });
});

describe('a second action', () => {
    it('is undone on its own, leaving the first one done', () => {
        const original = form();
        const first = edits.removeInserter(original, 0);
        const { entry } = act(first, (config) => edits.removeInserter(config, 0));
        const restored = undoOutcome(entry)!.form;
        expect(restored).toBe(first);
        expect(restored.inserters).toHaveLength(2);
    });
});

/** Freezes the object and everything in it */
function deepFreeze<T>(value: T): T {
    if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        Object.values(value).forEach(deepFreeze);
    }
    return value;
}

describe('the snapshot', () => {
    it('is never changed by an edit, so it is kept as the form object itself', () => {
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
});

describe('settleUndoEntry', () => {
    const entry = (canUndo = true) => createUndoEntry(1, 'x', form(), canUndo);

    it('keeps an entry whose action has not shown yet as it is', () => {
        const unsettled = entry();
        expect(settleUndoEntry(unsettled, unsettled.before)).toBe(unsettled);
        expect(settleUndoEntry(unsettled, structuredClone(unsettled.before))).toBe(unsettled);
    });

    it('learns the form the action made', () => {
        const unsettled = entry();
        const after = edits.removeInserter(unsettled.before, 0);
        expect(settleUndoEntry(unsettled, after)).toEqual({ ...unsettled, after });
    });

    it('keeps a settled entry while the form stays equal to what the action made', () => {
        const settled = settleUndoEntry(entry(), edits.removeInserter(form(), 0))!;
        expect(settleUndoEntry(settled, structuredClone(settled.after!))).toBe(settled);
    });

    it('withdraws it once the form is edited after the action', () => {
        const settled = settleUndoEntry(entry(), edits.removeInserter(form(), 0))!;
        expect(settleUndoEntry(settled, edits.updateTargetOutput(settled.after!, 'items_per_second', 9))).toBeNull();
    });

    it('keeps no entry as none', () => {
        expect(settleUndoEntry(null, form())).toBeNull();
    });

    it('settles and withdraws an entry without Undo in the same way', () => {
        const unsettled = entry(false);
        expect(unsettled.snapshot).toBeNull();
        expect(settleUndoEntry(unsettled, unsettled.before)).toBe(unsettled);
        const settled = settleUndoEntry(unsettled, createDefaultConfig())!;
        expect(settled.after).toBeDefined();
        expect(settleUndoEntry(settled, edits.addMachine(settled.after!))).toBeNull();
    });
});

describe('undoOutcome', () => {
    it('is null for an entry without Undo', () => {
        expect(undoOutcome(createUndoEntry(1, 'x', form(), false))).toBeNull();
    });

    it('puts the form back with no notice after it: the clocks come back with the build', () => {
        const original = form();
        const { entry } = act(original, () => createDefaultConfig());
        expect(undoOutcome(entry)).toEqual({ form: original, next: null });
    });
});

describe('the messages', () => {
    it.each<[EntityKind, number, string]>([
        ['machines', 1, 'Machine'],
        ['inserters', 2, 'Inserter'],
        ['belts', 0, 'Belt'],
        ['chests', 1, 'Chest'],
        ['drills', 1, 'Drill'],
    ])('name the deleted entity of %s by its stored id', (kind, index, name) => {
        const before = form();
        const items: { id: number }[] = kind === 'drills' ? before.drills!.configs : before[kind];
        expect(removalMessage(before, kind, index)).toMatch(new RegExp(`^Deleted ${name} ${items[index].id}\\.`));
    });

    it('name the last row by its stored id after the middle of three is deleted', () => {
        const after = edits.removeInserter(form(), 1);
        expect(removalMessage(after, 'inserters', 1)).toMatch(new RegExp(`^Deleted Inserter ${after.inserters[1].id}\\.`));
    });

    it('are null when there is nothing to delete', () => {
        expect(removalMessage(form(), 'inserters', 3)).toBeNull();
        expect(removalMessage(form(), 'machines', -1)).toBeNull();
        expect(removalMessage({ ...form(), drills: undefined }, 'drills', 0)).toBeNull();
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

    it('say what the delete itself renumbered and unlinked', () => {
        expect(removalMessage(form(), 'inserters', 0)).toBe('Deleted Inserter 1. Inserters 2–3 are now 1–2.');
        expect(removalMessage(form(), 'belts', 0)).toBe('Deleted Belt 1. Inserter 1 has no Source now.');
        expect(removalMessage(form(), 'machines', 0))
            .toBe('Deleted Machine 1. Machines 2–3 are now 1–2. Inserter 3 has no Source now. Drill 1 has no Target now.');
        expect(removalMessage(form(), 'drills', 0)).toBe('Deleted Drill 1. Drill 2 is now 1.');
    });

    it('say which links were cleared, in the form\'s words, one sentence per kind', () => {
        expect(removalMessage(form(), 'machines', 2))
            .toBe('Deleted Machine 3. Inserter 2 has no Source and Inserter 1 has no Destination now. Drill 2 has no Target now.');
        expect(removalMessage(form(), 'chests', 1)).toBe('Deleted Chest 2. Inserter 2 has no Destination now.');
        const twoFromMachine3 = edits.updateInserter(form(), 0, { source: { type: 'machine', id: 3 }, sink: { type: 'belt', id: 1 } });
        expect(removalMessage(twoFromMachine3, 'machines', 2))
            .toBe('Deleted Machine 3. Inserters 1–2 have no Source now. Drill 2 has no Target now.');
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
    const extras = { hint: 'Or press Ctrl+Z to undo.', onUndo: () => {}, onClose: () => {}, returnFocus: () => null };

    it('has no timer while it offers Undo: it stays until an edit, another action, Close or Escape', () => {
        const input = undoMessageInput(createUndoEntry(1, 'Build reset.', form(), true), extras);
        expect(input.durationMs).toBeNull();
        expect(input).toMatchObject({ severity: 'info', text: 'Build reset.', hint: extras.hint });
        expect(input.action).toMatchObject({ label: 'Undo', onClick: extras.onUndo, keyShortcuts: 'Control+Z Meta+Z' });
        expect(input.onClose).toBe(extras.onClose);
        expect(input.returnFocus).toBe(extras.returnFocus);
    });

    it('is a notice for 8 seconds, without Undo or its key, when it does not offer Undo', () => {
        const input = undoMessageInput(createUndoEntry(1, 'Build reset.', form(), false), extras);
        expect(input.durationMs).toBe(8000);
        expect(input.action).toBeUndefined();
        expect(input.hint).toBeUndefined();
    });
});

describe('reorder and bulk messages', () => {
    it('describes both move directions and no move', () => {
        let before = form();
        before = edits.addInserter(edits.addInserter(before));
        expect(reorderMessage(before, 'inserters', 4, 1)).toBe('Moved Inserter 5 to 2. Inserters 2–4 are now 3–5.');
        expect(reorderMessage(before, 'inserters', 2, 1)).toBe('Moved Inserter 3 to 2. Inserter 2 is now 3.');
        expect(reorderMessage(before, 'inserters', 0, 2)).toBe('Moved Inserter 1 to 3. Inserters 2–3 are now 1–2.');
        expect(reorderMessage(before, 'machines', 1, 0)).toBe('Moved Machine 2 to 1. Machine 1 is now 2.');
        expect(describeReorder(before, before, 'inserters', 0, 0)).toBeNull();
    });
    it.each([{ ids: [4] }, { ids: [2, 5, 6, 7] }])('names the selected rows in each bulk action ($ids)', ({ ids }) => {
        const rows = ids.length === 1 ? 'Inserter 4' : 'Inserters 2, 5–7';
        expect(describeBulkEdit('stack', ids, 12)).toBe(`Set Stack size to 12 on ${rows}.`);
        expect(describeBulkEdit('stack', ids)).toBe(`Set Stack size to Automatic on ${rows}.`);
        expect(describeBulkEdit('filters', ids)).toBe(`Set the filters of ${rows}.`);
        expect(describeBulkEdit('auto-filters', ids)).toBe(`${rows} now use automatic filters.`);
        expect(describeBulkEdit('rule', ids, 'Clocked 0–7')).toBe(`Set the enable rule of ${rows} to Clocked 0–7.`);
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
});
