/** A slot's filter in the simulation: the only item it takes, null for a free slot, or BLOCKED_SLOT for none at all */
export const BLOCKED_SLOT: unique symbol = Symbol("blocked slot");

export type SlotFilter = string | null | typeof BLOCKED_SLOT;
