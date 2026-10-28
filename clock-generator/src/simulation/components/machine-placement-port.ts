import { ItemName } from "../../data";
import type { MachineState } from "../../state/machine-state";
import type { Ingress } from "./ingress";
import { DropBy, DropPort } from "./ports";

/**
 * The drop port of a machine a placer places into: the machine's Ingress, with the placer's rule (an ingredient up to
 * the drill's stop, `Ingress.accepts` by a placer) and its put (into the ingredients, never as fuel, `Ingress.place`),
 * as a drill and a machine that places its results itself fill it. A hand drops into the Ingress itself, so this view
 * answers a placer only.
 */
export class MachinePlacementPort implements DropPort {

    private readonly ingress: Ingress;

    constructor(state: MachineState) {
        this.ingress = state.ingress;
        this.ingress.bindPlacerStops();
    }

    public accepts(item: ItemName, held: number, by: DropBy): number {
        if (by !== DropBy.PLACER) {
            throw new Error("A machine's placement port takes from a placer only: hands drop into a machine's Ingress");
        }
        return this.ingress.accepts(item, held, by);
    }

    public insert(item: ItemName, amount: number): void {
        this.ingress.place(item, amount);
    }
}
