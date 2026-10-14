import { describe, expect, it } from 'vitest';
import type { Config, InserterCoverageIssue, SerializableTransferPlan } from 'clock-generator/browser';
import { ChestType } from 'clock-generator/light';
import { readSavedConfig, serializeConfig } from '../hooks/usePersistedConfigForm';
import { configToFormData, formDataToConfig } from './configForm/configMapping';
import * as edits from './configForm/edits';
import { createDefaultConfig, type ConfigFormData, type EntityKind, type InserterFormData } from './configForm/formData';
import { applyInserterFix } from './configForm/inserterFix';
import {
    createUndoEntry,
    describeChestSwitch,
    describeDrillsOff,
    describePaste,
    describeRemoval,
    countOf,
    removalMessage,
    removedDeleteLabel,
    settleUndoEntry,
    undoMessageInput,
    undoOutcome,
    UNDO_RESULTS_NOTE,
    type UndoEntry,
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
    config = edits.updateDrillsConfig(config, 'mining_productivity_level', 3);
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
function act(before: ConfigFormData, action: (form: ConfigFormData) => ConfigFormData, resultsCleared = false) {
    const after = action(before);
    const entry = settleUndoEntry(createUndoEntry(1, 'x', before, true, resultsCleared), after);
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
        const outcome = undoOutcome(entry, 2)!;
        expect(outcome.form).toBe(original);
        expect(outcome.form).toEqual(copy);
        expect(outcome.next).toBeNull();
    });

    it('brings back the inserter ends and the drill that pointed at a deleted machine', () => {
        const original = form();
        const { after, entry } = act(original, (config) => edits.removeMachine(config, 2));
        expect(after.inserters[0].sink.id).toBe(0);
        const restored = undoOutcome(entry, 2)!.form;
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
        const { entry } = act(original, action, true);
        expect(undoOutcome(entry, 2)!.form).toBe(original);
    });

    it('puts back the form from before every part of a paste, with one snapshot taken before the first', () => {
        const original = form();
        const pasted = configToFormData(otherConfig);
        const paste = (config: ConfigFormData) => {
            config = edits.replaceMachines(config, pasted.machines);
            config = edits.replaceDrills(config, []);
            config = edits.updateDrillsConfig(config, 'mining_productivity_level', 0);
            config = edits.replaceInserters(config, pasted.inserters);
            config = edits.replaceBelts(config, pasted.belts);
            return edits.replaceChests(config, pasted.chests);
        };
        const { entry } = act(original, paste);
        expect(undoOutcome(entry, 2)!.form).toBe(original);
    });
});

describe('Undo after Drills off and a chest switch', () => {
    it('brings back the drills and the productivity level', () => {
        const original = form();
        const { after, entry } = act(original, edits.disableDrills);
        expect(after.drills).toBeUndefined();
        const restored = undoOutcome(entry, 2)!.form;
        expect(restored.drills?.mining_productivity_level).toBe(3);
        expect(restored.drills?.configs).toHaveLength(2);
    });

    it('brings back the chest\'s old type, storage size and filter', () => {
        const original = form();
        const { after, entry } = act(original, (config) => edits.switchChestType(config, 0, ChestType.INFINITY_CHEST));
        expect(after.chests[0].type).toBe(ChestType.INFINITY_CHEST);
        expect(undoOutcome(entry, 2)!.form.chests[0]).toEqual({
            type: ChestType.BUFFER_CHEST, id: 1, _uuid: original.chests[0]._uuid, storage_size: 4, item_filter: 'copper-plate',
        });
    });
});

describe('the form put back', () => {
    it('saves as the form from before did, and reloads with its rows, rules and forced flag', () => {
        const original = form();
        const { entry } = act(original, (config) => edits.removeInserter(config, 0));
        const restored = undoOutcome(entry, 2)!.form;
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
        const restored = undoOutcome(entry, 2)!.form;
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
            (c) => edits.reorderMachines(c, 0, 2), (c) => edits.replaceMachines(c, []), (c) => edits.mergeMachines(c, []),
            (c) => edits.addInserter(c), (c) => edits.updateInserter(c, 0, { stack_size: 4 }), (c) => edits.removeInserter(c, 0),
            (c) => edits.reorderInserters(c, 0, 2), (c) => edits.replaceInserters(c, []),
            (c) => edits.addBelt(c), (c) => edits.updateBelt(c, 0, { type: 'fast-transport-belt' }), (c) => edits.removeBelt(c, 0),
            (c) => edits.reorderBelts(c, 0, 0), (c) => edits.replaceBelts(c, []),
            (c) => edits.addChest(c), (c) => edits.updateChest(c, 0, { storage_size: 2 }), (c) => edits.removeChest(c, 0),
            (c) => edits.reorderChests(c, 0, 1), (c) => edits.replaceChests(c, []),
            (c) => edits.switchChestType(c, 0, ChestType.INFINITY_CHEST), (c) => edits.switchChestType(c, 1, ChestType.BUFFER_CHEST),
            (c) => edits.enableDrills(c), (c) => edits.disableDrills(c), (c) => edits.updateDrillsConfig(c, 'mining_productivity_level', 1),
            (c) => edits.addDrill(c), (c) => edits.updateDrill(c, 0, { speed_bonus: 1 }), (c) => edits.removeDrill(c, 0),
            (c) => edits.reorderDrills(c, 0, 1), (c) => edits.replaceDrills(c, []), (c) => edits.mergeDrills(c, []),
            (c) => edits.updateOverrides(c, 'lcm', 60), (c) => edits.updateIgnoredIngredients(c, ['iron-plate'], plan),
            (c) => applyInserterFix(c, issue, { type: 'machine_to_machine', source_machine_id: 1, item_name: 'copper-cable' }),
            (c) => formDataToConfig(c),
        ];
        all.forEach((edit) => expect(() => edit(original)).not.toThrow());
        expect(JSON.stringify(original)).toBe(text);
    });
});

describe('settleUndoEntry', () => {
    const entry = (canUndo = true) => createUndoEntry(1, 'x', form(), canUndo, false);

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
        expect(undoOutcome(createUndoEntry(1, 'x', form(), false, true), 2)).toBeNull();
    });

    it('follows an Undo that cannot bring back the cleared clocks with a notice, without Undo, for the form put back', () => {
        const original = form();
        const { entry } = act(original, () => createDefaultConfig(), true);
        const next = undoOutcome(entry, 7)!.next as UndoEntry;
        expect(next).toMatchObject({ id: 7, message: UNDO_RESULTS_NOTE, snapshot: null, resultsCleared: false });
        expect(settleUndoEntry(next, original)).toBe(next);
        expect(settleUndoEntry(next, edits.addMachine(original))).toBeNull();
    });

    it('has no notice when no clocks were cleared', () => {
        const { entry } = act(form(), () => createDefaultConfig(), false);
        expect(undoOutcome(entry, 2)!.next).toBeNull();
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
        expect(removalMessage(edits.disableDrills(form()), 'drills', 0)).toBeNull();
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
            .toBe('Deleted Machine 1. Machines 2–3 are now 1–2. Inserter 3 has no Source now. Drill 1 has no Target Machine now.');
        expect(removalMessage(form(), 'drills', 0)).toBe('Deleted Drill 1. Drill 2 is now 1.');
    });

    it('say which links were cleared, in the form\'s words, one sentence per kind', () => {
        expect(removalMessage(form(), 'machines', 2))
            .toBe('Deleted Machine 3. Inserter 2 has no Source and Inserter 1 has no Destination now. Drill 2 has no Target Machine now.');
        expect(removalMessage(form(), 'chests', 1)).toBe('Deleted Chest 2. Inserter 2 has no Destination now.');
        const twoFromMachine3 = edits.updateInserter(form(), 0, { source: { type: 'machine', id: 3 }, sink: { type: 'belt', id: 1 } });
        expect(removalMessage(twoFromMachine3, 'machines', 2))
            .toBe('Deleted Machine 3. Inserters 1–2 have no Source now. Drill 2 has no Target Machine now.');
    });

    it('name the delete button that an Undo brings back', () => {
        expect(removedDeleteLabel(form(), 'inserters', 1)).toBe('Delete Inserter 2');
        expect(removedDeleteLabel(form(), 'drills', 0)).toBe('Delete Drill 1');
        expect(removedDeleteLabel(form(), 'chests', 5)).toBeNull();
    });

    it('name a chest switch, and nothing for a switch to the same type', () => {
        expect(describeChestSwitch(form(), 0, ChestType.INFINITY_CHEST)).toBe('Chest 1 changed to Infinity Chest.');
        expect(describeChestSwitch(form(), 1, ChestType.BUFFER_CHEST)).toBe('Chest 2 changed to Buffer Chest.');
        expect(describeChestSwitch(form(), 0, ChestType.BUFFER_CHEST)).toBeNull();
        expect(describeChestSwitch(form(), 5, ChestType.BUFFER_CHEST)).toBeNull();
    });

    it('say Drills off only when there are drills', () => {
        expect(describeDrillsOff(form())).toBe('Mining drills turned off.');
        expect(describeDrillsOff(edits.disableDrills(form()))).toBeNull();
    });

    it('list what a paste imported, one or many of each', () => {
        expect(describePaste(['3 machines', '2 inserters'])).toBe('Imported 3 machines, 2 inserters from Factorio.');
        expect(describePaste([countOf(1, 'machine', 'machines'), countOf(1, 'belt', 'belts'), countOf(2, 'drill', 'drills')]))
            .toBe('Imported 1 machine, 1 belt, 2 drills from Factorio.');
    });
});

describe('undoMessageInput', () => {
    const extras = { hint: 'Or press Ctrl+Z to undo.', onUndo: () => {}, onClose: () => {}, returnFocus: () => null };

    it('has no timer while it offers Undo: it stays until an edit, another action, Close or Escape', () => {
        const input = undoMessageInput(createUndoEntry(1, 'Build reset.', form(), true, false), extras);
        expect(input.durationMs).toBeNull();
        expect(input).toMatchObject({ severity: 'info', text: 'Build reset.', hint: extras.hint });
        expect(input.action).toMatchObject({ label: 'Undo', onClick: extras.onUndo, keyShortcuts: 'Control+Z Meta+Z' });
        expect(input.onClose).toBe(extras.onClose);
        expect(input.returnFocus).toBe(extras.returnFocus);
    });

    it('is a notice for 8 seconds, without Undo or its key, when it does not offer Undo', () => {
        const input = undoMessageInput(createUndoEntry(1, UNDO_RESULTS_NOTE, form(), false, false), extras);
        expect(input.durationMs).toBe(8000);
        expect(input.action).toBeUndefined();
        expect(input.hint).toBeUndefined();
    });
});
