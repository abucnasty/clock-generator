import { InserterStatus } from "../../../state";
import { InserterDropMode } from "./drop/drop-mode";
import { InserterMode } from "./inserter-mode";

/**
 * Inserter mode when the inserter is waiting because its sink (chest) is full
 * and it still has items in hand.
 * 
 * This mode delegates its execution to InserterDropMode since the core logic
 * of attempting to drop items is the same - the only difference is the status
 * and the transition conditions.
 */
export class InserterTargetFullMode implements InserterMode {
    public readonly status = InserterStatus.TARGET_FULL;

    constructor(
        private readonly drop_mode: InserterDropMode
    ) { }

    public onEnter(fromMode: InserterMode): void { }

    public onExit(toMode: InserterMode): void { }

    public executeForTick(): void {
        // Delegate to drop mode - same logic of attempting to drop items
        this.drop_mode.executeForTick();
    }
}
