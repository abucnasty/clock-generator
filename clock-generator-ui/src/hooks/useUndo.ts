import { useEffect, useMemo, useRef, useState } from 'react';
import type { ConfigFormData } from '../utils/configForm/formData';
import {
    createUndoEntry,
    settleUndoEntry,
    undoOutcome,
    UNDO_DURATION_MS,
    UNDO_KEY_HINT,
    UNDO_KEY_SHORTCUTS,
    UNDO_LABEL,
    UNDO_NOTICE_DURATION_MS,
    type UndoEntry,
} from '../utils/undoSnapshot';
import { useDismissMessage, useIsMessageShown, useNotify } from './useMessages';

const UNDO_HINT = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? UNDO_KEY_HINT.mac : UNDO_KEY_HINT.other;

/** Inputs whose Ctrl+Z is the browser's own, undoing the typing */
const NON_TEXT_INPUT_TYPES = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image']);

function isTextField(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
        return false;
    }
    if (target.isContentEditable || target instanceof HTMLTextAreaElement) {
        return true;
    }
    return target instanceof HTMLInputElement && !NON_TEXT_INPUT_TYPES.has(target.type);
}

/**
 * The safety net for the actions that throw part of the build away: each says what it did in a message with an Undo
 * button, for 10 seconds, which puts the whole form back as it was just before. Ctrl+Z (Cmd+Z) does the same while
 * the message shows, outside a text field. There is one slot: a newer action replaces the offer, and any other change
 * of the form withdraws it, since putting the old form back would also throw that change away.
 */
export function useUndo(
    config: ConfigFormData,
    setConfig: React.Dispatch<React.SetStateAction<ConfigFormData>>,
    isLoaded: boolean,
) {
    const notify = useNotify();
    const dismiss = useDismissMessage();
    const isShown = useIsMessageShown();
    const [entry, setEntry] = useState<UndoEntry | null>(null);

    // read by the handlers, which may run after an await, so they see the form as it is then
    const configRef = useRef(config);
    const isLoadedRef = useRef(isLoaded);
    const entryRef = useRef(entry);
    const counterRef = useRef(0);
    // the message showing the entry
    const messageIdRef = useRef<number | null>(null);
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
        // withdrawn by another edit: its message goes too
        if (entry === null && messageIdRef.current !== null) {
            dismiss(messageIdRef.current);
            messageIdRef.current = null;
        }
    }, [entry, dismiss]);

    const { offerUndo, undo } = useMemo(() => {
        const show = (next: UndoEntry | null) => {
            setEntry(next);
            if (next === null) {
                if (messageIdRef.current !== null) dismiss(messageIdRef.current);
                messageIdRef.current = null;
                return;
            }
            const canUndo = next.snapshot !== null;
            messageIdRef.current = notify({
                severity: 'info',
                text: next.message,
                durationMs: canUndo ? UNDO_DURATION_MS : UNDO_NOTICE_DURATION_MS,
                action: canUndo ? { label: UNDO_LABEL, onClick: () => undo(next.id), keyShortcuts: UNDO_KEY_SHORTCUTS } : undefined,
                hint: canUndo ? UNDO_HINT : undefined,
            });
        };

        /** Puts back the form from before the entry's action, if that entry is still the one offered */
        const undo = (id: number) => {
            const current = entryRef.current;
            if (current?.id !== id) return;
            const outcome = undoOutcome(current, ++counterRef.current);
            if (!outcome) return;
            setConfig(outcome.form);
            show(outcome.next);
        };

        /**
         * Offers Undo for the action about to be applied: call it just before the edit. A message function gets the
         * form as it is and returns null when the action would change nothing, which offers nothing.
         */
        const offerUndo = (message: string | ((form: ConfigFormData) => string | null), options?: { resultsCleared?: boolean }) => {
            const form = configRef.current;
            const text = typeof message === 'function' ? message(form) : message;
            if (text === null) return;
            // before the saved build is loaded, the form is the default one, which is not the player's to go back to
            show(createUndoEntry(++counterRef.current, text, form, isLoadedRef.current, options?.resultsCleared ?? false));
        };

        return { offerUndo, undo };
    }, [notify, dismiss, setConfig]);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== 'z') return;
            const current = entryRef.current;
            const messageId = messageIdRef.current;
            if (!current?.snapshot || messageId === null || !isShown(messageId) || isTextField(event.target)) return;
            event.preventDefault();
            undo(current.id);
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [undo, isShown]);

    return { offerUndo };
}
