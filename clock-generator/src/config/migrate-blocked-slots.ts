/** The game's markers that block an inventory slot, which configs of the 0.20.0 drafts named as the slot's item */
export const BLOCKED_SLOT_MARKERS = ["no-item", "deconstruction-planner"] as const;

/** Read the former spelling of a blocked slot once: all validated, saved and exported configs use `blocked: true`. */
export function migrateBlockedSlotFilter(value: unknown): unknown {
    if (typeof value !== "object" || value === null || Array.isArray(value) || "blocked" in value) {
        return value;
    }
    const { item, ...filter } = value as Record<string, unknown>;
    return (BLOCKED_SLOT_MARKERS as readonly unknown[]).includes(item) ? { ...filter, blocked: true } : value;
}
