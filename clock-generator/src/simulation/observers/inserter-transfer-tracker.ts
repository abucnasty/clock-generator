import type { TickProvider } from "../current-tick-provider";
import type { InventoryTransferHistory } from "../../crafting/sequence/inventory-transfer-history";
import { OpenRange } from "../../data-types";
import { handSizeFor } from "../../entities";
import type { InserterState } from "../../state";
import { InserterPhase } from "../status-codes";
import type { InserterObserver } from "./observer";

/** The last entry into or exit from one phase: when, and the hand then (no item for an empty hand) */
interface PhaseSlot {
    tick: number;
    held_item_name: string | undefined;
    held_quantity: number;
}

/**
 * Records an inserter's transfers into the run's transfer history, from its changes of phase: a transfer runs from the
 * start of the pickup to the end of the swing that brings the hand back (one that ends in anything but the drop), with
 * the item and the quantity the hand held as it left the pickup.
 *
 * While the history does not record (a warm-up) the entries and exits are still tracked, since a transfer can start
 * before the recorded run and end in it; it is then recorded from the run's first tick, with its pickup tick before the
 * run beside it. The slot of a phase is made at its first change and written in place after, so a warm-up of thousands
 * of changes makes nothing.
 */
export class InserterTransferTracker implements InserterObserver {
    /** The last entry into each phase, by its code */
    private readonly entered: (PhaseSlot | undefined)[] = [];
    /** The last exit from each phase, by its code */
    private readonly exited: (PhaseSlot | undefined)[] = [];

    constructor(
        private readonly tick_provider: TickProvider,
        private readonly inserter_state: InserterState,
        private readonly transfer_history: InventoryTransferHistory,
    ) { }

    public onStatusChange(from: InserterPhase, to: InserterPhase): void {
        // read before the slot of the phase being entered is written (that may be the pickup's own)
        const last_pickup_tick = this.entered[InserterPhase.PICKUP]?.tick;
        this.write(this.exited, from);
        this.write(this.entered, to);

        if (from !== InserterPhase.SWING || to === InserterPhase.DROP) {
            return;
        }
        const history = this.transfer_history;
        if (last_pickup_tick === undefined || !history.recording) {
            return;
        }

        const exited = this.exited[InserterPhase.PICKUP]!;
        const current_tick = this.tick_provider.getCurrentTick();
        // A pickup in the warm-up (whose ticks are larger: the recorded ticks start again at 0) counts from the run's
        // first tick, with the tick it was read at kept apart
        const picked_up_before_reset = last_pickup_tick > current_tick;
        const pickup_tick = picked_up_before_reset ? 0 : last_pickup_tick;
        history.recordTransfer(this.inserter_state.entity_id, {
            item_name: exited.held_item_name ?? "unknown",
            tick_range: OpenRange.from(pickup_tick, current_tick),
            // TODO: this assumes full transfer, should only work with stack inserters
            amount: exited.held_item_name !== undefined ? exited.held_quantity : handSizeFor(this.inserter_state.inserter, ""),
            pickup_tick_before_run: picked_up_before_reset ? history.tickBeforeRun(last_pickup_tick) : undefined,
        });
    }

    private write(slots: (PhaseSlot | undefined)[], phase: InserterPhase): void {
        let slot = slots[phase];
        if (slot === undefined) {
            slot = { tick: 0, held_item_name: undefined, held_quantity: 0 };
            slots[phase] = slot;
        }
        const held_item = this.inserter_state.held_item;
        slot.tick = this.tick_provider.getCurrentTick();
        slot.held_item_name = held_item?.item_name;
        slot.held_quantity = held_item?.quantity ?? 0;
    }
}
