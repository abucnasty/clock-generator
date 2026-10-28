import { ItemName } from "../../data";
import { InserterStatus } from "../../state/entity-status";
import type { InserterState } from "../../state/inserter-state";
import type { LiveQuantity } from "../../state/inventory-state";
import type { MachineState } from "../../state/machine-state";
import { InserterPhase } from "../status-codes";
import type { Control } from "./control";
import { CarriedItems, HandDropPort, HandPickupPort, HandReason, HandScratch, takeIntoHand } from "./hand";
import type { MachineOutputPort } from "./machine-output-port";
import type { MachineWakes } from "./machine-wakes";

/**
 * A crafting machine's pickup port, its output, as one hand reaches it: any of its results the hand carries,
 * by-products too, a partly filled hand only more of its own item, up to the hand. The takers of one machine are updated
 * in one fixed order (InserterUpdates): the first takes up to its hand, and what is left is there for the next in the
 * same tick. A pickup that finds nothing to take sets the inserter idle itself, with no event (same-tick rule 11); a
 * take in the first tick of a window marks the machine's Wakes (rule 3). The idle rule starts a pickup where the output
 * holds any of the hand's items, a partly filled hand's own item only.
 */
export class MachineHandPickup implements HandPickupPort {

    /** The machine's results that the hand's filter lets it take, in the machine's order */
    private readonly offered: readonly ItemName[];
    /** What the output holds of each of `offered`, bound at build */
    private readonly offered_quantities: readonly LiveQuantity[];
    /** What the output holds of each item the hand carries, in the hand's order, bound at build */
    private readonly quantities: readonly LiveQuantity[];
    private readonly output: MachineOutputPort;
    private readonly wakes: MachineWakes;

    constructor(
        private readonly state: InserterState,
        private readonly scratch: HandScratch,
        private readonly items: CarriedItems,
        /** The sink's drop port: whether it takes an item now */
        private readonly sink: HandDropPort,
        source: MachineState,
        /**
         * The hand's Control: where the decider of the inserter's clock of the game stands in the order they are built,
         * when known, read at the take that marks the machine (after a control swap, the new control's)
         */
        private readonly control?: Control,
    ) {
        this.output = source.output;
        this.wakes = source.wakes;
        this.offered = source.machine.outputs.map(output => output.item_name).filter(item => items.lets(item));
        this.offered_quantities = this.offered.map(item => source.output.quantityOf(item));
        this.quantities = items.names.map(item => source.output.quantityOf(item));
    }

    public enter(from: InserterPhase): void {
        const scratch = this.scratch;
        scratch.pickup_ticks = 0;
        scratch.window_opened = from === InserterPhase.DISABLED;
        scratch.ticks_in_pickup = 0;
    }

    public key(): string {
        return String(this.scratch.pickup_ticks);
    }

    /** What the output holds of the item in the hand, else of the first item the hand carries that it holds at all */
    public startsPickup(): boolean {
        const held = this.state.held_item;
        if (held !== null) {
            const index = this.items.indexOf(held.item_name);
            const quantity = index >= 0 ? this.quantities[index].get() : this.output.getCurrentQuantity(held.item_name);
            return quantity >= 1 && this.starts(held.item_name, quantity);
        }
        const quantities = this.quantities;
        for (let index = 0; index < quantities.length; index++) {
            const quantity = quantities[index].get();
            if (quantity >= 1) {
                return this.starts(this.items.names[index], quantity);
            }
        }
        return false;
    }

    /** A start of the pickup, its reason written for the change: what the machine has of the item */
    private starts(item: ItemName, quantity: number): true {
        const scratch = this.scratch;
        scratch.reason = HandReason.MACHINE_HAS;
        scratch.reason_item = item;
        scratch.reason_quantity = quantity;
        return true;
    }

    public pickup(): void {
        const scratch = this.scratch;
        scratch.ticks_in_pickup += 1;
        if (!this.offersAnything()) {
            this.state.status = InserterStatus.IDLE;
            return;
        }
        scratch.pickup_ticks += 1;
        this.take();
    }

    /** Whether the output holds any result the hand takes: a partly filled hand only takes more of its own item */
    private offersAnything(): boolean {
        const held = this.state.held_item;
        const offered = this.offered;
        for (let index = 0; index < offered.length; index++) {
            if ((held === null || held.item_name === offered[index]) && this.offered_quantities[index].get() >= 1) {
                return true;
            }
        }
        return false;
    }

    private take(): void {
        const state = this.state;
        const held = state.held_item;
        let item: ItemName;
        let output_quantity: number;
        if (held !== null) {
            // as from a belt, a hand stops filling while the machine it puts into takes nothing of its item
            if (!this.sink.takes(held.item_name)) {
                return;
            }
            item = held.item_name;
            const index = this.items.indexOf(item);
            output_quantity = index >= 0 ? this.quantities[index].get() : this.output.getCurrentQuantity(item);
        } else {
            // the first item the hand carries that the machine has and the sink takes
            const index = this.firstTaken();
            if (index < 0) {
                return;
            }
            item = this.items.names[index];
            output_quantity = this.quantities[index].get();
        }

        const pickup_quantity = Math.min(this.items.handSizeOf(item) - (held === null ? 0 : held.quantity), output_quantity);
        if (pickup_quantity <= 0) {
            return;
        }

        takeIntoHand(state, this.scratch, item, pickup_quantity);
        this.output.take(item, pickup_quantity);
        if (this.scratch.window_opened && this.scratch.ticks_in_pickup === 1) {
            this.wakes.markWindowOpeningTake(this.control?.decider_build_order ?? -1);
        }
    }

    private firstTaken(): number {
        const quantities = this.quantities;
        for (let index = 0; index < quantities.length; index++) {
            if (quantities[index].get() > 0 && this.sink.takesAt(index)) {
                return index;
            }
        }
        return -1;
    }
}
