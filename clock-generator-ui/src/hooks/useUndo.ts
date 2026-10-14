import { useEffect, useMemo, useRef, useState } from 'react';
import type { ConfigFormData } from '../utils/configForm/formData';
import { isInOtherDialog, isTextField, isUndoShortcut } from '../utils/undoKeys';
import {
    createUndoEntry,
    settleUndoEntry,
    undoMessageInput,
    undoOutcome,
    UNDO_KEY_HINT,
    type UndoEntry,
} from '../utils/undoSnapshot';
import { useDismissMessage, useNotify } from './useMessages';

const UNDO_HINT = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? UNDO_KEY_HINT.mac : UNDO_KEY_HINT.other;

/** A dialog that edits an entity by its place in a list, which an Undo could move under it */
const EDITS_BUILD = '[data-edits-build]';

/** Where focus goes when the player leaves an Undo message from inside it */
interface ReturnFocus {
    /** What had focus when the action was taken (a delete button is gone after its delete) */
    offeredFrom: HTMLElement | null;
    /** What got focus next, outside the message: the next row's delete button, or the menu button the menu went back to */
    next: HTMLElement | null;
    /** After an Undo of a delete, the name of the deleted entity's delete button, which is back */
    restoredLabel: string | null;
    undone: boolean;
}

const usable = (element: HTMLElement | null) => (element?.isConnected && element !== document.body ? element : null);

function returnTarget(record: ReturnFocus): HTMLElement | null {
    if (record.undone && record.restoredLabel) {
        const restored = document.querySelector<HTMLElement>(`[data-row-delete][aria-label="${CSS.escape(record.restoredLabel)}"]`);
        if (restored) return restored;
    }
    return usable(record.offeredFrom) ?? usable(record.next);
}

/**
 * The safety net for the actions that throw part of the build away: each says what it did in a message with an Undo
 * button, which puts the whole form back as it was just before. Ctrl+Z (Cmd+Z) does the same while Undo is offered,
 * outside a text field and an editing dialog. There is one slot, and no timer: the offer lasts until another action
 * replaces it, the message is closed, an editing dialog opens, or the form changes some other way, since putting the old
 * form back would also throw that change away.
 */
export function useUndo(
    config: ConfigFormData,
    setConfig: React.Dispatch<React.SetStateAction<ConfigFormData>>,
    isLoaded: boolean,
) {
    const notify = useNotify();
    const dismiss = useDismissMessage();
    const [entry, setEntry] = useState<UndoEntry | null>(null);

    // read by the handlers, which may run after an await, so they see the form as it is then
    const configRef = useRef(config);
    const isLoadedRef = useRef(isLoaded);
    const entryRef = useRef(entry);
    const counterRef = useRef(0);
    // the message showing the entry, and where focus goes from it
    const messageIdRef = useRef<number | null>(null);
    const returnRef = useRef<ReturnFocus | null>(null);
    useEffect(() => {
        configRef.current = config;
        isLoadedRef.current = isLoaded;
    }, [config, isLoaded]);

    // adjusted while rendering, as React suggests for state that follows other state
    const settled = settleUndoEntry(entry, config);
    if (settled !== entry) {
        setEntry(settled);
    }
    useEffect(() => {
        entryRef.current = entry;
        // withdrawn: its message goes too
        if (entry === null && messageIdRef.current !== null) {
            dismiss(messageIdRef.current);
            messageIdRef.current = null;
        }
    }, [entry, dismiss]);

    const { offerUndo, undo } = useMemo(() => {
        const show = (next: UndoEntry | null, record: ReturnFocus | null) => {
            setEntry(next);
            if (next === null) {
                if (messageIdRef.current !== null) dismiss(messageIdRef.current);
                messageIdRef.current = null;
                return;
            }
            const forThis = record ?? returnRef.current;
            messageIdRef.current = notify(undoMessageInput(next, {
                hint: UNDO_HINT,
                onUndo: () => undo(next.id),
                // closed, or replaced by another message: the offer goes with it
                onClose: () => setEntry((current) => (current?.id === next.id ? null : current)),
                returnFocus: () => (forThis ? returnTarget(forThis) : null),
            }));
        };

        /** Puts back the form from before the entry's action, if that entry is still the one offered */
        const undo = (id: number) => {
            const current = entryRef.current;
            if (current?.id !== id) return;
            const outcome = undoOutcome(current, ++counterRef.current);
            if (!outcome) return;
            if (returnRef.current) returnRef.current.undone = true;
            setConfig(outcome.form);
            show(outcome.next, null);
        };

        /**
         * Offers Undo for the action about to be applied: call it just before the edit. A message function gets the
         * form as it is and returns null when the action would change nothing, which offers nothing. `restoredLabel`
         * names the delete button that an Undo brings back, for focus to go to.
         */
        const offerUndo = (
            message: string | ((form: ConfigFormData) => string | null),
            options?: { resultsCleared?: boolean; restoredLabel?: (form: ConfigFormData) => string | null },
        ) => {
            const form = configRef.current;
            const text = typeof message === 'function' ? message(form) : message;
            if (text === null) return;
            const record: ReturnFocus = {
                offeredFrom: document.activeElement instanceof HTMLElement ? document.activeElement : null,
                next: null,
                restoredLabel: options?.restoredLabel?.(form) ?? null,
                undone: false,
            };
            returnRef.current = record;
            // before the saved build is loaded, the form is the default one, which is not the player's to go back to
            show(createUndoEntry(++counterRef.current, text, form, isLoadedRef.current, options?.resultsCleared ?? false), record);
        };

        return { offerUndo, undo };
    }, [notify, dismiss, setConfig]);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (!isUndoShortcut(event)) return;
            const current = entryRef.current;
            const target = event.target instanceof Element ? event.target : null;
            if (!current?.snapshot || isTextField(target) || isInOtherDialog(target)) return;
            event.preventDefault();
            undo(current.id);
        };
        const onFocusIn = (event: FocusEvent) => {
            const target = event.target instanceof HTMLElement ? event.target : null;
            if (!target) return;
            // an editing dialog opening withdraws the offer, as an Undo would change the entity it shows
            const dialog = target.closest(EDITS_BUILD);
            if (dialog && !(event.relatedTarget instanceof Node && dialog.contains(event.relatedTarget))) {
                setEntry(null);
                return;
            }
            const record = returnRef.current;
            if (record && record.next === null && target !== record.offeredFrom && !target.closest('[data-message]')) {
                record.next = target;
            }
        };
        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('focusin', onFocusIn);
        return () => {
            document.removeEventListener('keydown', onKeyDown);
            document.removeEventListener('focusin', onFocusIn);
        };
    }, [undo]);

    return { offerUndo };
}
