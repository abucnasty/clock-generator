import { handSizeFor } from "../../../entities";
import { OpenRange } from "../../../data-types";
import { InserterState, InserterStatus } from "../../../state";
import { TickProvider } from "../../current-tick-provider";
import type { InserterObserver } from "../../../simulation/archetypes/inserter";
import { InserterPhase, inserterStatusOf } from "../../../simulation/status-codes";


export interface TransferSnapshot {
    item_name: string;
    pickup_tick: number;
    /** The pickup tick as it was read when it happened, set when it was before the tick provider was last moved back */
    pickup_tick_before_reset?: number;
    tick_range: OpenRange;
    transition: {
        from_status: InserterStatus;
        to_status: InserterStatus;
    },
    amount: number;
}

type TransferStatusCallback = (snapshot: TransferSnapshot) => void

/**
 * What the tracker keeps of the last entry into and exit from one phase. The slot of a phase is made once and
 * overwritten in place at every change, so a warm-up of thousands of changes allocates nothing.
 */
interface StatusSlot {
    tick: number;
    /** The hand when the slot was written: the item's name and quantity, or no item for an empty hand */
    held_item_name: string | undefined;
    held_quantity: number;
}

export class InserterTransferTrackerPlugin implements InserterObserver {

    constructor(
        private readonly tick_provider: TickProvider,
        private readonly inserter_state: InserterState,
        private readonly callback: TransferStatusCallback,
        /**
         * Whether anything reads the transfers now. While it says no (a warm-up), the entry and exit ticks are still
         * tracked, since a transfer can start before the recorded run and end in it, but no snapshot is made.
         */
        private readonly isRecording: () => boolean = () => true,
    ) { }

    private entered_tick: Map<InserterPhase, StatusSlot> = new Map();
    private exited_tick: Map<InserterPhase, StatusSlot> = new Map();

    onStatusChange(from: InserterPhase, to: InserterPhase): void {
        // read before the slot of the phase being entered is overwritten (that may be the pickup's own)
        const last_pickup_tick = this.entered_tick.get(InserterPhase.PICKUP)?.tick;
        this.recordExitedTick(from);
        this.recordEnteredTick(to);

        if (from !== InserterPhase.SWING) {
            return;
        }

        if (to === InserterPhase.DROP) {
            return;
        }

        if (last_pickup_tick === undefined || !this.isRecording()) {
            return;
        }

        const exited = this.exited_tick.get(InserterPhase.PICKUP);
        const current_tick = this.tick_provider.getCurrentTick();

        // Clamp pickup_tick to 0 if it's from the warmup period (before simulation started)
        // This can happen when an inserter started picking up during warmup
        // but completed its transfer during the simulation period.
        // Warmup ticks are large positive numbers, so if pickup > current, it's from warmup.
        const picked_up_before_reset = last_pickup_tick > current_tick;
        const clamped_pickup_tick = picked_up_before_reset ? 0 : last_pickup_tick;

        const inserter_transfer: TransferSnapshot = {
            pickup_tick: clamped_pickup_tick,
            pickup_tick_before_reset: picked_up_before_reset ? last_pickup_tick : undefined,
            item_name: exited!.held_item_name ?? "unknown",
            tick_range: OpenRange.from(
                clamped_pickup_tick,
                current_tick,
            ),
            transition: {
                from_status: inserterStatusOf(from),
                to_status: inserterStatusOf(to),
            },
            // TODO: this assumes full transfer, should only work with stack inserters
            amount: exited!.held_item_name !== undefined ? exited!.held_quantity : handSizeFor(this.inserter_state.inserter, "")
        };
        this.callback(inserter_transfer);

    }

    private recordEnteredTick(phase: InserterPhase): void {
        this.writeSlot(this.entered_tick, phase);
    }
    private recordExitedTick(phase: InserterPhase): void {
        this.writeSlot(this.exited_tick, phase);
    }

    private writeSlot(slots: Map<InserterPhase, StatusSlot>, phase: InserterPhase): void {
        let slot = slots.get(phase);
        if (slot === undefined) {
            slot = { tick: 0, held_item_name: undefined, held_quantity: 0 };
            slots.set(phase, slot);
        }
        const held_item = this.inserter_state.held_item;
        slot.tick = this.tick_provider.getCurrentTick();
        slot.held_item_name = held_item?.item_name;
        slot.held_quantity = held_item?.quantity ?? 0;
    }

}
