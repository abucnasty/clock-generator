import { InserterStatus } from "../../../../state";
import { HandDropPort } from "../../../../simulation/components/hand";
import { InserterMode } from "../inserter-mode";

export class InserterDropMode implements InserterMode {
    public readonly status = InserterStatus.DROP_OFF;

    constructor(
        /** The sink's drop port as the hand reaches it */
        public readonly port: HandDropPort,
    ) {}

    public onEnter(fromMode: InserterMode): void {
        this.port.enter();
    }

    public onExit(toMode: InserterMode): void {}

    public stateKey(): string {
        return this.port.key();
    }

    public executeForTick(): void {
        this.port.drop();
    }
}
