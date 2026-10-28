import { ItemName } from "../../data";
import type { MachineState } from "../../state/machine-state";
import type { Ingress, PlacerInput } from "./ingress";
import { DropBy, DropPort } from "./ports";

/**
 * The drop port of a machine a placer places into: the machine's Ingress, with the placer's rule (an ingredient up to
 * the drill's stop, `Ingress.accepts` by a placer) and its put (into the ingredients, never as fuel, `Ingress.place`),
 * as a drill and a machine that places its results itself fill it. A hand drops into the Ingress itself, so this view
 * answers a placer only.
 *
 * The items the placer places are bound once, at build (its results are fixed): a tick answers them by the ingredient's
 * live quantity and stop, without a lookup. Any other item is answered by the Ingress.
 */
export class MachinePlacementPort implements DropPort {

    private readonly ingress: Ingress;
    /** The bound inputs of `items`, null for an item the machine does not craft with */
    private readonly inputs: readonly (PlacerInput | null)[];

    constructor(
        state: MachineState,
        /** What the placer places: a drill's mined item, a machine's results */
        private readonly items: readonly ItemName[] = [],
    ) {
        this.ingress = state.ingress;
        this.ingress.bindPlacerStops();
        this.inputs = items.map(item => this.ingress.placerInputOf(item));
    }

    public accepts(item: ItemName, held: number, by: DropBy): number {
        if (by !== DropBy.PLACER) {
            throw new Error("A machine's placement port takes from a placer only: hands drop into a machine's Ingress");
        }
        const index = this.indexOf(item);
        if (index < 0) {
            return this.ingress.accepts(item, held, by);
        }
        const input = this.inputs[index];
        if (input === null) {
            return 0;
        }
        return Math.min(held, Math.max(0, input.stop - input.quantity.get()));
    }

    public insert(item: ItemName, amount: number): void {
        const index = this.indexOf(item);
        const input = index < 0 ? null : this.inputs[index];
        if (input === null) {
            this.ingress.place(item, amount);
            return;
        }
        input.inventory.addQuantity(item, amount);
    }

    private indexOf(item: ItemName): number {
        const items = this.items;
        for (let index = 0; index < items.length; index++) {
            if (items[index] === item) {
                return index;
            }
        }
        return -1;
    }
}
