import type { TickProvider } from "../current-tick-provider";
import type { InventoryTransferHistory } from "../../crafting/sequence/inventory-transfer-history";
import { OpenRange } from "../../data-types";
import { Machine, MiningDrill, miningDrillMaxInsertion } from "../../entities";
import { DrillStatusCode } from "../status-codes";
import type { DrillObserver } from "./observer";

/**
 * Records the enabled runs of a drill into a machine into the run's transfer history, from its changes of status: a
 * run from the tick it is enabled to the tick it is disabled again, as a transfer of what the drill puts in at most.
 *
 * A drill enabled in the warm-up (whose ticks are larger: the recorded ticks start again at 0) counts from the run's
 * first tick, as the inserters' transfers do. One still enabled when the run ends has its last run closed by `endRun`.
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
        if (to === DrillStatusCode.DISABLED_BY_CONTROL_BEHAVIOR) {
            this.closeRun();
        }
    }

    /**
     * The recorded run ends here: a drill still enabled has its run so far recorded, to this tick. It stays enabled
     * (a run that goes on from here counts its run from this tick).
     */
    public endRun(): void {
        if (this.last_enabled_tick === null) {
            return;
        }
        this.closeRun();
        this.last_enabled_tick = this.tick_provider.getCurrentTick();
    }

    private closeRun(): void {
        if (this.last_enabled_tick === null) {
            return;
        }
        const current_tick = this.tick_provider.getCurrentTick();
        // enabled in the warm-up (whose ticks are larger: the recorded ticks start again at 0): counted from the run's first tick
        const enabled_tick = this.last_enabled_tick > current_tick ? 0 : this.last_enabled_tick;
        this.transfer_history.recordTransfer(
            this.drill_entity.entity_id,
            {
                item_name: this.drill_entity.item.name,
                tick_range: OpenRange.from(enabled_tick, current_tick),
                // TODO: this assumes full insertion each time, should be based on actual mined amount
                amount: miningDrillMaxInsertion(this.drill_entity, this.sink_entity),
            }
        )
        this.last_enabled_tick = null;
    }
}
