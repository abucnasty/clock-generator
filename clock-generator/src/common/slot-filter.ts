/** These inventory filters reserve a slot that inserters cannot use. Keep their original names in config exports. */
export const BLOCKED_SLOT_FILTERS = ['no-item', 'deconstruction-planner'] as const;

export function isBlockedSlotFilter(item: string | null | undefined): boolean {
    return item === 'no-item' || item === 'deconstruction-planner';
}
