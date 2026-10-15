import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { focusTargetIndex } from '../utils/rowFocus';

/**
 * Keeps the keyboard in a list card when one of its rows is deleted, since the row's delete button goes with it and
 * focus would fall back to the top of the page (WCAG 2.4.3): it moves to the delete button of the row that took its
 * place, or of the row before when it was the last, or to the card's Add button when no row is left. The card is the
 * element `cardRef` is given, its rows' delete buttons are marked `data-row-delete` and its Add button `data-row-add`;
 * `count` is its number of rows. `remove` deletes the row at an index with `onRemove`, and moves focus after it.
 */
export function useFocusAfterRemove(count: number, onRemove: (index: number) => void) {
    const cardRef = useRef<HTMLElement>(null);
    const pending = useRef<{ index: number; count: number } | null>(null);

    useEffect(() => {
        const removed = pending.current;
        pending.current = null;
        const card = cardRef.current;
        // only once that row has gone
        if (removed === null || card === null || count !== removed.count - 1) {
            return;
        }
        const buttons = Array.from(card.querySelectorAll<HTMLElement>('[data-row-delete]:not(:disabled)'));
        const target = focusTargetIndex(removed.index, buttons.length);
        (target === null ? card.querySelector<HTMLElement>('[data-row-add]') : buttons[target])?.focus();
    }, [count]);

    const remove = useCallback((index: number) => {
        pending.current = { index, count };
        onRemove(index);
    }, [count, onRemove]);

    return { cardRef, remove };
}

/**
 * The other way: when an "Add …" row is replaced by the row it added, the keyboard goes to that row's first select (its
 * Type), where the Add row's button went. Call the returned function as the row is added; once the card (`cardRef`)
 * has more rows (`count`), the last of its rows (`role="group"`) takes the focus.
 */
export function useFocusAfterAdd(count: number, cardRef: RefObject<HTMLElement | null>) {
    const countBefore = useRef<number | null>(null);

    // after every render, and once only: the render the add caused. Were the add to come to nothing, a later growth
    // (a Paste) must not take the focus
    useEffect(() => {
        const before = countBefore.current;
        if (before === null) {
            return;
        }
        countBefore.current = null;
        if (count > before) {
            const rows = cardRef.current?.querySelectorAll<HTMLElement>('[role="group"]');
            rows?.[rows.length - 1]?.querySelector<HTMLElement>('[role="combobox"]')?.focus();
        }
    });

    return useCallback(() => {
        countBefore.current = count;
    }, [count]);
}
