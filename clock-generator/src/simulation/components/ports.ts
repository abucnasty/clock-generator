import { ItemName } from "../../data";

/**
 * Who puts items through a drop port: an inserter's hand, or a machine or a drill that places what it makes (P4
 * section 13). A port may answer each its own way; a container answers both by its room.
 */
export const DropBy = { HAND: 0, PLACER: 1 } as const;
export type DropBy = typeof DropBy[keyof typeof DropBy];

/** The side of an entity that a hand or a placer puts items into */
export interface DropPort {
    /** How many of the `held` items of `item` it takes now from `by`: none while it has no room */
    accepts(item: ItemName, held: number, by: DropBy): number;
    /** Puts in `amount` of `item`, which `accepts` allowed */
    insert(item: ItemName, amount: number): void;
}

/** The side of an entity that a hand takes items from */
export interface PickupPort {
    /** Whether it can give at least one of the item now */
    has(item: ItemName): boolean;
    /** What it can give of the item now */
    getCurrentQuantity(item: ItemName): number;
    /** Takes out `amount` of `item`, no more than it can give */
    take(item: ItemName, amount: number): void;
}
