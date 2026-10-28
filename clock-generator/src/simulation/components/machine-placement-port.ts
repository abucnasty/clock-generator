import { FactorioDataService, ItemName } from "../../data";
import { directMachineStop } from "../../entities/drill/mining-drill-ext";
import type { WritableInventoryState } from "../../state/inventory-state";
import type { MachineState } from "../../state/machine-state";
import { DropBy, DropPort } from "./ports";

/** An ingredient a placer can put into the machine: its stop, and whether it is kept apart as a self-ingredient */
interface PlacedIngredient {
    readonly stop: number;
    readonly self: boolean;
}

/**
 * The drop port of a machine a placer places into: its ingredients, each up to the drill's stop (the larger of the item's
 * stack and the ingredient's insertion limit, + 64; `directMachineStop`), as a drill and a machine that places its
 * results itself fill it. Only an ingredient of the recipe goes in, never as fuel. A thin port over the machine's state:
 * the machine's Ingress (R11) takes it over. Hands still drop into a machine by their own logic (R14), so it answers a
 * placer only.
 */
export class MachinePlacementPort implements DropPort {

    /** Per ingredient, bound at build: the stop from the item's stack in the game data, as the placed item carries it */
    private readonly ingredients: ReadonlyMap<ItemName, PlacedIngredient>;

    constructor(private readonly state: MachineState) {
        const machine = state.machine;
        this.ingredients = new Map(Array.from(machine.inputs, ([item, input]) => [item, {
            stop: directMachineStop(FactorioDataService.findItemOrThrow(item).stack_size, input.automated_insertion_limit.quantity),
            self: machine.self_ingredients.has(item),
        }]));
    }

    public accepts(item: ItemName, held: number, by: DropBy): number {
        if (by !== DropBy.PLACER) {
            throw new Error("A machine's placement port takes from a placer only: hands drop into a machine by their own logic");
        }
        const ingredient = this.ingredients.get(item);
        if (ingredient === undefined) {
            return 0;
        }
        const room = Math.max(0, ingredient.stop - this.inventoryOf(ingredient).getQuantity(item));
        return Math.min(held, room);
    }

    public insert(item: ItemName, amount: number): void {
        this.inventoryOf(this.ingredients.get(item)!).addQuantity(item, amount);
    }

    /** Where the machine keeps the ingredient: with its output, or apart where the recipe also makes it */
    private inventoryOf(ingredient: PlacedIngredient): WritableInventoryState {
        return ingredient.self ? this.state.selfIngredients : this.state.inventoryState;
    }
}
