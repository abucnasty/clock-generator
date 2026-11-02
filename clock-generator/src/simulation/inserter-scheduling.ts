import assert from "../common/assert";
import type {SimulationContext} from "../crafting/sequence/simulation-context";
import {EntityState} from "../state/entity-state";
import {ActiveScheduler, ActiveSchedulerState, SchedulingEvent} from "./active-scheduler";
import type {LeavesList, WokenInWalk} from "./dispatch";
import type {InserterArchetype} from "./archetypes/inserter";
import {WakeSubscriptions, WakeSubscriptionState} from "./wake-subscriptions";

export interface InserterSchedulingState extends ActiveSchedulerState {
    readonly wake_subscriptions?: readonly WakeSubscriptionState[];
    readonly updating?: {entity: string; picked: boolean} | null;
    /** With `leaves` "next-update": the members whose last update found them waiting, still in the list */
    readonly leaving?: readonly string[];
}

/** The two points of the list the observations leave open (simulation/dispatch.ts) */
export interface InserterSchedulingOptions {
    readonly woken_in_walk?: WokenInWalk;
    readonly leaves?: LeavesList;
}

/**
 * Machine/hand notification integration. The context owns its lifetime and live connections;
 * sleep registrations are behavior state, independent of those connections and active membership.
 * Native activation outcomes are never inputs to these handlers.
 */
export class InserterScheduling {
    private readonly scheduler: ActiveScheduler;
    private readonly observers: ((event: SchedulingEvent) => void)[] = [];
    private readonly by_id: ReadonlyMap<string, InserterArchetype>;
    private readonly machine_sources = new Map<string, string>();
    private readonly machine_sinks = new Map<string, string>();
    private readonly sinks = new Map<string, string>();
    private readonly polling_sinks = new Set<string>();
    private readonly waits: WakeSubscriptions;
    private updating: {entity: string; pickups_before: number} | null = null;
    private readonly leaves: LeavesList;
    private readonly leaving = new Set<string>();

    constructor(context: SimulationContext, order: readonly InserterArchetype[],
        observe: (event: SchedulingEvent) => void = () => {}, state?: InserterSchedulingState,
        options: InserterSchedulingOptions = {}) {
        this.leaves = options.leaves ?? "after-update";
        this.by_id = new Map(order.map(inserter => [inserter.entity_id.id, inserter]));
        const initial = state ?? {active_order: [...this.by_id.keys()], remaining_updates: null, pending_next_phase: []};
        assert([...initial.active_order, ...(initial.remaining_updates ?? []), ...initial.pending_next_phase]
            .every(id => this.by_id.has(id)), "Scheduler state refers to an unknown inserter");
        this.scheduler = new ActiveScheduler(initial, event => {
            observe(event);
            for (const observer of this.observers) observer(event);
        }, options.woken_in_walk ?? "next-tick");
        for (const id of state?.leaving ?? []) {
            assert(this.by_id.has(id), "Leaving state refers to an unknown inserter");
            this.leaving.add(id);
        }
        this.waits = new WakeSubscriptions(state?.wake_subscriptions);
        assert(this.waits.state().every(channel => channel.entities.every(id => this.by_id.has(id))),
            "Wake state refers to an unknown inserter");
        if (state?.updating) {
            const inserter = this.by_id.get(state.updating.entity);
            assert(inserter !== undefined, "Update state refers to an unknown inserter");
            this.updating = {entity: state.updating.entity,
                pickups_before: inserter.inserter_state.items_picked_up - Number(state.updating.picked)};
        }
        const connected = new Set<string>();
        for (const inserter of order) {
            inserter.hand.useNotificationScheduling();
            const id = inserter.entity_id.id;
            const definition = inserter.inserter_state.inserter;
            const source = context.state_registry.getStateByEntityIdOrThrow(definition.source.entity_id);
            const sink = context.state_registry.getStateByEntityIdOrThrow(definition.sink.entity_id);
            const source_channel = `${source.entity_id.id}:output`, sink_channel = `${sink.entity_id.id}:input`;
            this.sinks.set(id, sink_channel);
            if (inserter.hand.drop.requiresReadinessPolling?.() === true) this.polling_sinks.add(id);
            if (EntityState.isMachine(source)) {
                this.machine_sources.set(id, source_channel);
                if (!connected.has(source_channel)) {
                    connected.add(source_channel);
                    source.yield.notifications.subscribeOutput(cause => this.notify(source_channel, cause));
                }
            }
            if (EntityState.isMachine(sink)) {
                if (!this.polling_sinks.has(id)) this.machine_sinks.set(id, sink_channel);
                if (!connected.has(sink_channel)) {
                    connected.add(sink_channel);
                    sink.yield.notifications.subscribeInput(cause => this.notify(sink_channel, cause));
                }
            }
            inserter.hand.notifications.subscribe(cause => this.alarm(id, cause));
        }
    }

    private alarm(id: string, cause: string): void {
        this.waits.clear(id);
        this.leaving.delete(id);
        this.scheduler.deliverAlarm(id, cause, true);
    }

    private notify(channel: string, cause: string): void {
        for (const id of this.waits.take(channel)) this.alarm(id, cause);
    }

    /** Diagnostic delivery does not enter the recurrence key. */
    public observe(observer: (event: SchedulingEvent) => void): void { this.observers.push(observer); }

    public beginUpdates(): void { this.scheduler.beginUpdates(); }

    public nextUpdate(): InserterArchetype | null {
        const id = this.scheduler.nextUpdate();
        if (id === null) return null;
        const inserter = this.by_id.get(id)!;
        this.updating = {entity: id, pickups_before: inserter.inserter_state.items_picked_up};
        return inserter;
    }

    /** Sources without production notification coverage keep polling until their integration is validated. */
    public completeUpdate(inserter: InserterArchetype): void {
        const id = inserter.entity_id.id;
        const picked = this.updating?.entity === id
            && inserter.inserter_state.items_picked_up > this.updating.pickups_before;
        this.updating = null;
        // Planning controls may latch when asked. They retain polling until their own control
        // notification semantics exist; pure clock lookahead does not perform an extra latched read.
        if (!inserter.control.looks_ahead) return;
        const reason = inserter.hand.sleepReason();
        if (this.leaves === "next-update" && reason !== null && !this.leaving.has(id)) {
            // stays for one more update; an Alarm meanwhile finds it active and keeps its place
            if (this.waitsWith(id, reason)) this.leaving.add(id);
            return;
        }
        this.leaving.delete(id);
        const source = this.machine_sources.get(id), sink = this.machine_sinks.get(id);
        if (reason === "source-empty" && source !== undefined) {
            // A successful partial take checks both ends before sleep. Ports without complete
            // readiness notifications keep polling rather than inventing native wakeability.
            if (picked && this.polling_sinks.has(id)) return;
            this.waits.register(id, picked ? [this.sinks.get(id)!, source] : [source]);
            this.scheduler.deactivate(id, reason);
        } else if (reason === "destination-refused" && sink !== undefined) {
            this.waits.register(id, [sink]);
            this.scheduler.deactivate(id, reason);
        } else if (reason === "control-disabled") {
            // Simulator control swaps preserve the source-wait contract separately from native
            // condition assignment. An unsupported belt source supplies no inventory registration.
            this.waits.register(id, source === undefined ? [] : [source]);
            this.scheduler.deactivate(id, reason);
        }
    }

    /** Whether a sleep with this reason leaves the list (the reasons completeUpdate deactivates on) */
    private waitsWith(id: string, reason: string): boolean {
        if (reason === "source-empty") return this.machine_sources.has(id);
        if (reason === "destination-refused") return this.machine_sinks.has(id);
        return reason === "control-disabled";
    }

    /** Finish-dispatch edges arrive after entity Updates and are eligible in the next phase. */
    public finishControls(): void {
        const opening = [...this.by_id].filter(([, inserter]) => {
            const control = inserter.control;
            return control.looks_ahead && !control.enabledIn(0) && control.enabledIn(1);
        });
        // Known decider build order already belongs to the exported clock. Its native forward/
        // reversed controls require last-built-first Updates. Deliver ascending so new attachments
        // lead in reverse. Unknown orders keep the trial scenario, without inventing build facts.
        if (opening.every(([, inserter]) => inserter.control.decider_build_order !== undefined)) {
            opening.sort((a, b) => a[1].control.decider_build_order! - b[1].control.decider_build_order!);
        }
        for (const [id] of opening) this.alarm(id, "control-finish-enable-edge");
    }

    public endUpdates(): void { this.scheduler.endUpdates(); }
    public state(): InserterSchedulingState {
        return {...this.scheduler.state(), wake_subscriptions: this.waits.state(),
            ...(this.leaving.size > 0 && {leaving: [...this.leaving].sort()}),
            updating: this.updating === null ? null : {
            entity: this.updating.entity,
            picked: this.by_id.get(this.updating.entity)!.inserter_state.items_picked_up > this.updating.pickups_before,
        }};
    }
    public key(): string { return JSON.stringify(this.state()); }
}
