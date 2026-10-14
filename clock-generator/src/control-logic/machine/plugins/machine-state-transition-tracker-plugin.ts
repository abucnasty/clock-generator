import { EntityId } from "../../../entities";
import { MachineStatus } from "../../../state";
import { TickProvider } from "../../current-tick-provider";
import { ModePlugin, Transition } from "../../mode";
import { MachineMode } from "../modes";

/**
 * Represents a single state transition for a machine
 */
interface MachineStateTransition {
    entity_id: EntityId;
    tick: number;
    from_status: MachineStatus;
    to_status: MachineStatus;
    reason: string;
}

type MachineStateTransitionCallback = (transition: MachineStateTransition) => void;

/**
 * Plugin that tracks state transitions for a machine state machine.
 * Records each mode transition with timing and reason information.
 */
export class MachineStateTransitionTrackerPlugin implements ModePlugin<MachineMode> {
    constructor(
        private readonly entity_id: EntityId,
        private readonly tick_provider: TickProvider,
        private readonly callback: MachineStateTransitionCallback,
    ) {}

    onTransition(fromMode: MachineMode, transition: Transition<MachineMode>): void {
        const state_transition: MachineStateTransition = {
            entity_id: this.entity_id,
            tick: this.tick_provider.getCurrentTick(),
            from_status: fromMode.status,
            to_status: transition.toMode.status,
            reason: transition.reason,
        };
        this.callback(state_transition);
    }
}
