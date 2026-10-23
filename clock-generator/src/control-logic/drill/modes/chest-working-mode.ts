import assert from "../../../common/assert";
import { ChestState, DrillState, DrillStatus, EntityState } from "../../../state";
import { DrillMode } from "./drill-mode";
import { MiningProgress } from "./mining-progress";

/**
 * A drill working into a chest of any type. Each tick it first drops what it holds as far as the chest has room, by
 * the chest's own rules (slots for a car, a tank or a wagon; weight and routing for a rocket silo; one item for a buffer
 * chest); while it still holds anything it waits, its bars still; else it mines by its progress bars
 * (`MiningProgress`), as a drill into a machine does (`DrillWorkingMode`), and holds what they complete until the next
 * tick's drop. The chest is not checked before mining: into a full chest the drill mines on until it holds an item.
 */
export class DrillChestWorkingMode implements DrillMode {

    public readonly status = DrillStatus.WORKING;

    /** Its bars, kept while it waits or is disabled */
    public readonly progress: MiningProgress;

    constructor(
        private readonly state: DrillState,
        private readonly sink_state: ChestState,
    ) {
        if (EntityState.isBufferChest(sink_state)) {
            assert(sink_state.chest.item_filter === state.drill.item.name,
                `Drill ${state.drill.entity_id.id} mines ${state.drill.item.name} into buffer chest ${sink_state.entity_id.id}, which holds ${sink_state.chest.item_filter}`);
        }
        this.progress = new MiningProgress(state.drill);
    }

    public onEnter(fromMode: DrillMode): void { }
    public onExit(toMode: DrillMode): void { }

    /** Its bars, which it keeps while it waits or is disabled */
    public stateKey(): string {
        return this.progress.stateKey();
    }

    public executeForTick(): void {
        if (this.drop() > 0) {
            // what it mined before is still in the drill: no room in the chest, so it mines nothing
            return;
        }
        const mined = this.progress.mine();
        if (mined > 0) {
            this.state.inventoryState.addQuantity(this.state.drill.item.name, mined);
        }
    }

    /** Drops what the drill holds as far as the chest has room; returns what is still held */
    private drop(): number {
        const item_name = this.state.drill.item.name;
        const drill_inventory = this.state.inventoryState;
        const held = drill_inventory.getItemOrThrow(item_name).quantity;
        const amount = Math.min(held, Math.max(0, this.sink_state.getAvailableSpace(item_name)));
        if (amount > 0) {
            drill_inventory.removeQuantity(item_name, amount);
            this.sink_state.inventoryState.addQuantity(item_name, amount);
        }
        return held - amount;
    }
}
