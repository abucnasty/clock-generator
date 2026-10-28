import assert from "../../common/assert";
import { AlwaysEnabledControl, EnableControl } from "../controls/enable-control";
import { reasonId } from "../../state/reason-table";
import type { DrillState } from "../../state/drill-state";
import { assertIsMachineState, EntityState } from "../../state/entity-state";
import { ContainerStorage } from "../components/container-storage";
import { Control } from "../components/control";
import { MachinePlacementPort } from "../components/machine-placement-port";
import { Mining } from "../components/mining";
import { Observers, StatusChangeReason } from "../observers/observer";
import { DrillStatusCode } from "../status-codes";

/** The reasons of a drill's two changes of status, numbered once */
const DRILL_ENABLED = reasonId("drill enabled");
const DRILL_DISABLED = reasonId("drill disabled");

/**
 * Binds the drill's Placement to its target: a chest drops by the chest's own rules (slots for a car, a tank or a
 * wagon; weight and routing for a rocket silo; one item for a buffer chest), a machine up to the drill's stop through
 * its placement port. Throws where the target is neither, or is a buffer chest of another item.
 */
export function placeDrillInto(state: DrillState, sink_state: EntityState): void {
    if (ContainerStorage.is(sink_state)) {
        if (ContainerStorage.isSingleItem(sink_state)) {
            assert(sink_state.chest.item_filter === state.drill.item.name,
                `Drill ${state.drill.entity_id.id} mines ${state.drill.item.name} into buffer chest ${sink_state.entity_id.id}, which holds ${sink_state.chest.item_filter}`);
        }
        state.placement.placeInto(sink_state, false);
        return;
    }
    assertIsMachineState(sink_state);
    state.placement.placeInto(new MachinePlacementPort(sink_state, [state.drill.item.name]), true);
}

/**
 * A mining drill in a run: its held Storage and Placement (its `DrillState`), its Mining and its Control. A tick runs
 * its steps in the phase table's order (simulation/tick-phases.ts): the control rule, then, while working, Mining
 * (drop, then mine), then the observers of the tick.
 *
 * What watches it is told at the phase table's two event points of a drill: a change of status in its control rule,
 * before the status is written and before it drops or mines in that tick (same-tick rule 17), with the drill to answer
 * the reason; and its tick after its mining. Observers own nothing a later tick of it reads.
 *
 * A control swap keeps it (`useControl`, through `SimulationContext.useControls`): its Control asks the new control
 * and it starts WORKING with both bars at 0, while what it holds, its Placement and its observers are kept (same-tick
 * rule 12).
 *
 * Its status starts WORKING; `DrillState.status`, which the Factorio state reads, is never written (a known quirk, kept).
 */
export class MiningDrillArchetype implements StatusChangeReason<DrillStatusCode> {

    public static create(args: {
        drill_state: DrillState,
        sink_state: EntityState,
        enable_control?: EnableControl,
    }): MiningDrillArchetype {
        const { drill_state, sink_state, enable_control = AlwaysEnabledControl } = args;
        placeDrillInto(drill_state, sink_state);
        return new MiningDrillArchetype(drill_state, Mining.forDrill(drill_state), new Control(enable_control));
    }

    public status: DrillStatusCode = DrillStatusCode.WORKING;
    /** What watches it (histories, the Factorio state, the transfers, debug output), by event in the order added */
    public readonly observers = new Observers<DrillStatusCode>();

    private constructor(
        public readonly drill_state: DrillState,
        public readonly mining: Mining,
        public readonly control: Control,
    ) { }

    /**
     * A control swap (same-tick rule 12), between runs and never in a tick: the Control asks `next` from now on, and
     * the drill is WORKING with both bars at 0, as a drill built anew over the same state was. What it holds, its
     * Placement (bound to the same target) and its observers are kept, and nobody is told of the status.
     */
    public useControl(next: EnableControl): void {
        this.control.use(next);
        this.status = DrillStatusCode.WORKING;
        this.mining.resetForSwap();
    }

    /** The control asked, once a tick: working while it enables the drill, else disabled */
    public controlRule(): void {
        const enabled = this.control.enabled();
        if (this.status === DrillStatusCode.WORKING) {
            if (!enabled) {
                this.changeStatus(DrillStatusCode.DISABLED_BY_CONTROL_BEHAVIOR);
            }
        } else if (enabled) {
            this.changeStatus(DrillStatusCode.WORKING);
        }
    }

    /** Working: drop what it holds, and only when nothing is left mine. Disabled: keeps what it holds and both bars */
    public miningStep(): void {
        if (this.status === DrillStatusCode.WORKING) {
            this.mining.tick();
        }
    }

    /** The observers of its tick, in the order they were added */
    public tickObservers(): void {
        this.observers.tellTick();
    }

    /** A whole tick of the drill, for callers that tick a context's entities by hand */
    public executeForTick(): void {
        this.controlRule();
        this.miningStep();
        this.tickObservers();
    }

    /** The number of the reason of a change of status being told, by the status it changes to: both texts are fixed */
    public reasonId(from: DrillStatusCode, to: DrillStatusCode): number {
        return to === DrillStatusCode.WORKING ? DRILL_ENABLED : DRILL_DISABLED;
    }

    /** Observers first, then the status written (same-tick rule 17); a drill has no exit or enter steps */
    private changeStatus(to: DrillStatusCode): void {
        this.observers.tellStatusChange(this.status, to, this);
        this.status = to;
    }

    /**
     * The drill's key (see simulationStateKey): its components' keys in a fixed order, "|" between them: what it holds
     * (its held Storage), its status as its code, and both bars (its Mining). Two equal keys one clock period apart mean
     * the drill repeats. Its Placement holds a running total and its Control is the same in every tick of a run, so
     * neither is keyed, nor is `DrillState.status`, never written; observers only watch.
     */
    public stateKey(): string {
        return `${this.drill_state.held.key()}|${this.status}|${this.mining.key()}`;
    }
}
