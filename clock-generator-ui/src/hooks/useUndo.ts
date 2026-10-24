import { useEffect, useMemo, useRef, useState } from 'react';
import type { ConfigFormData } from '../utils/configForm/formData';
import { entersEditingDialog, isInOtherDialog, isTextField, isUndoShortcut } from '../utils/undoKeys';
import {
    createUndoEntry,
    describeConfigEdit,
    sameForm,
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
 * The safety net for build edits: each says what it did in a message with an Undo
 * button, which puts the whole form back as it was just before. Ctrl+Z (Cmd+Z) does the same while Undo is offered,
 * outside a text field and an editing dialog. There is one slot, and no timer: the offer lasts until another action
 * replaces it, the message is closed, an editing dialog opens, the player starts a check or a generation or opens
 * another build. Ordinary field edits replace the offer too, with rapid typing in one input grouped into one edit.
 */
export function useUndo(
    config: ConfigFormData,
    setConfig: React.Dispatch<React.SetStateAction<ConfigFormData>>,
    isLoaded: boolean,
    buildId = 'active-build',
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
    const observedRef = useRef({ config, isLoaded, buildId });
    const undoneFormRef = useRef<ConfigFormData | null>(null);
    const typingRef = useRef<{ id: number; field: Element; key: string; at: number } | null>(null);
    // the message showing the entry, and where focus goes from it
    const messageIdRef = useRef<number | null>(null);
    const returnRef = useRef<ReturnFocus | null>(null);
    // what an Undo of the entry with this id does instead of putting the form back, when its action opened another build
    const revertRef = useRef<{ id: number; revert: (snapshot: ConfigFormData) => void } | null>(null);
    useEffect(() => {
        configRef.current = config;
        isLoadedRef.current = isLoaded;
    }, [config, isLoaded]);

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
            entryRef.current = next;
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
                    onClose: () => {
                        if (entryRef.current?.id === next.id) entryRef.current = null;
                        setEntry((current) => (current?.id === next.id ? null : current));
                    },
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
            undoneFormRef.current = outcome.form;
            typingRef.current = null;
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
                /** An already guarded whole-build snapshot supplied by its authoritative owner. */
                snapshot?: ConfigFormData;
            },
        ) => {
            const form = options?.snapshot ?? configRef.current;
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
         * Ends the offer without a word: for the player's own press of Generate or Check, which accepts the build (decided
         * 2026-10-14), and for opening another build, which replaces the form. The message goes with it, and
         * Ctrl/Cmd+Z is the browser's again.
         */
        const withdrawUndo = () => {
            entryRef.current = null;
            typingRef.current = null;
            setEntry(null);
        };

        return { offerUndo, withdrawUndo, undo };
    }, [notify, dismiss, announceMessage, setConfig]);

    // One owner catches every persisted configuration edit, including new inline controls and both diagram views.
    // Explicit offers made just before an action retain their detailed messages and whole-build restore callbacks.
    useEffect(() => {
        const previous = observedRef.current;
        observedRef.current = { config, isLoaded, buildId };
        if (config === previous.config && buildId === previous.buildId) return;
        const current = entryRef.current;
        // A guarded replacement may capture edits newer than the last React commit. Its explicit
        // snapshot is authoritative even when it differs from the previously observed form.
        const explicitlyOffered = current !== null && current.after === undefined;
        if (undoneFormRef.current === config) {
            undoneFormRef.current = null;
            return;
        }
        undoneFormRef.current = null;
        if (explicitlyOffered) {
            if (buildId === previous.buildId && sameForm(config, current.before)) {
                withdrawUndo();
                return;
            }
            const settled = settleUndoEntry(current, config);
            entryRef.current = settled;
            setEntry(settled);
            typingRef.current = null;
            return;
        }
        if (buildId !== previous.buildId || !previous.isLoaded || !isLoaded) {
            withdrawUndo();
            return;
        }
        if (sameForm(config, previous.config)) return;

        const description = describeConfigEdit(previous.config, config);
        const field = document.activeElement;
        const at = Date.now();
        const typing = typingRef.current;
        if (current && typing?.id === current.id && typing.field === field && typing.key === description.key && at - typing.at < 900 && isTextField(field)) {
            const grouped = { ...current, after: config };
            entryRef.current = grouped;
            setEntry(grouped);
            typing.at = at;
            return;
        }
        offerUndo(description.message, { snapshot: previous.config });
        const offered = entryRef.current;
        if (offered) {
            const settled = { ...offered, after: config };
            entryRef.current = settled;
            setEntry(settled);
            typingRef.current = field && isTextField(field) ? { id: offered.id, field, key: description.key, at } : null;
        }
    }, [config, isLoaded, buildId, offerUndo, withdrawUndo]);

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
                entryRef.current = null;
                typingRef.current = null;
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
