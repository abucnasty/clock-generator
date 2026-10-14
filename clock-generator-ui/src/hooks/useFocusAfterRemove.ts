import { useCallback, useEffect, useRef } from 'react';

/**
 * Keeps the keyboard in a list card when one of its rows is deleted, since the row's delete button goes with it and
 * focus would fall back to the top of the page (WCAG 2.4.3): it moves to the delete button of the row that took its
 * place, or of the row before when it was the last, or to the card's Add button when no row is left. The card is the
 * element `cardRef` is given, its rows' delete buttons are marked `data-row-delete` and its Add button `data-row-add`;
 * `count` is its number of rows.
 */
export function useFocusAfterRemove(count: number) {
    const cardRef = useRef<HTMLDivElement>(null);
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
        const target = buttons[Math.min(removed.index, buttons.length - 1)] ?? card.querySelector<HTMLElement>('[data-row-add]');
        target?.focus();
    }, [count]);

    /** Call as the row at the index is deleted */
    const focusAfterRemove = useCallback((index: number) => {
        pending.current = { index, count };
    }, [count]);

    return { cardRef, focusAfterRemove };
}
