/**
 * An inserter's filter slots. While the player has set none, the slots show the auto filters (what the source gives that
 * the destination takes), then one "+". Setting or removing a slot turns what is shown into the player's own list, so the
 * other filters stay where they were. `undefined` is "none set": the inserter goes back to the auto filters.
 */

/** The filters with the slot at `slotIndex` set to `item`; the "+" slot is the one after the last shown */
export function filtersWithSlotSet(explicit: string[] | undefined, inferred: string[], slotIndex: number, item: string, maxSlots: number): string[] | undefined {
    const filters = explicit?.length ? [...explicit] : inferred.slice(0, maxSlots);
    filters[slotIndex] = item;
    return withoutTrailingEmpty(filters);
}

/** The filters without the slot at `slotIndex` */
export function filtersWithSlotRemoved(explicit: string[] | undefined, inferred: string[], slotIndex: number): string[] | undefined {
    const filters = explicit?.length ? [...explicit] : [...inferred];
    filters.splice(slotIndex, 1);
    return withoutTrailingEmpty(filters);
}

function withoutTrailingEmpty(filters: string[]): string[] | undefined {
    const kept = [...filters];
    while (kept.length > 0 && !kept[kept.length - 1]) {
        kept.pop();
    }
    return kept.length > 0 ? kept : undefined;
}
