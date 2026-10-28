import type { TickProvider } from "../current-tick-provider";
import type { EnableControl } from "../controls/enable-control";
import type { EntityId } from "../../entities";
import { fullHandOf } from "../../entities/traits/hand";
import { EntityState } from "../../state/entity-state";
import type { InserterState } from "../../state/inserter-state";
import { inventoryKey } from "../../state/inventory-state";
import { Control } from "../components/control";
import { Hand, STAY } from "../components/hand";
import { bindHandPorts } from "../components/hand-ports";
import { InserterWakes } from "../components/inserter-wakes";
import { Observers } from "../observers/observer";
import type { InserterPhase } from "../status-codes";

/**
 * An inserter in a run: its Hand (phase, scratch, and the source's pickup port and the sink's drop port as it reaches
 * them), its Control and its Wakes, over its state (`InserterState`: what it holds and has moved, its status as written,
 * the pickup arm, whether it shows as enabled). A tick runs its steps in the phase table's order
 * (simulation/tick-phases.ts): the phase rule (on a change: the status written, the observers told, the exit and enter
 * steps), the phase's step, the tick's observers, then the Wakes.
 *
 * What watches it is told at the phase table's two event points of an inserter: a change of phase in its phase rule,
 * after its status is written and before the exit and enter steps (same-tick rule 17), with its Hand to answer the
 * reason; and its tick after its phase step, before its Wakes. Observers own nothing a later tick of it reads.
 *
 * A control swap keeps it (`useControl`, through `SimulationContext.useControls`): its Control asks the new control
 * and its Hand starts at IDLE with its scratch set back, while its status, its hand, the pickup arm, the belt lanes,
 * its ports and its observers are kept (same-tick rule 12).
 */
export class InserterArchetype {

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
    }): InserterArchetype {
        const { inserter_state, source_state, sink_state, tick_provider, enable_control } = args;
        const control = new Control(enable_control);
        // the hand's source's pickup port and its sink's drop port, with a fresh scratch record
        const ports = bindHandPorts({
            inserterState: inserter_state,
            sourceState: source_state,
            sinkState: sink_state,
            tick_provider,
            control,
        });
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
        const wakes = new InserterWakes(inserter_state, control);
        return new InserterArchetype(inserter_state, sink_state, hand, control, wakes);
    }

    public readonly entity_id: EntityId;
    /** What watches it (histories, the Factorio state, the transfers, debug output), by event in the order added */
    public readonly observers = new Observers<InserterPhase>();

    private constructor(
        public readonly inserter_state: InserterState,
        /** What it drops into, for the readers of the game's status of the inserter */
        public readonly sink_state: EntityState,
        public readonly hand: Hand,
        public readonly control: Control,
        public readonly wakes: InserterWakes,
    ) {
        this.entity_id = inserter_state.entity_id;
    }

    /**
     * A control swap (same-tick rule 12), between runs and never in a tick: the Control asks `next` from now on, and
     * the Hand starts at IDLE with its scratch set back, as an inserter built anew over the same state did. Its status
     * as written, its hand, the pickup arm, the belt lanes, its ports and its observers are kept, and nobody is told.
     */
    public useControl(next: EnableControl): void {
        this.control.use(next);
        this.hand.resetForSwap();
    }

    /**
     * The Hand's phase rule; on a change, the status written first, then the observers told in the order added, then
     * the exit and enter steps (same-tick rule 17). The Hand answers the reason: its number, and a template's text, are
     * made only for an observer that asks, while it records.
     */
    public phaseRule(): void {
        const hand = this.hand;
        const from = hand.phase;
        const to = hand.rule();
        if (to === STAY || to === from) {
            return;
        }
        hand.writeStatus(from, to);
        this.observers.tellStatusChange(from, to, hand);
        hand.exitAndEnter(from, to);
    }

    /** The phase's step: the pickup through the source's pickup port, the drop through the sink's drop port */
    public phaseStep(): void {
        this.hand.step();
    }

    /** The observers of its tick, in the order they were added */
    public tickObservers(): void {
        this.observers.tellTick();
    }

    /** The Wakes after the inserter's tick: whether the game shows it enabled, for its game status and the next tick */
    public endOfTick(): void {
        this.wakes.endOfTick();
    }

    /** A whole tick of the inserter, for callers that tick a context's entities by hand */
    public executeForTick(): void {
        this.phaseRule();
        this.phaseStep();
        this.tickObservers();
        this.endOfTick();
    }

    /**
     * The inserter's key (see simulationStateKey): its components' keys in a fixed order, "|" between them: what its hand
     * has carried by item (its Storage), its Hand (`Hand.key`: phase, scratch, ports and what it holds) and its Wakes
     * (whether it shows enabled); ticks relative to `tick`. Two equal keys one clock period apart mean the inserter
     * repeats. Its Control is the same in every tick of a run (a swap comes between runs) and the counts of items only
     * grow, so neither is keyed; observers only watch.
     */
    public stateKey(tick: number): string {
        return `${inventoryKey(this.inserter_state.inventoryState)}|${this.hand.key(tick)}|${this.wakes.key()}`;
    }
}
