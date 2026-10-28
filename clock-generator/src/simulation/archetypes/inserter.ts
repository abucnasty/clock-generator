import type { ControlLogic } from "../../control-logic/control-logic";
import type { TickProvider } from "../../control-logic/current-tick-provider";
import type { EnableControl } from "../../control-logic/enable-control";
import type { EntityId } from "../../entities";
import { fullHandOf } from "../../entities/traits/hand";
import { EntityState } from "../../state/entity-state";
import type { InserterState } from "../../state/inserter-state";
import { Control } from "../components/control";
import { Hand, STAY } from "../components/hand";
import { bindHandPorts } from "../components/hand-ports";
import { InserterWakes } from "../components/inserter-wakes";
import type { InserterPhase } from "../status-codes";

/**
 * What watches an inserter (histories, the Factorio state, the transfers, debug output): told of each change of its
 * phase in its phase rule, after its status is written and before the exit and enter steps (same-tick rule 17), and
 * after the inserter's step in every tick, before its Wakes. It owns nothing a later tick of the inserter reads.
 */
export interface InserterObserver {
    /** A change of phase, with the number of its reason in the reason table (`reasonText` gives its text) */
    onStatusChange?(from: InserterPhase, to: InserterPhase, reason_id: number): void;
    /** After the inserter's phase step, every tick, in the order the observers were added */
    executeForTick?(): void;
}

/** The enable control where it is also a ControlLogic, to run each tick: none is (the control tick goes in R16) */
function tickingControlOf(enable_control: EnableControl): ControlLogic | null {
    return "executeForTick" in enable_control ? enable_control as unknown as ControlLogic : null;
}

/**
 * An inserter in a run: its Hand (phase, scratch, and the source's pickup port and the sink's drop port as it reaches
 * them), its Control and its Wakes, over its state (`InserterState`: what it holds and has moved, its status as written,
 * the pickup arm, whether it shows as enabled), which every context over the build shares. A tick runs its steps in the
 * phase table's order (simulation/tick-phases.ts): the control's own tick, the phase rule (on a change: the status
 * written, the observers told, the exit and enter steps), the phase's step, the tick's observers, then the Wakes.
 *
 * A control swap builds a new one over the same state (`cloneSimulationContextWithInterceptors`): it starts at IDLE with
 * a fresh scratch and the observers of the old one, while its status, its hand, the pickup arm and the belt lanes are
 * kept (same-tick rule 12).
 */
export class InserterArchetype implements ControlLogic {

    /**
     * The inserter with its hand bound to its source's pickup port and its sink's drop port, and to what it reads of its
     * sink machine and its source, under `enable_control`
     */
    public static create(args: {
        inserter_state: InserterState,
        source_state: EntityState,
        sink_state: EntityState,
        tick_provider: TickProvider,
        enable_control: EnableControl,
        observers?: InserterObserver[],
    }): InserterArchetype {
        const { inserter_state, source_state, sink_state, tick_provider, enable_control, observers = [] } = args;
        // the hand's source's pickup port and its sink's drop port, with a fresh scratch record (same-tick rule 12)
        const ports = bindHandPorts({
            inserterState: inserter_state,
            sourceState: source_state,
            sinkState: sink_state,
            tick_provider,
            decider_build_order: enable_control.decider_build_order,
        });
        const control = new Control(enable_control);
        const sink_machine = EntityState.isMachine(sink_state) ? sink_state : null;
        const hand = new Hand(inserter_state, ports.scratch, ports.items, ports.pickup, ports.drop, control, tick_provider, {
            sink_wakes: sink_machine === null ? null : sink_machine.wakes,
            sink_ingress: sink_machine === null ? null : sink_machine.ingress,
            from_belt: EntityState.isBelt(source_state),
            // at a machine that places its results itself, an inserter that does not wait for a full hand there (its Hand
            // trait, from the prototype's data: no bulk one) swings what it holds (rule 18)
            swings_part_hands: EntityState.isMachine(source_state) && source_state.machine.metadata.places_results === true
                && !fullHandOf(inserter_state.inserter.metadata.type).at_placing_source,
            swing_ticks: inserter_state.inserter.animation.rotation.ticks,
        });
        return new InserterArchetype(inserter_state, sink_state, hand, control, new InserterWakes(inserter_state, control),
            tickingControlOf(enable_control), observers);
    }

    public readonly entity_id: EntityId;
    /** The observers that do something every tick; most only watch changes of phase */
    private readonly tick_observers: InserterObserver[];

    private constructor(
        public readonly inserter_state: InserterState,
        /** What it drops into, for the readers of the game's status of the inserter */
        public readonly sink_state: EntityState,
        public readonly hand: Hand,
        public readonly control: Control,
        public readonly wakes: InserterWakes,
        /** The enable control when it runs each tick too: none does (the dead control tick, dropped in R16) */
        private readonly ticking_control: ControlLogic | null,
        private readonly observers: InserterObserver[],
    ) {
        this.entity_id = inserter_state.entity_id;
        this.tick_observers = observers.filter(observer => observer.executeForTick);
    }

    /** The enable control's own tick, where it has one */
    public tickControl(): void {
        if (this.ticking_control !== null) {
            this.ticking_control.executeForTick();
        }
    }

    /**
     * The Hand's phase rule; on a change, the status written first, then the observers told in the order added, then
     * the exit and enter steps (same-tick rule 17). The reason's number is made only for a change someone watches.
     */
    public phaseRule(): void {
        const hand = this.hand;
        const from = hand.phase;
        const to = hand.rule();
        if (to === STAY || to === from) {
            return;
        }
        hand.writeStatus(from, to);
        const observers = this.observers;
        if (observers.length > 0) {
            const reason_id = hand.reasonId();
            for (let index = 0; index < observers.length; index++) {
                observers[index].onStatusChange?.(from, to, reason_id);
            }
        }
        hand.exitAndEnter(from, to);
    }

    /** The phase's step: the pickup through the source's pickup port, the drop through the sink's drop port */
    public phaseStep(): void {
        this.hand.step();
    }

    /** The observers that do something every tick, in the order they were added */
    public tickObservers(): void {
        const tick_observers = this.tick_observers;
        for (let index = 0; index < tick_observers.length; index++) {
            tick_observers[index].executeForTick!();
        }
    }

    /** The Wakes after the inserter's tick: whether the game shows it enabled, for its game status and the next tick */
    public endOfTick(): void {
        this.wakes.endOfTick();
    }

    /** A whole tick of the inserter, for callers that tick a context's entities by hand */
    public executeForTick(): void {
        this.tickControl();
        this.phaseRule();
        this.phaseStep();
        this.tickObservers();
        this.endOfTick();
    }

    public addObserver(observer: InserterObserver): void {
        this.observers.push(observer);
        if (observer.executeForTick) {
            this.tick_observers.push(observer);
        }
    }

    /** Takes these observers off, for a run whose observations nobody reads any more */
    public removeObservers(observers: ReadonlySet<object>): void {
        for (const list of [this.observers, this.tick_observers]) {
            const kept = list.filter(observer => !observers.has(observer));
            list.length = 0;
            for (const observer of kept) {
                list.push(observer);
            }
        }
    }

    public getObservers(): InserterObserver[] {
        return [...this.observers];
    }

    /**
     * Its phase and what its Hand keeps from one tick to the next, with the text the inserter's mode state machine gave
     * them before (`Hand.key`); with its state's key (`InserterState.stateKey`), two equal keys one clock period apart
     * mean the inserter repeats. Observers only watch.
     */
    public stateKey(tick: number): string {
        return this.hand.key(tick);
    }
}
