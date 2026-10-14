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
}

export interface WritableInventoryState extends ReadableInventoryState {
    addQuantity(itemName: string, amount: number): void;
    removeQuantity(itemName: string, amount: number): void;
    setQuantity(itemName: string, amount: number): void;
    clear(): void;
    resetItem(itemName: string): void;
    clone(): WritableInventoryState;
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

    private inventory: Map<string, number>;

    constructor(initialInventory?: Record<string, number>) {
        this.inventory = new Map(Object.entries(initialInventory || {}));
    }

    public getItem(itemName: string): InventoryItem | null {
        const quantity = this.inventory.get(itemName);
        if (quantity === undefined) {
            return null;
        }
        return { item_name: itemName, quantity };
    }

    public getItemOrThrow(itemName: string): InventoryItem {
        const item = this.getItem(itemName);
        if (item === null) {
            throw new Error(`Item not found in inventory: ${itemName}`);
        }
        return item;
    }

    public getQuantity(itemName: string): number {
        return this.inventory.get(itemName) ?? 0;
    }

    public addQuantity(itemName: string, amount: number): void {
        if (amount < 0) {
            throw new Error(`Cannot add negative amount: ${amount}`);
        }
        const current = this.getQuantity(itemName);
        this.inventory.set(itemName, current + amount);
    }

    public removeQuantity(itemName: string, amount: number): void {
        if (amount < 0) {
            throw new Error(`Cannot remove negative amount: ${amount}`);
        }
        const current = this.getQuantity(itemName);
        if (current < amount) {
            throw new Error(`Insufficient inventory: have ${current}, need ${amount} of ${itemName}`);
        }
        this.inventory.set(itemName, current - amount);
    }

    public setQuantity(itemName: string, amount: number): void {
        if (amount < 0) {
            throw new Error(`Cannot set negative amount: ${amount}`);
        }
        this.inventory.set(itemName, amount);
    }

    public hasQuantity(itemName: string, amount: number): boolean {
        return this.getQuantity(itemName) >= amount;
    }

    public getItems(): InventoryItem[] {
        return Array.from(this.inventory.entries())
            .filter(([_, quantity]) => quantity > 0)
            .map(([itemName, quantity]) => ({ item_name: itemName, quantity }));
    }

    public getAllItems(): InventoryItem[] {
        return Array.from(this.inventory.entries())
            .map(([itemName, quantity]) => ({ item_name: itemName, quantity }));
    }

    public clear(): void {
        this.inventory.clear();
    }

    public resetItem(itemName: string): void {
        this.inventory.delete(itemName);
    }

    public getTotalQuantity(): number {
        return Array.from(this.inventory.values()).reduce((sum, qty) => sum + qty, 0);
    }

    public export(): Record<ItemName, number> {
        return Object.fromEntries(this.inventory);
    }

    public isEmpty(): boolean {
        return this.getTotalQuantity() === 0;
    }

    public clone(): WritableInventoryState {
        return InventoryState.clone(this);
    }
}