import { EntityState, InserterState } from "../../../state";
import { ModeTransition, ModeTransitionEvaluator } from "../../mode";
import { InserterMode } from "../modes";
import { InserterSwingMode } from "../modes/swing-mode";
import { InserterTargetFullMode } from "../modes/target-full-mode";

export class DropModeTransitionEvaluator implements ModeTransitionEvaluator<InserterMode> {

    constructor(
        private readonly inserter_state: InserterState,
        private readonly sink_entity_state: EntityState,
        private readonly swing_mode: InserterSwingMode,
        private readonly target_full_mode: InserterTargetFullMode
    ) { }

    public onEnter(fromMode: InserterMode): void { }

    public onExit(toMode: InserterMode): void { }

    public evaluateTransition(): ModeTransition<InserterMode> {
        // Universal completion signal: all items dropped
        if (this.inserter_state.held_item === null) {
            return ModeTransition.transition(this.swing_mode, "all items dropped");
        }

        // If sink is a chest and it's full, transition to target_full mode
        if (EntityState.isChest(this.sink_entity_state)) {
            if (this.sink_entity_state.isFull(this.inserter_state.held_item.item_name)) {
                return ModeTransition.transition(this.target_full_mode, "chest is full, waiting for space");
            }
        }

        return ModeTransition.NONE;
    }
}