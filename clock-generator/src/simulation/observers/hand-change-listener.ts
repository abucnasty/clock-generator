import type { InserterHandContents, InserterState } from "../../state/inserter-state";
import type { InserterObserver } from "./observer";

type OnHandChange = (current: InserterHandContents | null) => void;

/**
 * Tells of each tick an inserter's hand changes, its item or its quantity (the debug log), with the hand as it is then.
 * It keeps the last item and quantity it saw, not a copy of the hand.
 */
export class HandChangeListener implements InserterObserver {
    /** The item the hand held when last seen, undefined for an empty hand */
    private item_name: string | undefined = undefined;
    /** Its quantity then, undefined for an empty hand */
    private quantity: number | undefined = undefined;

    constructor(
        private readonly inserter_state: InserterState,
        private readonly onHandChange: OnHandChange,
    ) {}

    public onTick(): void {
        const current = this.inserter_state.held_item;
        const item_name = current?.item_name;
        const quantity = current?.quantity;
        if (item_name !== this.item_name || quantity !== this.quantity) {
            this.onHandChange(current);
        }
        this.item_name = item_name;
        this.quantity = quantity;
    }
}
