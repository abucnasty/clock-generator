import { InserterStatus } from "../../../state";
import { TickProvider } from "../../current-tick-provider";
import { ModePlugin, Transition } from "../../mode";
import { InserterMode } from "../modes";

/** Where the transitions of an inserter are recorded (a recorder of the state transition history) */
interface InserterTransitionRecorder {
    recordTransition(tick: number, from_status: InserterStatus, to_status: InserterStatus, reason_id: number): void;
}

/**
 * Plugin that tracks state transitions for an inserter state machine.
 * Records each mode transition with its tick and the number of its reason.
 */
export class InserterStateTransitionTrackerPlugin implements ModePlugin<InserterMode> {
    constructor(
        private readonly tick_provider: TickProvider,
        private readonly recorder: InserterTransitionRecorder,
    ) {}

    onTransition(fromMode: InserterMode, transition: Transition<InserterMode>): void {
        this.recorder.recordTransition(this.tick_provider.getCurrentTick(), fromMode.status, transition.toMode.status, transition.reason_id);
    }
}
