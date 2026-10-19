import { ItemName } from "../data";
import { InventoryItem, InventoryState, ReadableInventoryState, WritableInventoryState } from "./inventory-state";

/**
 * An inventory state that maintains constant item quantities.
 * 
 * All mutating operations (add, remove, set, clear) are no-ops.
 * This is useful for simulating infinite sources like belts or infinity chests
 * where the inventory should never change regardless of insertions or withdrawals.
 */
export class ConstantInventoryState implements WritableInventoryState {

    public static fromInventoryState(state: ReadableInventoryState): ConstantInventoryState {
        return new ConstantInventoryState(state);
    }

    public static fromMap(items: Map<ItemName, number>): ConstantInventoryState {
        return new ConstantInventoryState(InventoryState.fromMap(items));
    }

    public static fromRecord(items: Record<ItemName, number>): ConstantInventoryState {
        return new ConstantInventoryState(InventoryState.fromRecord(items));
    }

    constructor(
        private readonly readable_inventory_state: ReadableInventoryState
    ) {}

    public getItem(itemName: string): InventoryItem | null {
        return this.readable_inventory_state.getItem(itemName);
    }

    public getItemOrThrow(itemName: string): InventoryItem {
        return this.readable_inventory_state.getItemOrThrow(itemName);
    }

    public recordOf(itemName: string): InventoryItem | null {
        return this.readable_inventory_state.recordOf(itemName);
    }

    public get structure_generation(): number {
        return this.readable_inventory_state.structure_generation;
    }

    public get mutation_generation(): number {
        return this.readable_inventory_state.mutation_generation;
    }

    public getQuantity(itemName: string): number {
        return this.readable_inventory_state.getQuantity(itemName);
    }

    public hasQuantity(itemName: string, amount: number): boolean {
        return this.readable_inventory_state.hasQuantity(itemName, amount);
    }

    public getItems(): InventoryItem[] {
        return this.readable_inventory_state.getItems();
    }

    public getAllItems(): InventoryItem[] {
        return this.readable_inventory_state.getAllItems();
    }

    public getTotalQuantity(): number {
        return this.readable_inventory_state.getTotalQuantity();
    }

    public isEmpty(): boolean {
        return this.readable_inventory_state.isEmpty();
    }

    // Mutating operations are no-ops - inventory stays constant

    public addQuantity(_itemName: string, _quantity: number): void {
        // NOOP: constant inventory cannot be modified
    }

    public removeQuantity(_itemName: string, _quantity: number): void {
        // NOOP: constant inventory cannot be modified
    }

    public setQuantity(_itemName: string, _amount: number): void {
        // NOOP: constant inventory cannot be modified
    }

    public clear(): void {
        // NOOP: constant inventory cannot be modified
    }

    public resetItem(_itemName: string): void {
        // NOOP: constant inventory cannot be modified
    }

    public export(): Record<ItemName, number> {
        return this.readable_inventory_state.export();
    }

    public clone(): WritableInventoryState {
        return new ConstantInventoryState(this.readable_inventory_state.clone());
    }
}
