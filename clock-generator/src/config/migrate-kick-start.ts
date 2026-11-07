/**
 * Read the former `loop_seed_items` override once: it is the `kick_start_items` (maintainer glossary, Kick start). An overrides object that
 * carries only the former name loads as one that carries the new name; one that carries both keeps its `kick_start_items`.
 */
export function renameLoopSeedItemsToKickStart(value: unknown): unknown {
    if (typeof value !== "object" || value === null || Array.isArray(value) || !("loop_seed_items" in value)) {
        return value;
    }
    const overrides = value as Record<string, unknown>;
    if ("kick_start_items" in overrides) {
        const { loop_seed_items, ...kept } = overrides;
        return kept;
    }
    return Object.fromEntries(Object.entries(overrides).map(([key, entry]) => [key === "loop_seed_items" ? "kick_start_items" : key, entry]));
}
