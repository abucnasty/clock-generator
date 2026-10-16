import { useEffect, useMemo, useRef, useState } from 'react';
import type { ConfigFormData } from '../utils/configForm/formData';
import { entersEditingDialog, isInOtherDialog, isTextField, isUndoShortcut } from '../utils/undoKeys';
import {
    createUndoEntry,
    settleUndoEntry,
    undoMessageInput,
    undoOutcome,
    UNDO_KEY_HINT,
    UNDO_WITHDRAWN_MESSAGE,
    type UndoEntry,
} from '../utils/undoSnapshot';
import { useAnnounce, useAnnounceMessage, useDismissMessage, useNotify } from './useMessages';

const UNDO_HINT = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? UNDO_KEY_HINT.mac : UNDO_KEY_HINT.other;

/** Where focus goes when nothing it was on is left: the selected Configure/Results toggle, always in the header */
const FOCUS_FALLBACK = '[data-focus-fallback] [aria-pressed="true"]';

/** Where focus goes when the player leaves an Undo message from inside it */
interface ReturnFocus {
    /** What had focus when the action was taken (a delete button is gone after its delete) */
    offeredFrom: HTMLElement | null;
    /** What last had focus outside the message: the next row's delete button, the menu button the menu went back to */
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
    return usable(record.offeredFrom) ?? usable(record.next) ?? document.querySelector<HTMLElement>(FOCUS_FALLBACK);
}

/**
 * The safety net for the actions that throw part of the build away: each says what it did in a message with an Undo
 * button, which puts the whole form back as it was just before. Ctrl+Z (Cmd+Z) does the same while Undo is offered,
 * outside a text field and an editing dialog. There is one slot, and no timer: the offer lasts until another action
 * replaces it, the message is closed, an editing dialog opens, the player starts a check or a generation or opens
 * another build, or the form changes some other way, since putting the old form back would also throw that change away.
 */
export function useUndo(
    config: ConfigFormData,
    setConfig: React.Dispatch<React.SetStateAction<ConfigFormData>>,
    isLoaded: boolean,
) {
    const notify = useNotify();
    const dismiss = useDismissMessage();
    const announce = useAnnounce();
    const announceMessage = useAnnounceMessage();
    const [entry, setEntry] = useState<UndoEntry | null>(null);

    // read by the handlers, which may run after an await, so they see the form as it is then
    const configRef = useRef(config);
    const isLoadedRef = useRef(isLoaded);
    const entryRef = useRef(entry);
    const counterRef = useRef(0);
    // the message showing the entry, and where focus goes from it
    const messageIdRef = useRef<number | null>(null);
    const returnRef = useRef<ReturnFocus | null>(null);
    // what an Undo of the entry with this id does instead of putting the form back, when its action opened another build
    const revertRef = useRef<{ id: number; revert: (snapshot: ConfigFormData) => void } | null>(null);
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
        if (entry === null) revertRef.current = null;
        // withdrawn: its message goes too
        if (entry === null && messageIdRef.current !== null) {
            dismiss(messageIdRef.current);
            messageIdRef.current = null;
        }
    }, [entry, dismiss]);

    const { offerUndo, withdrawUndo, undo } = useMemo(() => {
        const show = (next: UndoEntry | null, record: ReturnFocus | null, deferAnnouncement = false) => {
            setEntry(next);
            if (next === null) {
                if (messageIdRef.current !== null) dismiss(messageIdRef.current);
                messageIdRef.current = null;
                return;
            }
            const forThis = record ?? returnRef.current;
            const messageId = notify({
                ...undoMessageInput(next, {
                    hint: UNDO_HINT,
                    onUndo: () => undo(next.id),
                    // closed, or replaced by another message: the offer goes with it
                    onClose: () => setEntry((current) => (current?.id === next.id ? null : current)),
                    returnFocus: () => (forThis ? returnTarget(forThis) : null),
                }),
                ...(deferAnnouncement ? { deferAnnouncement: true } : {}),
            });
            messageIdRef.current = messageId;
            return (suffix?: string) => announceMessage(messageId, suffix);
        };

        /** Puts back the form from before the entry's action, if that entry is still the one offered */
        const undo = (id: number) => {
            const current = entryRef.current;
            if (current?.id !== id) return;
            const outcome = undoOutcome(current);
            if (!outcome) return;
            if (returnRef.current) returnRef.current.undone = true;
            const revert = revertRef.current?.id === id ? revertRef.current.revert : null;
            if (revert) {
                revert(outcome.form);
            } else {
                setConfig(outcome.form);
            }
            show(outcome.next, null);
        };

        /**
         * Offers Undo for the action about to be applied: call it just before the edit. A message function gets the
         * form as it is and returns null when the action would change nothing, which offers nothing. `restoredLabel`
         * names the delete button that an Undo brings back, for focus to go to. `revert` is called with the form from
         * before instead of putting it back, for an action that opened another build (Delete build, a share link): its
         * Undo changes which build is open, not only the form.
         */
        const offerUndo = (
            message: string | ((form: ConfigFormData) => string | null),
            options?: {
                restoredLabel?: (form: ConfigFormData) => string | null;
                revert?: (snapshot: ConfigFormData) => void;
                /** Keep Undo immediate, but announce it together with the replacement's asynchronous outcome */
                deferAnnouncement?: boolean;
            },
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
            const entry = createUndoEntry(++counterRef.current, text, form, isLoadedRef.current);
            revertRef.current = options?.revert ? { id: entry.id, revert: options.revert } : null;
            return show(entry, record, options?.deferAnnouncement);
        };

        /**
         * Ends the offer without a word: for the player's own press of Generate or Check, which accepts the build (the
         * owner, 2026-10-14), and for opening another build, which replaces the form. The message goes with it, and
         * Ctrl/Cmd+Z is the browser's again.
         */
        const withdrawUndo = () => setEntry(null);

        return { offerUndo, withdrawUndo, undo };
    }, [notify, dismiss, announceMessage, setConfig]);

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
            // an editing dialog opening withdraws the offer, as an Undo would change the entity it shows; a screen reader
            // user is told, since the message goes without anything they did to it
            if (entersEditingDialog(target, event.relatedTarget)) {
                if (entryRef.current?.snapshot) {
                    announce(UNDO_WITHDRAWN_MESSAGE);
                }
                setEntry(null);
                return;
            }
            const record = returnRef.current;
            if (record && target !== record.offeredFrom && !target.closest('[data-message]')) {
                record.next = target;
            }
        };
        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('focusin', onFocusIn);
        return () => {
            document.removeEventListener('keydown', onKeyDown);
            document.removeEventListener('focusin', onFocusIn);
        };
    }, [undo, announce]);

    return { offerUndo, withdrawUndo };
}
