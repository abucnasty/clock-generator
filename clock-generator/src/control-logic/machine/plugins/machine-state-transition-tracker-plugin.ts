import { MachineStatus } from "../../../state";
import { TickProvider } from "../../current-tick-provider";
import type { CraftingMachineObserver } from "../../../simulation/archetypes/crafting-machine";
import { CraftingStatus, machineStatusOf } from "../../../simulation/status-codes";

/** Where the transitions of a machine are recorded (a recorder of the state transition history) */
interface MachineTransitionRecorder {
    recordTransition(tick: number, from_status: MachineStatus, to_status: MachineStatus, reason_id: number): void;
}

/**
 * Observer that tracks the changes of status of a crafting machine.
 * Records each change with its tick, the statuses as the histories name them, and the number of its reason.
 */
export class MachineStateTransitionTrackerPlugin implements CraftingMachineObserver {
    constructor(
        private readonly tick_provider: TickProvider,
        private readonly recorder: MachineTransitionRecorder,
    ) {}

    onStatusChange(from: CraftingStatus, to: CraftingStatus, reason_id: number): void {
        this.recorder.recordTransition(this.tick_provider.getCurrentTick(), machineStatusOf(from), machineStatusOf(to), reason_id);
    }
}
