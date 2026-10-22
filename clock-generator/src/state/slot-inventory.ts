import { FactorioDataService, ItemName } from "../data";
import { isBlockedSlotFilter } from "../common/slot-filter";
import { InventoryItem, InventoryState, WritableInventoryState } from "./inventory-state";

/** One slot of an inventory: the only item it takes when it is filtered, and what it holds */
export interface InventorySlot {
    readonly filter: ItemName | null;
    item: ItemName | null;
    count: number;
}

/** The game keeps weights in 1/65536 parts: sums and the lift weight are exact in these units */
const WEIGHT_UNITS = 65536;

/** An item's weight in 1/65536 parts, as the game holds it */
export function weightUnitsOf(item: ItemName): number {
    return Math.round(FactorioDataService.itemWeightOrThrow(item) * WEIGHT_UNITS);
}

/** A weight in the game's units, from a weight as the data writes it */
export function weightUnits(weight: number): number {
    return Math.round(weight * WEIGHT_UNITS);
}

export interface SlotInventoryOptions {
    /** The slots and their filters; without slots, slots are added as items come (a rocket's inventory) */
    slot_filters?: readonly (ItemName | null)[];
    /** The weight the inventory holds at most, in 1/65536 parts; none without it */
    weight_limit?: number;
}

/**
 * An inventory of slots that can hold different items, as a car's trunk, a cargo wagon or a rocket's inventory.
 *
 * Where items go and where they are taken from, as seen once in Factorio 2.1.21 on a car (a candidate rule, to be
 * counted on the container fixtures): an item goes first into the slots filtered to it, in slot order, then tops up
 * the unfiltered slots that hold it, in slot order, then fills the empty unfiltered slots, in slot order; a slot
 * filtered to another item never takes it. An inserter takes the item of the last slot that holds one it may take,
 * from that slot and then the slots before it that hold the same item.
 *
 * The totals per item are kept in an InventoryState beside the slots, so its live records and generations serve the
 * readers of any inventory.
 */
export class SlotInventoryState implements WritableInventoryState {

    private readonly totals: InventoryState;
    private readonly growing: boolean;
    private readonly weight_limit: number | null;
    private weight_used = 0;
    private readonly stack_sizes = new Map<ItemName, number>();
    private readonly weights = new Map<ItemName, number>();

    constructor(
        options: SlotInventoryOptions,
        public readonly slots: InventorySlot[] = (options.slot_filters ?? []).map(filter => ({ filter, item: null, count: 0 })),
        totals?: InventoryState,
        weight_used = 0,
    ) {
        this.growing = options.slot_filters === undefined;
        this.weight_limit = options.weight_limit ?? null;
        this.totals = totals ?? InventoryState.empty();
        this.weight_used = weight_used;
    }

    private stackSize(item: ItemName): number {
        let size = this.stack_sizes.get(item);
        if (size === undefined) {
            size = FactorioDataService.findItemOrThrow(item).stack_size;
            this.stack_sizes.set(item, size);
        }
        return size;
    }

    private weightOf(item: ItemName): number {
        let weight = this.weights.get(item);
        if (weight === undefined) {
            weight = weightUnitsOf(item);
            this.weights.set(item, weight);
        }
        return weight;
    }

    /** How many of the item go in now: the room in the slots that take it, and what the weight left allows */
    public roomFor(item: ItemName): number {
        if (isBlockedSlotFilter(item)) return 0;
        const stack = this.stackSize(item);
        let room = this.growing ? Infinity : 0;
        if (!this.growing) {
            for (const slot of this.slots) {
                if (slot.filter === item || (slot.filter === null && (slot.item === null || slot.item === item))) {
                    room += stack - (slot.item === item ? slot.count : 0);
                }
            }
        }
        if (this.weight_limit !== null) {
            room = Math.min(room, Math.floor((this.weight_limit - this.weight_used) / this.weightOf(item)));
        }
        return Math.max(0, room);
    }

    /** The items the slots take in all, the others empty: the slots filtered to it and the unfiltered ones */
    public capacityFor(item: ItemName): number {
        if (isBlockedSlotFilter(item)) return 0;
        if (this.growing) {
            return this.weight_limit === null ? Infinity : Math.floor(this.weight_limit / this.weightOf(item));
        }
        const slots = this.slots.filter(slot => slot.filter === null || slot.filter === item).length;
        return slots * this.stackSize(item);
    }

    /** The item of the last slot holding one that `allowed` lets through, or null */
    public lastItemAmong(allowed: (item: ItemName) => boolean): ItemName | null {
        for (let index = this.slots.length - 1; index >= 0; index--) {
            const item = this.slots[index].item;
            if (item !== null && allowed(item)) {
                return item;
            }
        }
        return null;
    }

    /** Puts a slot's contents in as they are, for a container that does not start empty */
    public placeInSlot(slot_index: number, item: ItemName, count: number): void {
        const slot = this.slots[slot_index];
        if (isBlockedSlotFilter(item) || slot === undefined || slot.item !== null || (slot.filter !== null && slot.filter !== item) || count > this.stackSize(item)) {
            throw new Error(`Slot ${slot_index + 1} cannot hold ${count} ${item}`);
        }
        slot.item = item;
        slot.count = count;
        this.weight_used += this.weightOf(item) * count;
        this.totals.addQuantity(item, count);
    }

    public addQuantity(itemName: string, amount: number): void {
        if (amount < 0) {
            throw new Error(`Cannot add negative amount: ${amount}`);
        }
        if (amount > this.roomFor(itemName)) {
            throw new Error(`No room for ${amount} ${itemName}: ${this.roomFor(itemName)} fit`);
        }
        const stack = this.stackSize(itemName);
        let left = amount;
        const fill = (slot: InventorySlot) => {
            const put = Math.min(left, stack - slot.count);
            if (put > 0) {
                slot.item = itemName;
                slot.count += put;
                left -= put;
            }
        };
        for (const slot of this.slots) {
            if (left > 0 && slot.filter === itemName) fill(slot);
        }
        for (const slot of this.slots) {
            if (left > 0 && slot.filter === null && slot.item === itemName) fill(slot);
        }
        for (const slot of this.slots) {
            if (left > 0 && slot.filter === null && slot.item === null) fill(slot);
        }
        while (left > 0 && this.growing) {
            const slot: InventorySlot = { filter: null, item: null, count: 0 };
            this.slots.push(slot);
            fill(slot);
        }
        this.weight_used += this.weightOf(itemName) * amount;
        this.totals.addQuantity(itemName, amount);
    }

    public removeQuantity(itemName: string, amount: number): void {
        if (amount < 0) {
            throw new Error(`Cannot remove negative amount: ${amount}`);
        }
        const current = this.totals.getQuantity(itemName);
        if (current < amount) {
            throw new Error(`Insufficient inventory: have ${current}, need ${amount} of ${itemName}`);
        }
        let left = amount;
        for (let index = this.slots.length - 1; index >= 0 && left > 0; index--) {
            const slot = this.slots[index];
            if (slot.item !== itemName) continue;
            const taken = Math.min(left, slot.count);
            slot.count -= taken;
            left -= taken;
            if (slot.count === 0) slot.item = null;
        }
        this.weight_used -= this.weightOf(itemName) * amount;
        this.totals.removeQuantity(itemName, amount);
    }

    public setQuantity(itemName: string, amount: number): void {
        if (amount < 0) {
            throw new Error(`Cannot set negative amount: ${amount}`);
        }
        const current = this.totals.getQuantity(itemName);
        if (amount < current) {
            this.removeQuantity(itemName, current - amount);
        } else {
            this.addQuantity(itemName, amount - current);
        }
    }

    public clear(): void {
        for (const slot of this.slots) {
            slot.item = null;
            slot.count = 0;
        }
        this.weight_used = 0;
        this.totals.clear();
    }

    public resetItem(itemName: string): void {
        for (const slot of this.slots) {
            if (slot.item === itemName) {
                this.weight_used -= this.weightOf(itemName) * slot.count;
                slot.item = null;
                slot.count = 0;
            }
        }
        this.totals.resetItem(itemName);
    }

    public getItem(itemName: string): InventoryItem | null { return this.totals.getItem(itemName); }
    public getItemOrThrow(itemName: string): InventoryItem { return this.totals.getItemOrThrow(itemName); }
    public getQuantity(itemName: string): number { return this.totals.getQuantity(itemName); }
    public hasQuantity(itemName: string, amount: number): boolean { return this.totals.hasQuantity(itemName, amount); }
    public getItems(): InventoryItem[] { return this.totals.getItems(); }
    public getAllItems(): InventoryItem[] { return this.totals.getAllItems(); }
    public getTotalQuantity(): number { return this.totals.getTotalQuantity(); }
    public isEmpty(): boolean { return this.totals.isEmpty(); }
    public export(): Record<ItemName, number> { return this.totals.export(); }
    public recordOf(itemName: string): InventoryItem | null { return this.totals.recordOf(itemName); }
    public get structure_generation(): number { return this.totals.structure_generation; }
    public get mutation_generation(): number { return this.totals.mutation_generation; }

    /** The slots as text, for the simulation's state key: where the items are decides what is taken next */
    public slotKey(): string {
        return this.slots.map(slot => slot.item === null ? "" : `${slot.item}:${slot.count}`).join("|");
    }

    public clone(): SlotInventoryState {
        return new SlotInventoryState(
            { slot_filters: this.growing ? undefined : this.slots.map(slot => slot.filter), weight_limit: this.weight_limit ?? undefined },
            this.slots.map(slot => ({ ...slot })),
            InventoryState.clone(this.totals),
            this.weight_used,
        );
    }
}
