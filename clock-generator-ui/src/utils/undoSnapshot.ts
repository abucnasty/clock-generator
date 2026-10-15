import { ChestType } from 'clock-generator/light';
import * as edits from './configForm/edits';
import { isInfinityChest, type ConfigFormData, type EntityKind } from './configForm/formData';
import { deleteButtonLabel, entityLabel, type LabelKind } from './entityLabel';
import type { MessageInput } from './messages';
import { exampleTitle, type ExampleBuild } from './exampleBuilds';

// Every text of the Undo messages, so that the copy changes in one place. An Undo message has no timer: it stays until
// the build is edited, another action offers Undo, or it is closed (the owner, 2026-10-14). The notice after it has one.
const UNDO_NOTICE_DURATION_MS = 8_000;
const UNDO_LABEL = 'Undo';
export const UNDO_RESET_MESSAGE = 'Build reset.';
export const UNDO_IMPORT_MESSAGE = 'Build file opened.';
const UNDO_DRILLS_OFF_MESSAGE = 'Mining drills turned off.';
export const UNDO_RESULTS_NOTE = 'Build restored. The clocks you had generated were cleared; click Generate to make them again.';
/** Read out when an editing dialog opening takes the offer away */
export const UNDO_WITHDRAWN_MESSAGE = 'Undo is no longer offered.';
/** Read out after an Undo message: the key that undoes too, on a Mac and elsewhere */
export const UNDO_KEY_HINT = { mac: 'Or press Cmd+Z to undo.', other: 'Or press Ctrl+Z to undo.' };
/** The same keys, for the Undo button's `aria-keyshortcuts` */
const UNDO_KEY_SHORTCUTS = 'Control+Z Meta+Z';

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
 * The message of an entry: with Undo and no timer while it offers Undo, or a notice for 8 seconds. Its hint names the
 * Undo key; `onClose` hears when it goes, and `returnFocus` says where focus goes from inside it.
 */
export function undoMessageInput(
    entry: UndoEntry,
    { hint, onUndo, onClose, returnFocus }: { hint: string; onUndo: () => void; onClose: () => void; returnFocus: () => HTMLElement | null },
): MessageInput {
    const canUndo = entry.snapshot !== null;
    return {
        severity: 'info',
        text: entry.message,
        durationMs: canUndo ? null : UNDO_NOTICE_DURATION_MS,
        action: canUndo ? { label: UNDO_LABEL, onClick: onUndo, keyShortcuts: UNDO_KEY_SHORTCUTS } : undefined,
        hint: canUndo ? hint : undefined,
        onClose,
        returnFocus,
    };
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

/** The Undo message after an example replaced the build: "Example loaded: Logistic science pack." */
export function exampleUndoMessage(example: Pick<ExampleBuild, 'recipe'>, name: (id: string) => string): string {
    return `Example loaded: ${exampleTitle(example, name)}.`;
}

/** "3 machines", "1 machine" */
export const countOf = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "Inserter 3", "Inserters 1–2", "Inserters 1, 3" */
function named(kind: EntityKind, ids: number[]): string {
    return ids.length === 1 ? entityLabel(KINDS[kind].one, ids[0]) : `${KINDS[kind].many} ${idList(ids)}`;
}

const hasOrHave = (ids: number[]) => (ids.length === 1 ? 'has' : 'have');
const ascending = (ids: number[]) => [...ids].sort((a, b) => a - b);

/**
 * What deleting the entity at the index did, from the forms before and after it, in the form's words: which one went,
 * which of its kind were renumbered, and which inserters and drills lost what pointed at it, one sentence per kind.
 * "Deleted Machine 2. Machines 3–4 are now 2–3. Inserters 1–2 have no Source now. Drill 1 has no Target Machine now."
 * Null when there is no entity at the index.
 */
export function describeRemoval(before: ConfigFormData, after: ConfigFormData, kind: EntityKind, index: number): string | null {
    const removed = itemsOf(before, kind)[index];
    if (!removed) {
        return null;
    }
    const sentences = [`Deleted ${entityLabel(KINDS[kind].one, removed.id)}.`];

    const newIds = new Map(itemsOf(after, kind).map((item) => [item._uuid, item.id]));
    const moved = itemsOf(before, kind).filter((item) => newIds.has(item._uuid) && newIds.get(item._uuid) !== item.id);
    if (moved.length > 0) {
        const to = idList(moved.map((item) => newIds.get(item._uuid)!));
        sentences.push(`${named(kind, moved.map((item) => item.id))} ${moved.length === 1 ? 'is' : 'are'} now ${to}.`);
    }

    // the inserters and drills that pointed at something before and at nothing after, numbered as they are now
    const insertersBefore = new Map(before.inserters.map((ins) => [ins._uuid, ins]));
    const lost = (end: 'source' | 'sink') => ascending(after.inserters.filter((ins) => {
        const was = insertersBefore.get(ins._uuid);
        return was !== undefined && was[end].id !== 0 && ins[end].id === 0;
    }).map((ins) => ins.id));
    const ends = ([['Source', lost('source')], ['Destination', lost('sink')]] as const)
        .filter(([, ids]) => ids.length > 0)
        .map(([field, ids]) => `${named('inserters', ids)} ${hasOrHave(ids)} no ${field}`);
    if (ends.length > 0) {
        sentences.push(`${ends.join(' and ')} now.`);
    }
    const drillsBefore = new Map((before.drills?.configs ?? []).map((drill) => [drill._uuid, drill]));
    const drills = ascending((after.drills?.configs ?? []).filter((drill) => {
        const was = drillsBefore.get(drill._uuid);
        return was !== undefined && was.target.id !== 0 && drill.target.id === 0;
    }).map((drill) => drill.id));
    if (drills.length > 0) {
        sentences.push(`${named('drills', drills)} ${hasOrHave(drills)} no Target Machine now.`);
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

/** The name of the deleted entity's delete button, which is back after an Undo, for focus to go to; null if none */
export function removedDeleteLabel(form: ConfigFormData, kind: EntityKind, index: number): string | null {
    const removed = itemsOf(form, kind)[index];
    return removed ? deleteButtonLabel(KINDS[kind].one, removed.id) : null;
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

/** "Imported 3 machines, 1 inserter from Factorio." */
export function describePaste(parts: string[]): string {
    return `Imported ${parts.join(', ')} from Factorio.`;
}
