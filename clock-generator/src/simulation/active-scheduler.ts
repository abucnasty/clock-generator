import assert from "../common/assert";
import type {WokenInWalk} from "./dispatch";

export interface SchedulingEvent<T = string> {
    readonly event: "Alarm" | "Activation" | "Deactivation" | "Update";
    readonly entity: T;
    readonly cause: string;
}

/** Behavior state only: diagnostic events, counters and causes do not affect recurrence. */
export interface ActiveSchedulerState<T = string> {
    readonly active_order: readonly T[];
    readonly remaining_updates: readonly T[] | null;
    readonly pending_next_phase: readonly T[];
}

/**
 * A member's place in the scheduler: in the list or not, its neighbours there, and the phase it waits for or was
 * updated in. A caller that holds it (`ActiveScheduler.node`) reaches the member without a lookup.
 */
export interface ScheduledNode<T> {
    readonly entity: T;
    active: boolean;
    /** Its neighbours in the list, the front's `previous` null */
    previous: ScheduledNode<T> | null;
    next: ScheduledNode<T> | null;
    /** The phase it attached in and so waits after: pending while that phase is the scheduler's last one */
    pending_phase: number;
    /** The phase it was last updated in ("same-tick" attachments only) */
    updated_phase: number;
}

/**
 * A local scheduling policy for projected native fixtures; the new dispatch (simulation/dispatch.ts) runs it in World.
 * New attachments precede older members; attachments during an open Update phase wait for the next phase, or with
 * `woken_in_walk` "same-tick" are updated after the phase's remaining members when not yet updated in it.
 * The caller decides activation eligibility and deactivation outcomes independently of hand/control state.
 *
 * It runs in every tick of a simulation under the new dispatch, so the list is linked through the members' nodes (an
 * attachment or a removal moves nobody else), a phase walks a snapshot with a cursor, a phase's number stands for
 * the pending and updated sets, and an event is made only when somebody observes it. A member is any value compared by
 * identity: an id here and in the fixtures; InserterScheduling holds its inserters' nodes and calls the `...Node`
 * methods, which are the same policy without the lookup.
 */
export class ActiveScheduler<T = string> {
    private readonly nodes = new Map<T, ScheduledNode<T>>();
    /** The front of the list */
    private front: ScheduledNode<T> | null = null;
    /** The open phase's snapshot, its first `walk_length` entries; the ones before `cursor` are consumed */
    private readonly walk: ScheduledNode<T>[] = [];
    private walk_length = 0;
    private cursor = 0;
    private open = false;
    /** The number of the last phase begun; pending (`pending_phase`) means attached in it */
    private phase = 0;
    private observer: ((event: SchedulingEvent<T>) => void) | null;

    constructor(state: ActiveSchedulerState<T>, observe?: (event: SchedulingEvent<T>) => void,
        private readonly woken_in_walk: WokenInWalk = "next-tick") {
        assert(new Set(state.active_order).size === state.active_order.length, "Duplicate active member");
        assert(new Set(state.pending_next_phase).size === state.pending_next_phase.length, "Duplicate pending member");
        assert(state.pending_next_phase.every(entity => state.active_order.includes(entity)), "Pending member is inactive");
        assert(state.remaining_updates === null || new Set(state.remaining_updates).size === state.remaining_updates.length,
            "Duplicate phase member");
        for (let index = state.active_order.length - 1; index >= 0; index--) this.attach(this.node(state.active_order[index]));
        for (const entity of state.pending_next_phase) this.node(entity).pending_phase = this.phase;
        if (state.remaining_updates !== null) {
            this.open = true;
            for (const entity of state.remaining_updates) this.walk[this.walk_length++] = this.node(entity);
        }
        this.observer = observe ?? null;
    }

    /** The member's node, made (out of the list) on its first use */
    public node(entity: T): ScheduledNode<T> {
        let node = this.nodes.get(entity);
        if (node === undefined) {
            node = {entity, active: false, previous: null, next: null, pending_phase: -1, updated_phase: -1};
            this.nodes.set(entity, node);
        }
        return node;
    }

    /** Who is told of each event from now on; null: nobody, and no event is made */
    public observeWith(observer: ((event: SchedulingEvent<T>) => void) | null): void {
        this.observer = observer;
    }

    public isActive(entity: T): boolean {
        return this.nodes.get(entity)?.active === true;
    }

    /** Every delivery is observed, including repeated Alarms that cause no Activation or reorder. */
    public deliverAlarm(entity: T, cause: string, activation_eligible: boolean): void {
        if (this.observer !== null) this.observer({event: "Alarm", entity, cause});
        if (activation_eligible) this.activateNode(this.node(entity), cause);
    }

    public activate(entity: T, cause: string): void {
        this.activateNode(this.node(entity), cause);
    }

    public activateNode(node: ScheduledNode<T>, cause: string): void {
        if (node.active) return;
        this.attach(node);
        if (this.open) {
            if (this.woken_in_walk === "same-tick" && node.updated_phase !== this.phase) this.walk[this.walk_length++] = node;
            else node.pending_phase = this.phase;
        }
        if (this.observer !== null) this.observer({event: "Activation", entity: node.entity, cause});
    }

    public deactivate(entity: T, cause: string): void {
        const node = this.nodes.get(entity);
        if (node !== undefined) this.deactivateNode(node, cause);
    }

    public deactivateNode(node: ScheduledNode<T>, cause: string): void {
        if (!node.active) return;
        node.active = false;
        const {previous, next} = node;
        if (previous === null) this.front = next;
        else previous.next = next;
        if (next !== null) next.previous = previous;
        node.previous = node.next = null;
        node.pending_phase = -1;
        if (this.observer !== null) this.observer({event: "Deactivation", entity: node.entity, cause});
    }

    public beginUpdates(): void {
        assert(!this.open, "Update phase is already open");
        this.open = true;
        this.phase++;
        let length = 0;
        for (let node = this.front; node !== null; node = node.next) this.walk[length++] = node;
        this.walk_length = length;
        this.cursor = 0;
    }

    /** Consume at most one scheduled Update. A reattached member cannot reuse its old snapshot position. */
    public nextUpdate(): T | null {
        return this.nextUpdateNode()?.entity ?? null;
    }

    public nextUpdateNode(): ScheduledNode<T> | null {
        assert(this.open, "No Update phase is open");
        const walk = this.walk, phase = this.phase;
        while (this.cursor < this.walk_length) {
            const node = walk[this.cursor++];
            if (!node.active || node.pending_phase === phase) continue;
            if (this.woken_in_walk === "same-tick") node.updated_phase = phase;
            if (this.observer !== null) this.observer({event: "Update", entity: node.entity, cause: "scheduled-entity-update"});
            return node;
        }
        return null;
    }

    public endUpdates(): void {
        assert(this.open && this.cursor === this.walk_length, "Update phase is not exhausted");
        this.open = false;
        this.walk_length = this.cursor = 0;
    }

    public state(): ActiveSchedulerState<T> {
        const active_order: T[] = [], pending: T[] = [];
        for (let node = this.front; node !== null; node = node.next) {
            active_order.push(node.entity);
            if (node.pending_phase === this.phase) pending.push(node.entity);
        }
        return {
            active_order,
            remaining_updates: this.open ? this.walk.slice(this.cursor, this.walk_length).map(node => node.entity) : null,
            pending_next_phase: pending.sort(),
        };
    }

    public key(): string {
        return JSON.stringify(this.state());
    }

    public clone(observe?: (event: SchedulingEvent<T>) => void): ActiveScheduler<T> {
        return new ActiveScheduler(this.state(), observe, this.woken_in_walk);
    }

    /** Puts the node at the front of the list */
    private attach(node: ScheduledNode<T>): void {
        node.active = true;
        node.previous = null;
        node.next = this.front;
        if (this.front !== null) this.front.previous = node;
        this.front = node;
    }
}
