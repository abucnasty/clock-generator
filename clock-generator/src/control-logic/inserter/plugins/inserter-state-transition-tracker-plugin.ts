import { EntityId } from "../../../entities";
import { InserterStatus } from "../../../state";
import { TickProvider } from "../../current-tick-provider";
import { ModePlugin, Transition } from "../../mode";
import { InserterMode } from "../modes";

/**
 * Represents a single state transition for an inserter
 */
interface InserterStateTransition {
    entity_id: EntityId;
    tick: number;
    from_status: InserterStatus;
    to_status: InserterStatus;
    reason: string;
}

type InserterStateTransitionCallback = (transition: InserterStateTransition) => void;

/**
 * Plugin that tracks state transitions for an inserter state machine.
 * Records each mode transition with timing and reason information.
 */
export class InserterStateTransitionTrackerPlugin implements ModePlugin<InserterMode> {
    constructor(
        private readonly entity_id: EntityId,
        private readonly tick_provider: TickProvider,
        private readonly callback: InserterStateTransitionCallback,
    ) {}

    onTransition(fromMode: InserterMode, transition: Transition<InserterMode>): void {
        const state_transition: InserterStateTransition = {
            entity_id: this.entity_id,
            tick: this.tick_provider.getCurrentTick(),
            from_status: fromMode.status,
            to_status: transition.toMode.status,
            reason: transition.reason,
        };
        this.callback(state_transition);
    }
}
