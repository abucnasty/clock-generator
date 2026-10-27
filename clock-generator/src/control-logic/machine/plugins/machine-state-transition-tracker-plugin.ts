import { MachineStatus } from "../../../state";
import { TickProvider } from "../../current-tick-provider";
import { ModePlugin, Transition } from "../../mode";
import { MachineMode } from "../modes";

/** Where the transitions of a machine are recorded (a recorder of the state transition history) */
interface MachineTransitionRecorder {
    recordTransition(tick: number, from_status: MachineStatus, to_status: MachineStatus, reason_id: number): void;
}

/**
 * Plugin that tracks state transitions for a machine state machine.
 * Records each mode transition with its tick and the number of its reason.
 */
export class MachineStateTransitionTrackerPlugin implements ModePlugin<MachineMode> {
    constructor(
        private readonly tick_provider: TickProvider,
        private readonly recorder: MachineTransitionRecorder,
    ) {}

    onTransition(fromMode: MachineMode, transition: Transition<MachineMode>): void {
        this.recorder.recordTransition(this.tick_provider.getCurrentTick(), fromMode.status, transition.toMode.status, transition.reason_id);
    }
}
