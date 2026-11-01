import assert from "../../common/assert";

/** Live scheduling connections, separate from resettable hand scratch and physical carried state. */
export class HandNotifications {
    private deliver: ((cause: "hand-transfer" | "simulator-control-swap") => void) | null = null;

    public subscribe(deliver: (cause: "hand-transfer" | "simulator-control-swap") => void): void {
        assert(this.deliver === null, "Hand already has a scheduling subscription");
        this.deliver = deliver;
    }

    public transferred(): void { this.deliver?.("hand-transfer"); }
    public controlSwapped(): void { this.deliver?.("simulator-control-swap"); }
}
