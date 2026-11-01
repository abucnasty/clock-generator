import assert from "../common/assert";
import type {SimulationContext} from "../crafting/sequence/simulation-context";
import {EntityState} from "../state/entity-state";
import {ActiveScheduler, ActiveSchedulerState, SchedulingEvent} from "./active-scheduler";
import type {InserterArchetype} from "./archetypes/inserter";

/**
 * Machine/hand notification integration. The context owns its lifetime and subscriptions; The default World
 * dispatch remains unchanged while broader native calibration contradictions are resolved. Native activation outcomes are never inputs to these handlers.
 * Subscriber registration follows the supplied scenario order, not native unit numbers.
 */
export class InserterScheduling {
    private readonly scheduler: ActiveScheduler;
    private readonly observers: ((event: SchedulingEvent) => void)[] = [];
    private readonly by_id: ReadonlyMap<string, InserterArchetype>;
    private readonly machine_sources = new Set<string>();
    private readonly machine_sinks = new Set<string>();

    constructor(context: SimulationContext, order: readonly InserterArchetype[],
        observe: (event: SchedulingEvent) => void = () => {}, state?: ActiveSchedulerState) {
        this.by_id = new Map(order.map(inserter => [inserter.entity_id.id, inserter]));
        const initial = state ?? {active_order: [...this.by_id.keys()], remaining_updates: null, pending_next_phase: []};
        assert([...initial.active_order, ...(initial.remaining_updates ?? []), ...initial.pending_next_phase]
            .every(id => this.by_id.has(id)), "Scheduler state refers to an unknown inserter");
        this.scheduler = new ActiveScheduler(initial, event => {
            observe(event);
            for (const observer of this.observers) observer(event);
        });
        for (const inserter of order) {
            const id = inserter.entity_id.id;
            const definition = inserter.inserter_state.inserter;
            const source = context.state_registry.getStateByEntityIdOrThrow(definition.source.entity_id);
            const sink = context.state_registry.getStateByEntityIdOrThrow(definition.sink.entity_id);
            if (EntityState.isMachine(source)) {
                this.machine_sources.add(id);
                source.yield.notifications.subscribeOutput(cause => this.scheduler.deliverAlarm(id, cause, true));
            }
            if (EntityState.isMachine(sink)) {
                this.machine_sinks.add(id);
                sink.yield.notifications.subscribeInput(cause => this.scheduler.deliverAlarm(id, cause, true));
            }
            inserter.hand.notifications.subscribe(cause => this.scheduler.deliverAlarm(id, cause, true));
        }
    }

    /** Diagnostic delivery does not enter the recurrence key. */
    public observe(observer: (event: SchedulingEvent) => void): void { this.observers.push(observer); }

    public beginUpdates(): void { this.scheduler.beginUpdates(); }

    public nextUpdate(): InserterArchetype | null {
        const id = this.scheduler.nextUpdate();
        return id === null ? null : this.by_id.get(id)!;
    }

    /** Sources without production notification coverage keep polling until their integration is validated. */
    public completeUpdate(inserter: InserterArchetype): void {
        const id = inserter.entity_id.id;
        // Planning controls may latch when asked. They retain polling until their own control
        // notification semantics exist; pure clock lookahead does not perform an extra latched read.
        if (!inserter.control.looks_ahead) return;
        const reason = inserter.hand.sleepReason();
        if (reason === "control-disabled" || (reason === "source-empty" && this.machine_sources.has(id))
            || (reason === "destination-refused" && this.machine_sinks.has(id))) {
            this.scheduler.deactivate(id, reason);
        }
    }

    /** Finish-dispatch edges arrive after entity Updates and are eligible in the next phase. */
    public finishControls(): void {
        for (const [id, inserter] of this.by_id) {
            const control = inserter.control;
            if (control.looks_ahead && !control.enabledIn(0) && control.enabledIn(1)) {
                this.scheduler.deliverAlarm(id, "control-finish-enable-edge", true);
            }
        }
    }

    public endUpdates(): void { this.scheduler.endUpdates(); }
    public state(): ActiveSchedulerState { return this.scheduler.state(); }
    public key(): string { return this.scheduler.key(); }
}
