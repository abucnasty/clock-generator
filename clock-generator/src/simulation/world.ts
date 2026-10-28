import { MutableTickProvider } from "../control-logic";
import { inserterUpdateOrder } from "../control-logic/inserter/competing-takers";
import { CraftingMachineArchetype } from "./archetypes/crafting-machine";
import { InserterArchetype } from "./archetypes/inserter";
import { SimulationContext } from "../crafting/sequence/simulation-context";
import { EntityState } from "../state";
import { ContainerStorage } from "./components/container-storage";
import { TransportBelt } from "./archetypes/transport-belt";
import { MiningDrillArchetype } from "./archetypes/mining-drill";

/**
 * The entities a tick runs, one array for each archetype, each in the order the phase table runs it
 * (simulation/tick-phases.ts), so that a phase's loop calls into one class only. A plain class with typed fields, not
 * a store keyed by names: what an archetype is follows from its field.
 *
 * Built once for each run of a context (`SimulationTick`), never in a tick. A World is a snapshot of the context's
 * arrays: archetypes put into a context after its SimulationTick is built are not run. A control swap
 * (`SimulationContext.useControls`) puts no archetype in: it points each inserter's and drill's Control at its new
 * control and sets their Hands, statuses and bars back in place (same-tick rule 12), so a World of the context runs the
 * new controls.
 *
 * Belts and containers are filled for the phases to come and read by no step yet; filling them costs one pass over the
 * registry for each World, never one in a tick.
 */
export class World {
    private constructor(
        public readonly tick_provider: MutableTickProvider,
        /** In the order of the state registry, which is the config's */
        public readonly drills: readonly MiningDrillArchetype[],
        /** Takers before feeders, the takers of one machine in the context's taker order (`inserterUpdateOrder`) */
        public readonly inserters: readonly InserterArchetype[],
        /** In config order */
        public readonly machines: readonly CraftingMachineArchetype[],
        /** In config order; a belt has no step of its own in a tick yet */
        public readonly belts: readonly TransportBelt[],
        /** In config order; a container has no step of its own in a tick yet */
        public readonly containers: readonly ContainerStorage[],
    ) {}

    public static of(context: SimulationContext): World {
        const states = context.state_registry.getAllStates();
        return new World(
            context.tick_provider,
            [...context.drills],
            inserterUpdateOrder(context.inserters, context.state_registry, context.competing_takers_order),
            [...context.machines],
            states.filter(EntityState.isBelt),
            states.filter(ContainerStorage.is),
        );
    }
}
