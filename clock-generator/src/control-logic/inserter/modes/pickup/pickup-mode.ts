import { InserterState, InserterStatus } from "../../../../state";
import { InserterMode } from "../inserter-mode";
import { InserterTransferLogic } from "../transfer-logic";
import { InserterPickupLogicArgs, InserterTransferLogicFactory } from "../transfer-logic-factory";

export class InserterPickupMode implements InserterMode {
    public readonly status = InserterStatus.PICKUP;

    public static create(args: InserterPickupLogicArgs): InserterPickupMode {
        return new InserterPickupMode(args.inserterState, InserterTransferLogicFactory.createPickup(args));
    }

    constructor(
        private readonly inserterState: InserterState,
        public readonly logic: InserterTransferLogic,
    ) {}

    public onEnter(fromMode: InserterMode): void {
        // Belt logic must see the wait flag before it is cleared to decide its first grab's timing.
        this.logic.onEnter(fromMode.status);
        this.inserterState.waits_for_sink = false;
    }

    public onExit(toMode: InserterMode): void {}

    public stateKey(): string {
        return this.logic.stateKey();
    }

    public executeForTick(): void {
        this.logic.executeForTick();
    }
}
