import { useCallback, useEffect, useRef } from 'react';
import { focusTargetIndex } from '../utils/rowFocus';

/**
 * Keeps the keyboard in a list card when one of its rows is deleted, since the row's delete button goes with it and
 * focus would fall back to the top of the page (WCAG 2.4.3): it moves to the delete button of the row that took its
 * place, or of the row before when it was the last, or to the card's Add button when no row is left. The card is the
 * element `cardRef` is given, its rows' delete buttons are marked `data-row-delete` and its Add button `data-row-add`;
 * `count` is its number of rows. `remove` deletes the row at an index with `onRemove`, and moves focus after it.
 */
export function useFocusAfterRemove(count: number, onRemove: (index: number) => void) {
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
        const target = focusTargetIndex(removed.index, buttons.length);
        (target === null ? card.querySelector<HTMLElement>('[data-row-add]') : buttons[target])?.focus();
    }, [count]);

    const remove = useCallback((index: number) => {
        pending.current = { index, count };
        onRemove(index);
    }, [count, onRemove]);

    return { cardRef, remove };
}
