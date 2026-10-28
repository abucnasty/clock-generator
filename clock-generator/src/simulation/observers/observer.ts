import type { CraftingStatus, DrillStatusCode, InserterPhase } from "../status-codes";

// What watches a run: the histories' trackers, the game's states, the transfers, the recorders and the debug output.
// The phase table (simulation/tick-phases.ts) names the point of a tick each event is told at (`ObserverEvent`).
// Observers watch and never write: they own nothing a later tick of an entity reads (P4 2.1 rule 5). A run takes off
// the observers that feed its histories when it ends; the debug observers stay on its context but log only while
// debugging is switched on.

/**
 * Why an entity's status changes, as the entity answers it while its observers are told of the change: the number of
 * the reason's text in the reason table (`reasonText` gives the text). The text is made when asked, so an observer
 * that records no text makes none (P4 section 8). It answers for the change being told only: an observer asks during
 * the call and never keeps it.
 */
export interface StatusChangeReason<S extends number> {
    reasonId(from: S, to: S): number;
}

/**
 * What watches one entity of a run, told at its archetype's two event points: a change of its status in its status
 * rule, and its tick at its tick observers step. Each is optional: an observer is told only of the events it has a
 * method for.
 */
export interface EntityObserver<S extends number> {
    /**
     * A change of status from `from` to `to` (codes of simulation/status-codes.ts), with what answers its reason. Told
     * in the step the phase table names for `ObserverEvent.STATUS_CHANGE` (a drill's control rule, an inserter's phase
     * rule, a machine's status rule): an inserter's after its status is written and before its exit and enter steps, a
     * machine's after its status is written and before it crafts, a drill's before its status is written (same-tick
     * rule 17).
     */
    onStatusChange?(from: S, to: S, reason: StatusChangeReason<S>): void;
    /**
     * Once a tick, in the step the phase table names for `ObserverEvent.TICK`: a drill's after its mining, an
     * inserter's after its phase step and before its Wakes, a machine's after its Wakes.
     */
    onTick?(): void;
}

/** What watches an inserter: its changes of phase and its ticks */
export type InserterObserver = EntityObserver<InserterPhase>;
/** What watches a crafting machine: its changes of status and its ticks */
export type CraftingMachineObserver = EntityObserver<CraftingStatus>;
/** What watches a mining drill: its changes of status and its ticks */
export type DrillObserver = EntityObserver<DrillStatusCode>;

/**
 * What records a run after each of its ticks, in the phase table's after-tick phase (`ObserverEvent.RECORD`): the
 * stock, fuel and timeline recorders, in the order the run gives them
 */
export interface TickRecorder {
    record(): void;
}

/**
 * The observers of one entity of a run, told at its archetype's event points: each event's observers in the order
 * they were added. Only the observers with an event's method are kept for that event, so an event nobody watches costs
 * a test of an empty list, and a reason is asked for only by an observer that records it.
 */
export class Observers<S extends number> {
    private readonly all: EntityObserver<S>[] = [];
    /** Those with `onStatusChange`, in the order added */
    private readonly of_status_change: EntityObserver<S>[] = [];
    /** Those with `onTick`, in the order added */
    private readonly of_tick: EntityObserver<S>[] = [];

    public add(observer: EntityObserver<S>): void {
        this.all.push(observer);
        if (observer.onStatusChange !== undefined) {
            this.of_status_change.push(observer);
        }
        if (observer.onTick !== undefined) {
            this.of_tick.push(observer);
        }
    }

    /** Takes these observers off, for a run whose observations nobody reads any more */
    public remove(observers: ReadonlySet<object>): void {
        for (const list of [this.all, this.of_status_change, this.of_tick]) {
            const kept = list.filter(observer => !observers.has(observer));
            list.length = 0;
            for (const observer of kept) {
                list.push(observer);
            }
        }
    }

    /** Every observer, in the order added */
    public list(): EntityObserver<S>[] {
        return [...this.all];
    }

    /** A change of status, told to each observer of changes in the order added; `reason` answers during the call only */
    public tellStatusChange(from: S, to: S, reason: StatusChangeReason<S>): void {
        const observers = this.of_status_change;
        for (let index = 0; index < observers.length; index++) {
            observers[index].onStatusChange!(from, to, reason);
        }
    }

    /** The entity's tick, told to each observer of ticks in the order added */
    public tellTick(): void {
        const observers = this.of_tick;
        for (let index = 0; index < observers.length; index++) {
            observers[index].onTick!();
        }
    }
}
