import { FactorioDataService, ItemName } from "../data";
import { InventoryItem, InventoryState, WritableInventoryState } from "./inventory-state";
import { SlotInventoryState } from "./slot-inventory";

/** Where a rocket silo puts an item an inserter brings, and how much of it its input slots take */
export interface RocketSiloRouting {
    /** Whether the item goes into the input slots (an ingredient of its recipe, of the recipe's quality) */
    toInput(item: ItemName): boolean;
    /** The automated insertion limit of an ingredient that goes into the input slots */
    insertionLimit(item: ItemName): number;
    /** The rocket's lift weight, in 1/65536 parts */
    readonly lift_weight: number;
}

/**
 * A rocket silo's items: its input slots and its rocket inventory, with the totals of both in one InventoryState for
 * the readers of any inventory. Seen once in Factorio 2.1.21, with no rocket built and no craft run:
 * - an ingredient of the silo's recipe goes into its input slot while the slot holds less than the automated insertion
 *   limit, a whole hand at once (16 at a limit of 2), and an inserter brings no more once it is at the limit;
 * - any other item, and the ingredients when the recipe is of another quality, go into the rocket inventory, as far as
 *   the weight the rocket lifts allows: 1,000 iron plates of 1,000,000; a hand that does not fit goes in in part;
 * - an inserter takes only from the rocket inventory, the last slot first, never from the input slots.
 * No craft is run, so the input slots stay as they are filled.
 */
export class RocketSiloInventoryState implements WritableInventoryState {

    constructor(
        private readonly routing: RocketSiloRouting,
        public readonly rocket: SlotInventoryState = new SlotInventoryState({ weight_limit: routing.lift_weight }),
        public readonly input: InventoryState = InventoryState.empty(),
        private readonly totals: InventoryState = InventoryState.empty(),
    ) { }

    /** How many of the item go in now */
    public roomFor(item: ItemName): number {
        if (this.routing.toInput(item)) {
            const stock = this.input.getQuantity(item);
            const stack = FactorioDataService.findItemOrThrow(item).stack_size;
            return stock < this.routing.insertionLimit(item) ? Math.max(0, stack - stock) : 0;
        }
        return this.rocket.roomFor(item);
    }

    /** What an inserter can take of the item: what the rocket inventory holds */
    public suppliedQuantity(item: ItemName): number {
        return this.rocket.getQuantity(item);
    }

    /** What the silo starts with: an ingredient in its input slot (at most a stack), any other item as an inserter puts it */
    public placeAtStart(item: ItemName, count: number): void {
        if (!this.routing.toInput(item)) {
            this.addQuantity(item, count);
            return;
        }
        const stack = FactorioDataService.findItemOrThrow(item).stack_size;
        if (this.input.getQuantity(item) + count > stack) {
            throw new Error(`The input slot of ${item} holds a stack of ${stack} at most`);
        }
        this.input.addQuantity(item, count);
        this.totals.addQuantity(item, count);
    }

    public addQuantity(itemName: string, amount: number): void {
        if (this.routing.toInput(itemName)) {
            if (amount > this.roomFor(itemName)) {
                throw new Error(`No room for ${amount} ${itemName} in the input slot: ${this.roomFor(itemName)} fit`);
            }
            this.input.addQuantity(itemName, amount);
        } else {
            this.rocket.addQuantity(itemName, amount);
        }
        this.totals.addQuantity(itemName, amount);
    }

    /** Takes from the rocket inventory only: the input slots give nothing */
    public removeQuantity(itemName: string, amount: number): void {
        this.rocket.removeQuantity(itemName, amount);
        this.totals.removeQuantity(itemName, amount);
    }

    public setQuantity(itemName: string, amount: number): void {
        this.resetItem(itemName);
        this.addQuantity(itemName, amount);
    }

    public clear(): void {
        this.rocket.clear();
        this.input.clear();
        this.totals.clear();
    }

    public resetItem(itemName: string): void {
        this.rocket.resetItem(itemName);
        this.input.resetItem(itemName);
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

    public slotKey(): string {
        return `${this.rocket.slotKey()}#${JSON.stringify(Object.entries(this.input.export()).sort(([a], [b]) => a.localeCompare(b)))}`;
    }

    public clone(): RocketSiloInventoryState {
        return new RocketSiloInventoryState(this.routing, this.rocket.clone(), InventoryState.clone(this.input), InventoryState.clone(this.totals));
    }
}
