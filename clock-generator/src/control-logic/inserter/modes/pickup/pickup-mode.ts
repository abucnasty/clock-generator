import { InserterState, InserterStatus } from "../../../../state";
import { HandPickupPort } from "../../../../simulation/components/hand";
import { bindHandPorts, HandPortArgs } from "../../../../simulation/components/hand-ports";
import { InserterMode } from "../inserter-mode";

export class InserterPickupMode implements InserterMode {
    public readonly status = InserterStatus.PICKUP;

    /**
     * A pickup on its own, its hand bound to the source's pickup port and the sink's drop port (tests, game-test
     * helpers). It binds the hand as a state machine's build does, with the same side effects: a belt source gets this
     * inserter's pickup slots on its lanes (kept if bound already), and a belt sink gets its drop slots (`ownDrop` or
     * `sharedDrop`, a spot registered on the lane's traffic) and needs `tick_provider`. Beside a live state machine of
     * the same inserter, a belt sink would get a second drop spot: build such a pickup over a machine or a container.
     */
    public static create(args: HandPortArgs): InserterPickupMode {
        return new InserterPickupMode(args.inserterState, bindHandPorts(args).pickup);
    }

    constructor(
        private readonly inserterState: InserterState,
        /** The source's pickup port as the hand reaches it */
        public readonly port: HandPickupPort,
    ) {}

    public onEnter(fromMode: InserterMode): void {
        // The belt's port must see the wait flag before it is cleared to decide its first grab's timing.
        this.port.enter(fromMode.status);
        this.inserterState.waits_for_sink = false;
    }

    public onExit(toMode: InserterMode): void {}

    public stateKey(): string {
        return this.port.key();
    }

    public executeForTick(): void {
        this.port.pickup();
    }
}
