import { DrillStatus } from "../../../state";
import { TickProvider } from "../../current-tick-provider";
import { ModePlugin, Transition } from "../../mode";
import { DrillMode } from "../modes/drill-mode";

/** Where the transitions of a drill are recorded (a recorder of the state transition history) */
interface DrillTransitionRecorder {
    recordTransition(tick: number, from_status: DrillStatus, to_status: DrillStatus, reason_id: number): void;
}

/**
 * Plugin that tracks state transitions for a drill state machine.
 * Records each mode transition with its tick and the number of its reason.
 */
export class DrillStateTransitionTrackerPlugin implements ModePlugin<DrillMode> {
    constructor(
        private readonly tick_provider: TickProvider,
        private readonly recorder: DrillTransitionRecorder,
    ) {}

    onTransition(fromMode: DrillMode, transition: Transition<DrillMode>): void {
        this.recorder.recordTransition(this.tick_provider.getCurrentTick(), fromMode.status, transition.toMode.status, transition.reason_id);
    }
}
