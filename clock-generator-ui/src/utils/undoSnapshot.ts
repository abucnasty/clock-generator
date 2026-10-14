import { ChestType } from 'clock-generator/light';
import * as edits from './configForm/edits';
import { isInfinityChest, type ConfigFormData, type EntityKind } from './configForm/formData';
import { entityLabel, type LabelKind } from './entityLabel';

// Every text of the Undo messages, so that the copy changes in one place
export const UNDO_DURATION_MS = 10_000;
export const UNDO_NOTICE_DURATION_MS = 8_000;
export const UNDO_LABEL = 'Undo';
export const UNDO_RESET_MESSAGE = 'Build reset.';
export const UNDO_IMPORT_MESSAGE = 'Build imported.';
const UNDO_DRILLS_OFF_MESSAGE = 'Mining drills turned off.';
export const UNDO_RESULTS_NOTE = 'Build restored. The clocks you had generated were cleared; click Generate to make them again.';
/** Read out after an Undo message: the key that undoes too, on a Mac and elsewhere */
export const UNDO_KEY_HINT = { mac: 'Or press Cmd+Z to undo.', other: 'Or press Ctrl+Z to undo.' };
/** The same keys, for the Undo button's `aria-keyshortcuts` */
export const UNDO_KEY_SHORTCUTS = 'Control+Z Meta+Z';

/** One of a kind, for `entityLabel`, and the kind's name for several ("Inserters 3–5 are now 2–4") */
const KINDS: Record<EntityKind, { one: LabelKind; many: string }> = {
    machines: { one: 'machine', many: 'Machines' },
    inserters: { one: 'inserter', many: 'Inserters' },
    belts: { one: 'belt', many: 'Belts' },
    chests: { one: 'chest', many: 'Chests' },
    drills: { one: 'drill', many: 'Drills' },
};

const CHEST_TYPE_NAMES: Record<ChestType, string> = {
    [ChestType.BUFFER_CHEST]: 'Buffer Chest',
    [ChestType.INFINITY_CHEST]: 'Infinity Chest',
};

/**
 * What one Undo message is about. `before` is the form when it was made; `snapshot` is that form when the message
 * offers Undo, and null when it does not (before the saved build is loaded, or the notice after an Undo). `after` is
 * the form the action made, missing until it has been seen.
 */
export interface UndoEntry {
    id: number;
    message: string;
    before: ConfigFormData;
    snapshot: ConfigFormData | null;
    after?: ConfigFormData;
    resultsCleared: boolean;
}

export function createUndoEntry(id: number, message: string, before: ConfigFormData, canUndo: boolean, resultsCleared: boolean): UndoEntry {
    return { id, message, before, snapshot: canUndo ? before : null, resultsCleared };
}

/** Equal by value: a field that commits on blur may give a new object with the same values */
function sameForm(a: ConfigFormData, b: ConfigFormData): boolean {
    return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The entry as the form now is: it learns the form its action made, and is withdrawn (null) once the form differs
 * from that, since an Undo would then throw away the later edit too. The same object while nothing changes.
 */
export function settleUndoEntry(entry: UndoEntry | null, form: ConfigFormData): UndoEntry | null {
    if (entry === null) {
        return null;
    }
    if (entry.after === undefined) {
        return sameForm(form, entry.before) ? entry : { ...entry, after: form };
    }
    return sameForm(form, entry.after) ? entry : null;
}

/**
 * The form an Undo puts back, and the notice that follows it when the action had cleared generated clocks, which the
 * Undo does not bring back; null for an entry without Undo. The notice is about the form put back, so it goes with the
 * first edit after it.
 */
export function undoOutcome(entry: UndoEntry, nextId: number): { form: ConfigFormData; next: UndoEntry | null } | null {
    if (entry.snapshot === null) {
        return null;
    }
    return {
        form: entry.snapshot,
        next: entry.resultsCleared ? { ...createUndoEntry(nextId, UNDO_RESULTS_NOTE, entry.snapshot, false, false), after: entry.snapshot } : null,
    };
}

const itemsOf = (form: ConfigFormData, kind: EntityKind): { id: number; _uuid: string }[] =>
    kind === 'drills' ? form.drills?.configs ?? [] : form[kind];

/** "3–5", or "3, 5" when the numbers do not follow on */
function idList(ids: number[]): string {
    const consecutive = ids.every((id, i) => i === 0 || id === ids[i - 1] + 1);
    return consecutive && ids.length > 1 ? `${ids[0]}–${ids[ids.length - 1]}` : ids.join(', ');
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * What deleting the entity at the index did, from the forms before and after it: which one went, which of its kind
 * were renumbered, and which links to it were cleared. "Deleted Inserter 2. Inserters 3–5 are now 2–4." Null when there
 * is no entity at the index.
 */
export function describeRemoval(before: ConfigFormData, after: ConfigFormData, kind: EntityKind, index: number): string | null {
    const removed = itemsOf(before, kind)[index];
    if (!removed) {
        return null;
    }
    const names = KINDS[kind];
    const sentences = [`Deleted ${entityLabel(names.one, removed.id)}.`];

    const newIds = new Map(itemsOf(after, kind).map((item) => [item._uuid, item.id]));
    const moved = itemsOf(before, kind).filter((item) => newIds.has(item._uuid) && newIds.get(item._uuid) !== item.id);
    if (moved.length > 0) {
        const from = idList(moved.map((item) => item.id));
        const to = idList(moved.map((item) => newIds.get(item._uuid)!));
        sentences.push(moved.length === 1 ? `${entityLabel(names.one, moved[0].id)} is now ${to}.` : `${names.many} ${from} are now ${to}.`);
    }

    // the links of the same inserter or drill that had a target before and have none after
    const insertersBefore = new Map(before.inserters.map((ins) => [ins._uuid, ins]));
    const clearedEnds = after.inserters.reduce((sum, ins) => {
        const was = insertersBefore.get(ins._uuid);
        if (!was) return sum;
        return sum + [[was.source, ins.source], [was.sink, ins.sink]].filter(([then, now]) => then.id !== 0 && now.id === 0).length;
    }, 0);
    const drillsBefore = new Map((before.drills?.configs ?? []).map((drill) => [drill._uuid, drill]));
    const clearedDrills = (after.drills?.configs ?? []).filter((drill) => {
        const was = drillsBefore.get(drill._uuid);
        return was !== undefined && was.target.id !== 0 && drill.target.id === 0;
    }).length;
    const cleared = [
        clearedEnds > 0 ? count(clearedEnds, 'inserter end', 'inserter ends') : null,
        clearedDrills > 0 ? count(clearedDrills, 'drill', 'drills') : null,
    ].filter((part) => part !== null);
    if (cleared.length > 0) {
        const one = clearedEnds + clearedDrills === 1;
        sentences.push(`${cleared.join(' and ')} no longer ${one ? 'has a target' : 'have a target'}.`);
    }
    return sentences.join(' ');
}

const REMOVE: Record<EntityKind, (form: ConfigFormData, index: number) => ConfigFormData> = {
    machines: edits.removeMachine,
    inserters: edits.removeInserter,
    belts: edits.removeBelt,
    chests: edits.removeChest,
    drills: edits.removeDrill,
};

/** The message for deleting the entity at the index, made by the same edit the form applies; null if there is none */
export function removalMessage(form: ConfigFormData, kind: EntityKind, index: number): string | null {
    return describeRemoval(form, REMOVE[kind](form, index), kind, index);
}

/** "Chest 2 changed to Infinity Chest."; null when the chest is already of that type or there is none */
export function describeChestSwitch(form: ConfigFormData, index: number, newType: ChestType): string | null {
    const chest = form.chests[index];
    if (!chest) {
        return null;
    }
    const type = isInfinityChest(chest) ? ChestType.INFINITY_CHEST : ChestType.BUFFER_CHEST;
    return type === newType ? null : `${entityLabel('chest', chest.id)} changed to ${CHEST_TYPE_NAMES[newType]}.`;
}

/** Null when the drills are already off */
export function describeDrillsOff(form: ConfigFormData): string | null {
    return form.drills === undefined ? null : UNDO_DRILLS_OFF_MESSAGE;
}

/** "Imported 3 machines, 2 inserters from Factorio." */
export function describePaste(parts: string[]): string {
    return `Imported ${parts.join(', ')} from Factorio.`;
}
