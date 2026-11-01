/** Why a machine notifies the hands subscribed to its inventories. Not a priced wake counter. */
export type MachineNotificationCause = "ingredients-consumed" | "output-inserted" | "output-removed";

/**
 * Notifications are emitted at the mutation, rather than inferred from a craft-count delta next tick.
 * Subscribers are bound once at construction. Their order here is the simulator's registration order;
 * native subscriber order is not established universally by the local activation fixtures.
 * This component owns no scheduler membership, control-enabled state or diagnostic running totals.
 */
export class MachineNotifications {
    private readonly inputs: ((cause: MachineNotificationCause) => void)[] = [];
    private readonly outputs: ((cause: MachineNotificationCause) => void)[] = [];

    public subscribeInput(deliver: (cause: MachineNotificationCause) => void): void {
        this.inputs.push(deliver);
    }

    public subscribeOutput(deliver: (cause: MachineNotificationCause) => void): void {
        this.outputs.push(deliver);
    }

    public ingredientsConsumed(): void {
        for (const deliver of this.inputs) deliver("ingredients-consumed");
    }

    public outputInserted(): void {
        for (const deliver of this.outputs) deliver("output-inserted");
    }

    public outputRemoved(): void {
        for (const deliver of this.inputs) deliver("output-removed");
    }
}
