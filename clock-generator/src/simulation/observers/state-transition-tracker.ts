import type { TickProvider } from "../current-tick-provider";
import type { EntityStatus, EntityTransitionRecorder } from "../../crafting/sequence/state-transition-history";
import type { EntityObserver, StatusChangeReason } from "./observer";

/**
 * Records each change of an entity's status into its entity's state transition history: the tick, the statuses as the
 * histories name them (P4 decision D3: the kind's function from its codes to those strings, bound at attach) and the
 * number of the reason. The reason is asked for only while the history records, so a run's prepare step and warm-ups,
 * which record nothing, make no reason's text.
 */
export class StateTransitionTracker<S extends number> implements EntityObserver<S> {
    constructor(
        private readonly tick_provider: TickProvider,
        private readonly recorder: EntityTransitionRecorder,
        /** The string a history records for a status of the entity's kind (`inserterStatusOf`, `machineStatusOf`, `drillStatusOf`) */
        private readonly status_of: (code: S) => EntityStatus,
    ) {}

    public onStatusChange(from: S, to: S, reason: StatusChangeReason<S>): void {
        const recorder = this.recorder;
        if (!recorder.history.recording) {
            return;
        }
        recorder.recordTransition(this.tick_provider.getCurrentTick(), this.status_of(from), this.status_of(to), reason.reasonId(from, to));
    }
}
