import { ItemName } from "../data";
import { MachineInput } from "../entities";

export interface InventoryItem {
    readonly item_name: string;
    quantity: number;
}


export interface ReadableInventoryState {
    getItem(itemName: string): InventoryItem | null;
    getItemOrThrow(itemName: string): InventoryItem;
    getQuantity(itemName: string): number;
    hasQuantity(itemName: string, amount: number): boolean;
    getItems(): InventoryItem[];
    getAllItems(): InventoryItem[];
    getTotalQuantity(): number;
    isEmpty(): boolean;
    export(): Record<ItemName, number>;
    clone(): ReadableInventoryState;
    /**
     * The live record of an item, whose `quantity` follows the inventory, or null for an item without a slot (zero
     * counts as a slot). A record is detached when its slot goes away, which `structure_generation` tells (see
     * LiveQuantity, which reads these two correctly).
     */
    recordOf(itemName: string): InventoryItem | null;
    /** Moves whenever records may have detached: on `clear` and `resetItem` */
    readonly structure_generation: number;
}

export interface WritableInventoryState extends ReadableInventoryState {
    addQuantity(itemName: string, amount: number): void;
    removeQuantity(itemName: string, amount: number): void;
    setQuantity(itemName: string, amount: number): void;
    clear(): void;
    resetItem(itemName: string): void;
    clone(): WritableInventoryState;
}

/**
 * An item's quantity in one inventory, read off its live record: one map lookup buys all later reads, where
 * `getQuantity` pays one per ask. The record is fetched again when the inventory's structure moved (`clear`,
 * `resetItem`); an item without a slot answers 0, as `getQuantity` does, and is asked for again each time, since
 * `addQuantity` can give it a slot without moving the structure.
 */
export class LiveQuantity {
    private record: InventoryItem | null = null;
    private generation = -1;

    constructor(
        private readonly inventory: ReadableInventoryState,
        private readonly item_name: string,
    ) { }

    public get(): number {
        let record = this.record;
        if (record === null || this.generation !== this.inventory.structure_generation) {
            this.generation = this.inventory.structure_generation;
            record = this.record = this.inventory.recordOf(this.item_name);
            if (record === null) {
                return 0;
            }
        }
        return record.quantity;
    }
}

export class InventoryState implements WritableInventoryState {

    public static createFromMachineInputs(machineInputs: Map<string, MachineInput>): InventoryState {
        const inventory = this.empty();
        for (const itemName of machineInputs.keys()) {
            inventory.addQuantity(itemName, 0);
        }
        return inventory;
    }

    public static createEmptyForSingleItem(itemName: string): InventoryState {
        const inventory = this.empty();
        inventory.addQuantity(itemName, 0);
        return inventory;
    }

    public static empty(): InventoryState {
        return new InventoryState();
    }

    public static clone(inventoryState: InventoryState): InventoryState {
        return new InventoryState(inventoryState.export());
    }

    public static fromRecord(items: Record<string, number>): InventoryState {
        return new InventoryState(items);
    }

    public static fromMap(items: Map<string, number>): InventoryState {
        return new InventoryState(Object.fromEntries(items));
    }

    /** One live record per item; the quantity is changed in place, so a `recordOfOrThrow` ref stays current */
    private inventory: Map<string, InventoryItem>;

    constructor(initialInventory?: Record<string, number>) {
        this.inventory = new Map(Object.entries(initialInventory || {}).map(
            ([item_name, quantity]) => [item_name, { item_name, quantity }]));
    }

    public getItem(itemName: string): InventoryItem | null {
        const record = this.inventory.get(itemName);
        if (record === undefined) {
            return null;
        }
        return { item_name: itemName, quantity: record.quantity };
    }

    public getItemOrThrow(itemName: string): InventoryItem {
        const item = this.getItem(itemName);
        if (item === null) {
            throw new Error(`Item not found in inventory: ${itemName}`);
        }
        return item;
    }

    public recordOf(itemName: string): InventoryItem | null {
        return this.inventory.get(itemName) ?? null;
    }

    public structure_generation = 0;

    public getQuantity(itemName: string): number {
        const record = this.inventory.get(itemName);
        return record === undefined ? 0 : record.quantity;
    }

    public addQuantity(itemName: string, amount: number): void {
        if (amount < 0) {
            throw new Error(`Cannot add negative amount: ${amount}`);
        }
        const record = this.inventory.get(itemName);
        if (record === undefined) {
            this.inventory.set(itemName, { item_name: itemName, quantity: amount });
        } else {
            record.quantity += amount;
        }
    }

    public removeQuantity(itemName: string, amount: number): void {
        if (amount < 0) {
            throw new Error(`Cannot remove negative amount: ${amount}`);
        }
        const record = this.inventory.get(itemName);
        const current = record === undefined ? 0 : record.quantity;
        if (current < amount) {
            throw new Error(`Insufficient inventory: have ${current}, need ${amount} of ${itemName}`);
        }
        if (record === undefined) {
            this.inventory.set(itemName, { item_name: itemName, quantity: current - amount });
        } else {
            record.quantity -= amount;
        }
    }

    public setQuantity(itemName: string, amount: number): void {
        if (amount < 0) {
            throw new Error(`Cannot set negative amount: ${amount}`);
        }
        const record = this.inventory.get(itemName);
        if (record === undefined) {
            this.inventory.set(itemName, { item_name: itemName, quantity: amount });
        } else {
            record.quantity = amount;
        }
    }

    public hasQuantity(itemName: string, amount: number): boolean {
        return this.getQuantity(itemName) >= amount;
    }

    public getItems(): InventoryItem[] {
        return Array.from(this.inventory.values())
            .filter(record => record.quantity > 0)
            .map(record => ({ item_name: record.item_name, quantity: record.quantity }));
    }

    public getAllItems(): InventoryItem[] {
        return Array.from(this.inventory.values())
            .map(record => ({ item_name: record.item_name, quantity: record.quantity }));
    }

    public clear(): void {
        this.inventory.clear();
        this.structure_generation++;
    }

    public resetItem(itemName: string): void {
        this.inventory.delete(itemName);
        this.structure_generation++;
    }

    public getTotalQuantity(): number {
        let sum = 0;
        for (const record of this.inventory.values()) {
            sum += record.quantity;
        }
        return sum;
    }

    public export(): Record<ItemName, number> {
        const exported: Record<ItemName, number> = {};
        for (const record of this.inventory.values()) {
            exported[record.item_name] = record.quantity;
        }
        return exported;
    }

    public isEmpty(): boolean {
        return this.getTotalQuantity() === 0;
    }

    public clone(): WritableInventoryState {
        return InventoryState.clone(this);
    }
}
