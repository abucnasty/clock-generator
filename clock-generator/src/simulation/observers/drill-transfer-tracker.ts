import type { TickProvider } from "../current-tick-provider";
import type { InventoryTransferHistory } from "../../crafting/sequence/inventory-transfer-history";
import { OpenRange } from "../../data-types";
import { Machine, MiningDrill, miningDrillMaxInsertion } from "../../entities";
import { DrillStatusCode } from "../status-codes";
import type { DrillObserver } from "./observer";

/**
 * Records the enabled runs of a drill into a machine into the run's transfer history, from its changes of status: a
 * run from the tick it is enabled to the tick it is disabled again, as a transfer of what the drill puts in at most.
 */
export class DrillTransferTracker implements DrillObserver {

    private last_enabled_tick: number | null = null;

    constructor(
        private readonly drill_entity: MiningDrill,
        private readonly sink_entity: Machine,
        private readonly tick_provider: TickProvider,
        private readonly transfer_history: InventoryTransferHistory,
    ) { }

    public onStatusChange(from: DrillStatusCode, to: DrillStatusCode): void {
        if (from === DrillStatusCode.DISABLED_BY_CONTROL_BEHAVIOR) {
            this.last_enabled_tick = this.tick_provider.getCurrentTick();
        }
        if (to === DrillStatusCode.DISABLED_BY_CONTROL_BEHAVIOR && this.last_enabled_tick !== null) {
            this.transfer_history.recordTransfer(
                this.drill_entity.entity_id,
                {
                    item_name: this.drill_entity.item.name,
                    tick_range: OpenRange.from(
                        this.last_enabled_tick,
                        this.tick_provider.getCurrentTick()
                    ),
                    // TODO: this assumes full insertion each time, should be based on actual mined amount
                    amount: miningDrillMaxInsertion(this.drill_entity, this.sink_entity),
                }
            )
            this.last_enabled_tick = null;
        }
    }
}
