/**
 * Where focus goes once the row at `index` is deleted: the index, among the delete buttons that can still be used, of
 * the one in the row that took its place, or in the row before when it was the last; null when none is left (or none
 * can be used, as the only machine's), for the card's Add button.
 */
export function focusTargetIndex(index: number, enabledCount: number): number | null {
    return enabledCount === 0 ? null : Math.min(index, enabledCount - 1);
}
