import { DrillStatus } from "../../../state";
import { TickProvider } from "../../current-tick-provider";
import type { DrillObserver } from "../../../simulation/archetypes/mining-drill";
import { DrillStatusCode, drillStatusOf } from "../../../simulation/status-codes";

/** Where the transitions of a drill are recorded (a recorder of the state transition history) */
interface DrillTransitionRecorder {
    recordTransition(tick: number, from_status: DrillStatus, to_status: DrillStatus, reason_id: number): void;
}

/**
 * Observer that tracks the changes of status of a drill.
 * Records each change with its tick, the statuses as the histories name them, and the number of its reason.
 */
export class DrillStateTransitionTrackerPlugin implements DrillObserver {
    constructor(
        private readonly tick_provider: TickProvider,
        private readonly recorder: DrillTransitionRecorder,
    ) {}

    onStatusChange(from: DrillStatusCode, to: DrillStatusCode, reason_id: number): void {
        this.recorder.recordTransition(this.tick_provider.getCurrentTick(), drillStatusOf(from), drillStatusOf(to), reason_id);
    }
}
