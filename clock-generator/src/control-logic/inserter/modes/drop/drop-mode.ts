import { InserterStatus } from "../../../../state";
import { InserterMode } from "../inserter-mode";
import { InserterTransferLogic } from "../transfer-logic";

export class InserterDropMode implements InserterMode {
    public readonly status = InserterStatus.DROP_OFF;

    constructor(public readonly logic: InserterTransferLogic) {}

    public onEnter(fromMode: InserterMode): void {
        this.logic.onEnter(fromMode.status);
    }

    public onExit(toMode: InserterMode): void {}

    public stateKey(): string {
        return this.logic.stateKey();
    }

    public executeForTick(): void {
        this.logic.executeForTick();
    }
}
