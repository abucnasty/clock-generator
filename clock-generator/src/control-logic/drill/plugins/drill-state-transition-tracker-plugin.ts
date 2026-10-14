import { EntityId } from "../../../entities";
import { DrillStatus } from "../../../state";
import { TickProvider } from "../../current-tick-provider";
import { ModePlugin, Transition } from "../../mode";
import { DrillMode } from "../modes/drill-mode";

/**
 * Represents a single state transition for a drill
 */
interface DrillStateTransition {
    entity_id: EntityId;
    tick: number;
    from_status: DrillStatus;
    to_status: DrillStatus;
    reason: string;
}

type DrillStateTransitionCallback = (transition: DrillStateTransition) => void;

/**
 * Plugin that tracks state transitions for a drill state machine.
 * Records each mode transition with timing and reason information.
 */
export class DrillStateTransitionTrackerPlugin implements ModePlugin<DrillMode> {
    constructor(
        private readonly entity_id: EntityId,
        private readonly tick_provider: TickProvider,
        private readonly callback: DrillStateTransitionCallback,
    ) {}

    onTransition(fromMode: DrillMode, transition: Transition<DrillMode>): void {
        const state_transition: DrillStateTransition = {
            entity_id: this.entity_id,
            tick: this.tick_provider.getCurrentTick(),
            from_status: fromMode.status,
            to_status: transition.toMode.status,
            reason: transition.reason,
        };
        this.callback(state_transition);
    }
}
