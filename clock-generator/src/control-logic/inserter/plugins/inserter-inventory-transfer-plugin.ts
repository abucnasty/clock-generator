import { OpenRange } from "../../../data-types";
import { InserterState } from "../../../state";
import { TickProvider } from "../../current-tick-provider";
import { InventoryTransferHistory } from "../../../crafting/sequence/inventory-transfer-history";
import type { InserterObserver } from "../../../simulation/archetypes/inserter";
import { InserterPhase } from "../../../simulation/status-codes";
import { InserterTransferTrackerPlugin, TransferSnapshot } from "./inserter-transfer-tracker-plugin";

export class InserterInventoryHistoryPlugin implements InserterObserver {

    private readonly inserter_transfer_tracker_plugin: InserterTransferTrackerPlugin;

    constructor(
        private readonly tick_provider: TickProvider,
        private readonly inserter_state: InserterState,
        private readonly transfer_history: InventoryTransferHistory
    ) {
        this.inserter_transfer_tracker_plugin = new InserterTransferTrackerPlugin(
            this.tick_provider,
            this.inserter_state,
            this.recordTransferSnapshot.bind(this),
            () => this.transfer_history.recording,
        );
    }

    public onStatusChange(from: InserterPhase, to: InserterPhase): void {
        this.inserter_transfer_tracker_plugin.onStatusChange(from, to);
    }

    private recordTransferSnapshot(snapshot: TransferSnapshot): void {

        this.transfer_history.recordTransfer(
            this.inserter_state.entity_id,
            {
                item_name: snapshot.item_name,
                tick_range: OpenRange.from(
                    snapshot.tick_range.start_inclusive,
                    snapshot.tick_range.end_inclusive
                ),
                amount: snapshot.amount,
                pickup_tick_before_run: snapshot.pickup_tick_before_reset === undefined
                    ? undefined
                    : this.transfer_history.tickBeforeRun(snapshot.pickup_tick_before_reset),
            }
        )
    }
}