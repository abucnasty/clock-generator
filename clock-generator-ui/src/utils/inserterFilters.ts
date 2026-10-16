/** An omitted or empty filter list follows the source and destination. */
export function usesAutomaticFilters(filters: string[] | undefined): boolean {
    return !filters?.length;
}

function result(filters: string[], wasAutomatic: boolean) {
    // Compact empty entries too: a slot can never put a null hole in exported JSON.
    const kept = filters.filter(Boolean);
    return { filters: kept.length ? kept : undefined, becameExplicit: wasAutomatic && kept.length > 0 };
}

export function setFilterSlot(filters: string[] | undefined, inferred: string[], slot: number, item: string) {
    const automatic = usesAutomaticFilters(filters);
    const next = [...(automatic ? inferred : filters!)];
    next[Math.min(Math.max(slot, 0), next.length)] = item;
    return result(next, automatic);
}

export function removeFilterSlot(filters: string[] | undefined, inferred: string[], slot: number) {
    const automatic = usesAutomaticFilters(filters);
    const next = [...(automatic ? inferred : filters!)];
    next.splice(slot, 1);
    return result(next, automatic);
}
