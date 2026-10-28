import { assertIsMachineState, DrillState, DrillStatus, EntityState, MachineState } from "../../../state";
import { DrillMode } from "./drill-mode";
import { Item } from "../../../data";
import { placeIntoMachine } from "../../place-into-machine";
import { MiningProgress } from "./mining-progress";

/**
 * A drill working into a machine. Each tick it first drops what it holds, into the machine up to the drill's stop
 * (`miningDrillMaxInsertion`); while it still holds anything it waits, its bars still; else it mines by its progress
 * bars (`MiningProgress`) and holds what they complete until the next tick's drop. The machine is not checked before
 * mining: at its stop, the drill mines on until it holds an item.
 */
export class DrillWorkingMode implements DrillMode {

    public readonly status = DrillStatus.WORKING;

    private readonly sink_state: MachineState
    /** Its bars, kept while it waits or is disabled */
    public readonly progress: MiningProgress;

    constructor(
        private readonly state: DrillState,
        sink_state: EntityState,
    ) {
        assertIsMachineState(sink_state);
        this.sink_state = sink_state;
        this.progress = new MiningProgress(state.drill);
    }

    public onEnter(fromMode: DrillMode): void { }
    public onExit(toMode: DrillMode): void { }

    /** Its bars, which it keeps while it waits or is disabled */
    public stateKey(): string {
        return this.progress.stateKey();
    }

    public executeForTick(): void {
        const item_name = this.mined_item.name;
        const held_storage = this.state.held;
        const held = held_storage.getCurrentQuantity(item_name);
        const drop = placeIntoMachine(held_storage.inventoryState, this.sink_state, this.mined_item);
        if (held - drop > 0) {
            // what it mined before is still in the drill: the machine is at the drill's stop, so it mines nothing
            return;
        }
        const mined = this.progress.mine();
        if (mined > 0) {
            held_storage.insert(item_name, mined);
        }
    }

    private get mined_item(): Item {
        return this.state.drill.item;
    }

}
