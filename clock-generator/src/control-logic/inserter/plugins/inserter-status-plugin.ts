import { InserterState } from "../../../state";
import { ModePlugin, Transition } from "../../mode";
import { InserterMode } from "../modes/inserter-mode";

export class InserterStatusPlugin implements ModePlugin<InserterMode> {

    constructor(
        private readonly inserter_state: InserterState
    ) {}

    onTransition(fromMode: InserterMode, transition: Transition<InserterMode>): void {
        this.inserter_state.status = transition.toMode.status;
        this.inserter_state.trace?.record({type: "mode", from: fromMode.status, to: transition.toMode.status});
    }
}
