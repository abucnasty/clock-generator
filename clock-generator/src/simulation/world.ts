import { MutableTickProvider } from "../control-logic";
import { DrillStateMachine } from "../control-logic/drill/drill-state-machine";
import { inserterUpdateOrder } from "../control-logic/inserter/competing-takers";
import { InserterStateMachine } from "../control-logic/inserter/inserter-state-machine";
import { MachineStateMachine } from "../control-logic/machine/machine-state-machine";
import { SimulationContext } from "../crafting/sequence/simulation-context";
import { BeltState, ChestState, EntityState } from "../state";

/**
 * The entities a tick runs, one array for each archetype, each in the order the phase table runs it
 * (simulation/tick-phases.ts), so that a phase's loop calls into one class only. A plain class with typed fields, not
 * a store keyed by names: what an archetype is follows from its field.
 *
 * Built once for each run of a context (`SimulationTick`), never in a tick. A context with other controls is another
 * context with new state machines (`cloneSimulationContextWithInterceptors`), and gets a World of its own; the states
 * the two share stay as they are (same-tick rule 12). A World is a snapshot of the context's arrays: state machines put
 * into a context after its SimulationTick is built are not run, so a swap builds a new context and a new step.
 *
 * Belts and containers are filled for the phases to come and read by no step yet; filling them costs one pass over the
 * registry for each World, never one in a tick.
 */
export class World {
    private constructor(
        public readonly tick_provider: MutableTickProvider,
        /** In the order of the state registry, which is the config's */
        public readonly drills: readonly DrillStateMachine[],
        /** Takers before feeders, the takers of one machine in the context's taker order (`inserterUpdateOrder`) */
        public readonly inserters: readonly InserterStateMachine[],
        /** In config order */
        public readonly machines: readonly MachineStateMachine[],
        /** In config order; a belt has no step of its own in a tick yet */
        public readonly belts: readonly BeltState[],
        /** In config order; a container has no step of its own in a tick yet */
        public readonly containers: readonly ChestState[],
    ) {}

    public static of(context: SimulationContext): World {
        const states = context.state_registry.getAllStates();
        return new World(
            context.tick_provider,
            [...context.drills],
            inserterUpdateOrder(context.inserters, context.state_registry, context.competing_takers_order),
            [...context.machines],
            states.filter(EntityState.isBelt),
            states.filter(EntityState.isChest),
        );
    }
}
