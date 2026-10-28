import { EntityState } from "../../state";
import { SimulationContext } from "../sequence";
import { ContainerStorage } from "../../simulation/components/container-storage";

/**
 * Everything that drives the next ticks of the simulation; equal keys one period apart mean it repeats from here on.
 * One line for each entity, by archetype in a fixed order: the belts and then the containers in the order of the state
 * registry (config order), then the machines, the inserters and the drills in the order of the context's lists. Each
 * archetype writes its line from its components' keys (simulation/archetypes, simulation/components); what changes no
 * later tick (running totals, caches, what is bound at build) is in none of them. Belts are keyed first: their lanes
 * bring their traffic and stock up to the tick as they are keyed.
 */
export function simulationStateKey(context: SimulationContext): string {
    const tick = context.tick_provider.getCurrentTick();
    const states = context.state_registry.getAllStates();
    return [
        ...states.filter(EntityState.isBelt).map(belt => belt.stateKey(tick)),
        ...states.filter(ContainerStorage.is).map(container => container.key()),
        ...context.machines.map(machine => machine.stateKey()),
        ...context.inserters.map(inserter => inserter.stateKey(tick)),
        ...context.drills.map(drill => drill.stateKey()),
    ].join("\n");
}
