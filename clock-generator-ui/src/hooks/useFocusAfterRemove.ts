import { useCallback, useEffect, useRef } from 'react';
import { focusTargetIndex } from '../utils/rowFocus';

/**
 * Keeps the keyboard in a list card when one of its rows is deleted, since the row's delete button goes with it and
 * focus would fall back to the top of the page (WCAG 2.4.3): it moves to the delete button of the row that took its
 * place, or of the row before when it was the last, or to the card's Add button when no row is left. The card is the
 * element `cardRef` is given, its rows' delete buttons are marked `data-row-delete` and its Add button `data-row-add`;
 * `count` is its number of rows. Add and Duplicate call `afterAdd(run)`; only their committed growth moves focus
 * to the last `[data-row-first]` control and brings it below the sticky header. `remove` deletes the row at an index
 * with `onRemove`, and moves focus after it.
 */
export function useFocusAfterRemove(count: number, onRemove: (index: number) => void) {
    const cardRef = useRef<HTMLElement>(null);
    const pending = useRef<{ index: number; count: number } | null>(null);
    const countBeforeAdd = useRef<number | null>(null);

    useEffect(() => {
        const before = countBeforeAdd.current;
        countBeforeAdd.current = null;
        if (before !== null && count > before) {
            const firsts = cardRef.current?.querySelectorAll<HTMLElement>('[data-row-first]');
            const first = firsts?.[firsts.length - 1];
            const control = first?.matches('input, button, [role="combobox"]') ? first : first?.querySelector<HTMLElement>('input, button, [role="combobox"]');
            control?.focus();
            control?.scrollIntoView({ block: 'nearest' });
        }
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
    });

    const remove = useCallback((index: number) => {
        pending.current = { index, count };
        onRemove(index);
    }, [count, onRemove]);

    const afterAdd = useCallback((run: () => void) => {
        countBeforeAdd.current = count;
        run();
    }, [count]);

    return { cardRef, remove, afterAdd };
}
