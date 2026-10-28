import { InserterStatus } from "../../../state";
import { TickProvider } from "../../current-tick-provider";
import type { InserterObserver } from "../../../simulation/archetypes/inserter";
import { InserterPhase, inserterStatusOf } from "../../../simulation/status-codes";

/** Where the transitions of an inserter are recorded (a recorder of the state transition history) */
interface InserterTransitionRecorder {
    recordTransition(tick: number, from_status: InserterStatus, to_status: InserterStatus, reason_id: number): void;
}

/**
 * Observer that tracks the changes of phase of an inserter.
 * Records each change with its tick, the statuses as the histories name them, and the number of its reason.
 */
export class InserterStateTransitionTrackerPlugin implements InserterObserver {
    constructor(
        private readonly tick_provider: TickProvider,
        private readonly recorder: InserterTransitionRecorder,
    ) {}

    onStatusChange(from: InserterPhase, to: InserterPhase, reason_id: number): void {
        this.recorder.recordTransition(this.tick_provider.getCurrentTick(), inserterStatusOf(from), inserterStatusOf(to), reason_id);
    }
}
