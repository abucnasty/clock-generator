import { MachineState } from "../../../state";
import { ModePlugin, Transition } from "../../mode";
import { MachineMode } from "../modes";

export class MachineStatusPlugin implements ModePlugin<MachineMode> {

    private crafts_seen: number;

    constructor(
        private readonly machine_state: MachineState
    ) {
        this.crafts_seen = machine_state.craftCount;
    }

    /** After the machine's tick: what the inserters that wait on it go by in the next one */
    executeForTick(): void {
        const state = this.machine_state;
        state.finishedCraftInLastTick = state.craftCount !== this.crafts_seen;
        this.crafts_seen = state.craftCount;
        state.outputBlockedAfterLastTick = MachineState.machineIsOutputBlocked(state);
        state.productsTakenAsWindowOpened = false;
    }

    onTransition(fromMode: MachineMode, transition: Transition<MachineMode>): void {
        this.machine_state.status = transition.toMode.status;
    }
}