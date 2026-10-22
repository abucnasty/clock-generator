import assert from "../../../common/assert";
import { ChestState, DrillState, DrillStatus, EntityState } from "../../../state";
import { DrillMode } from "./drill-mode";

/**
 * A drill working into a chest of any type: it drops what it has mined as far as the chest has room, by the chest's own
 * rules (slots for a car, a tank or a wagon; weight and routing for a rocket silo; one item for a buffer chest). What
 * does not fit stays in the drill, which mines no more until it is dropped: a full chest stops the drill.
 *
 * It mines by the same per-tick amount as a drill into a machine (`DrillWorkingMode`): the production rate a tick,
 * floored, so a drill making less than one item a tick mines nothing here (a known limit).
 */
export class DrillChestWorkingMode implements DrillMode {

    public readonly status = DrillStatus.WORKING;

    constructor(
        private readonly state: DrillState,
        private readonly sink_state: ChestState,
    ) {
        if (EntityState.isBufferChest(sink_state)) {
            assert(sink_state.chest.item_filter === state.drill.item.name,
                `Drill ${state.drill.entity_id.id} mines ${state.drill.item.name} into buffer chest ${sink_state.entity_id.id}, which holds ${sink_state.chest.item_filter}`);
        }
    }

    public onEnter(fromMode: DrillMode): void { }
    public onExit(toMode: DrillMode): void { }

    public executeForTick(): void {
        const item_name = this.state.drill.item.name;
        const drill_inventory = this.state.inventoryState;
        if (this.drop() > 0) {
            // what it mined before is still in the drill: no room in the chest, so it mines nothing
            return;
        }
        const amount_this_tick = Math.floor(this.state.drill.production_rate.amount_per_tick.toDecimal());
        drill_inventory.addQuantity(item_name, amount_this_tick);
        this.drop();
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
