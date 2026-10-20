/** An omitted or empty filter list follows the source and destination. */
export function usesAutomaticFilters(filters: string[] | undefined): boolean {
    return !filters?.length;
}

/** Filters captured as a blacklist, naming the items the inserter leaves: the engine refuses them, so the form says so */
export function usesBlacklist(inserter: { filters?: string[]; filter_mode?: string }): boolean {
    return inserter.filter_mode === 'blacklist' && !usesAutomaticFilters(inserter.filters);
}

/** What to do about a captured blacklist; Automatic filters drop its mode with its items */
export const BLACKLIST_NOTE = 'Blacklist · Not supported: use automatic filters, or set a whitelist in the game and recapture';

/**
 * How a view names an inserter's filters, given its own words for Automatic and for filters set by hand. A captured
 * blacklist is named so in every view, so it is never taken for the items the inserter moves.
 */
export function filtersLabel(inserter: { filters?: string[]; filter_mode?: string }, automatic: string, explicit: string): string {
    return usesAutomaticFilters(inserter.filters) ? automatic : usesBlacklist(inserter) ? 'Blacklist, not supported' : explicit;
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
