import assert from "../common/assert";

export interface SchedulingEvent {
    readonly event: "Alarm" | "Activation" | "Deactivation" | "Update";
    readonly entity: string;
    readonly cause: string;
}

/** Behavior state only: diagnostic events, counters and causes do not affect recurrence. */
export interface ActiveSchedulerState {
    readonly active_order: readonly string[];
    readonly remaining_updates: readonly string[] | null;
    readonly pending_next_phase: readonly string[];
}

/**
 * A local scheduling policy for projected native fixtures, not yet connected to World.
 * New attachments precede older members; attachments during an open Update phase wait for the next phase.
 * The caller decides activation eligibility and deactivation outcomes independently of hand/control state.
 */
export class ActiveScheduler {
    private active_order: string[];
    private remaining_updates: string[] | null;
    private readonly pending_next_phase: Set<string>;

    constructor(state: ActiveSchedulerState, private readonly observe: (event: SchedulingEvent) => void = () => {}) {
        assert(new Set(state.active_order).size === state.active_order.length, "Duplicate active member");
        assert(new Set(state.pending_next_phase).size === state.pending_next_phase.length, "Duplicate pending member");
        assert(state.pending_next_phase.every(entity => state.active_order.includes(entity)), "Pending member is inactive");
        assert(state.remaining_updates === null || new Set(state.remaining_updates).size === state.remaining_updates.length,
            "Duplicate phase member");
        this.active_order = [...state.active_order];
        this.remaining_updates = state.remaining_updates === null ? null : [...state.remaining_updates];
        this.pending_next_phase = new Set(state.pending_next_phase);
    }

    public isActive(entity: string): boolean {
        return this.active_order.includes(entity);
    }

    /** Every delivery is observed, including repeated Alarms that cause no Activation or reorder. */
    public deliverAlarm(entity: string, cause: string, activation_eligible: boolean): void {
        this.observe({event: "Alarm", entity, cause});
        if (activation_eligible) this.activate(entity, cause);
    }

    public activate(entity: string, cause: string): void {
        if (this.isActive(entity)) return;
        this.active_order.unshift(entity);
        if (this.remaining_updates !== null) this.pending_next_phase.add(entity);
        this.observe({event: "Activation", entity, cause});
    }

    public deactivate(entity: string, cause: string): void {
        if (!this.isActive(entity)) return;
        this.active_order.splice(this.active_order.indexOf(entity), 1);
        this.pending_next_phase.delete(entity);
        this.observe({event: "Deactivation", entity, cause});
    }

    public beginUpdates(): void {
        assert(this.remaining_updates === null, "Update phase is already open");
        this.pending_next_phase.clear();
        this.remaining_updates = [...this.active_order];
    }

    /** Consume at most one scheduled Update. A reattached member cannot reuse its old snapshot position. */
    public nextUpdate(): string | null {
        assert(this.remaining_updates !== null, "No Update phase is open");
        while (this.remaining_updates.length > 0) {
            const entity = this.remaining_updates.shift()!;
            if (!this.isActive(entity) || this.pending_next_phase.has(entity)) continue;
            this.observe({event: "Update", entity, cause: "scheduled-entity-update"});
            return entity;
        }
        return null;
    }

    public endUpdates(): void {
        assert(this.remaining_updates !== null && this.remaining_updates.length === 0, "Update phase is not exhausted");
        this.remaining_updates = null;
    }

    public state(): ActiveSchedulerState {
        return {
            active_order: [...this.active_order],
            remaining_updates: this.remaining_updates === null ? null : [...this.remaining_updates],
            pending_next_phase: [...this.pending_next_phase].sort(),
        };
    }

    public key(): string {
        return JSON.stringify(this.state());
    }

    public clone(observe: (event: SchedulingEvent) => void = () => {}): ActiveScheduler {
        return new ActiveScheduler(this.state(), observe);
    }
}
