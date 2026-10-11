import { InserterStatus } from "../../../state";
import { InserterMode } from "./inserter-mode";

/**
 * A hand filling from a belt that the machine cannot take any more of for now: the output is at its block, or the
 * ingredient at its insertion limit. As in the game, the inserter keeps what it holds and waits at the belt, and goes
 * on filling once the machine takes the item again. The game shows this as "waiting for space in destination".
 */
export class InserterWaitForSinkMode implements InserterMode {
    public readonly status = InserterStatus.WAITING_FOR_SINK;

    public onEnter(fromMode: InserterMode): void { }

    public onExit(toMode: InserterMode): void { }

    public executeForTick(): void { }
}
