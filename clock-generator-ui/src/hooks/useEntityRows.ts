import { useCallback, useLayoutEffect, useRef } from 'react';
import { useFocusAfterRemove } from './useFocusAfterRemove';
import { useAnnounce } from './useMessages';

interface EntityRowsOptions<Row extends { id: number }> {
    /** A row's name, "Belt 2"; given the id the next row will get when it is about to be added */
    labelOf: (row: Row) => string;
    onRemove: (index: number) => void;
    onDuplicate: (index: number) => void;
    /** Why a row cannot be duplicated, said instead of duplicating it; null when it can */
    duplicateRefusal?: (row: Row, label: string) => string | null;
}

/** A row like `row`, with the id a new row takes: the one after the largest */
const nextRow = <Row extends { id: number }>(rows: readonly Row[], row: Row): Row => ({ ...row, id: Math.max(0, ...rows.map(other => other.id)) + 1 });

/**
 * Add, Duplicate and Delete for the rows of a build's section: the keyboard follows (see `useFocusAfterRemove`) and a
 * screen reader hears what was added. `remove` and `duplicate` keep their identity across renders, so memoised rows
 * do not render again when another row is added.
 */
export function useEntityRows<Row extends { id: number }>(rows: readonly Row[], options: EntityRowsOptions<Row>) {
    const { cardRef, remove, afterAdd } = useFocusAfterRemove(rows.length, options.onRemove);
    const announce = useAnnounce();
    const latest = useRef({ rows, options, remove, afterAdd, announce });
    useLayoutEffect(() => { latest.current = { rows, options, remove, afterAdd, announce }; });

    /** Runs `run`, which adds a row like `like` (an id is enough), and moves the focus to it */
    const add = (run: () => void, like = {} as Row) => {
        afterAdd(run);
        announce(`Added ${options.labelOf(nextRow(rows, like))}.`);
    };
    const duplicate = useCallback((index: number) => {
        const { rows, options, afterAdd, announce } = latest.current;
        const label = options.labelOf(rows[index]);
        const refusal = options.duplicateRefusal?.(rows[index], label);
        if (refusal) {
            announce(refusal);
            return;
        }
        const added = options.labelOf(nextRow(rows, rows[index]));
        afterAdd(() => options.onDuplicate(index));
        announce(`Added ${added}, a copy of ${label}.`);
    }, []);
    const removeRow = useCallback((index: number) => latest.current.remove(index), []);

    return { cardRef, add, duplicate, remove: removeRow };
}
