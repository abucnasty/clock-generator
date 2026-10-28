import assert from "../../common/assert";
import type { ControlLogic } from "../../control-logic/control-logic";
import { AlwaysEnabledControl, EnableControl } from "../../control-logic/enable-control";
import { reasonId } from "../../control-logic/mode/reason-table";
import type { DrillState } from "../../state/drill-state";
import { assertIsMachineState, EntityState } from "../../state/entity-state";
import { ContainerStorage } from "../components/container-storage";
import { Control } from "../components/control";
import { MachinePlacementPort } from "../components/machine-placement-port";
import { Mining } from "../components/mining";
import { DrillStatusCode, drillStatusOf } from "../status-codes";

/** The reasons of a drill's two changes of status, numbered once */
const DRILL_ENABLED = reasonId("drill enabled");
const DRILL_DISABLED = reasonId("drill disabled");

/**
 * What watches a drill (histories, the Factorio state, debug output): told of each change of its status, before the
 * drill drops or mines in that tick (same-tick rule 17), and after the drill's step in every tick. It owns nothing a
 * later tick of the drill reads.
 */
export interface DrillObserver {
    /** A change of status, with the number of its reason in the reason table */
    onStatusChange?(from: DrillStatusCode, to: DrillStatusCode, reason_id: number): void;
    /** After the drill's step, every tick, in the order the observers were added */
    executeForTick?(): void;
}

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
 * A control swap keeps it (`useControl`, through `SimulationContext.useControls`): its Control asks the new control
 * and it starts WORKING with both bars at 0, while what it holds, its Placement and its observers are kept (same-tick
 * rule 12).
 *
 * Its status starts WORKING; `DrillState.status`, which the Factorio state reads, is never written (a known quirk, kept).
 */
export class MiningDrillArchetype implements ControlLogic {

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
    private readonly observers: DrillObserver[] = [];
    /** The observers that do something every tick; most only watch changes of status */
    private readonly tick_observers: DrillObserver[] = [];

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
                this.changeStatus(DrillStatusCode.DISABLED_BY_CONTROL_BEHAVIOR, DRILL_DISABLED);
            }
        } else if (enabled) {
            this.changeStatus(DrillStatusCode.WORKING, DRILL_ENABLED);
        }
    }

    /** Working: drop what it holds, and only when nothing is left mine. Disabled: keeps what it holds and both bars */
    public miningStep(): void {
        if (this.status === DrillStatusCode.WORKING) {
            this.mining.tick();
        }
    }

    /** The observers that do something every tick, in the order they were added */
    public tickObservers(): void {
        const tick_observers = this.tick_observers;
        for (let index = 0; index < tick_observers.length; index++) {
            tick_observers[index].executeForTick!();
        }
    }

    /** A whole tick of the drill, for callers that tick a context's entities by hand */
    public executeForTick(): void {
        this.controlRule();
        this.miningStep();
        this.tickObservers();
    }

    /** Observers first, then the status written (same-tick rule 17); a drill has no exit or enter steps */
    private changeStatus(to: DrillStatusCode, reason_id: number): void {
        const from = this.status;
        const observers = this.observers;
        for (let index = 0; index < observers.length; index++) {
            observers[index].onStatusChange?.(from, to, reason_id);
        }
        this.status = to;
    }

    public addObserver(observer: DrillObserver): void {
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

    public getObservers(): DrillObserver[] {
        return [...this.observers];
    }

    /**
     * Its status and both bars, with the text the drill's mode state machine gave them before (the status, the working
     * mode's bars, then the empty keys of its evaluators and its disabled mode); two equal keys one clock period apart
     * mean the drill repeats. Observers only watch.
     */
    public stateKey(): string {
        return `${drillStatusOf(this.status)}|${this.mining.stateKey()}|||`;
    }
}
