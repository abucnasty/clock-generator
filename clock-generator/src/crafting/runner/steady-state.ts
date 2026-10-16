import { BeltState, DrillState, EntityState, InserterState, MachineState } from "../../state";
import { SimulationContext } from "../sequence";

function entityStateKey(state: EntityState, tick: number): string {
    const inventory = Object.entries(state.inventoryState.export()).sort(([a], [b]) => a.localeCompare(b));
    return `${JSON.stringify(inventory)};${ownStateKey(state, tick)}`;
}

/** What drives the entity besides its inventory; a chest has nothing else, a belt only the stacks on its lanes */
function ownStateKey(state: EntityState, tick: number): string {
    if (EntityState.isMachine(state)) {
        return MachineState.stateKey(state);
    }
    if (EntityState.isInserter(state)) {
        return InserterState.stateKey(state);
    }
    if (EntityState.isDrill(state)) {
        return DrillState.stateKey(state);
    }
    if (EntityState.isBelt(state)) {
        return BeltState.stateKey(state, tick);
    }
    return "";
}

/** Everything that drives the next ticks of the simulation; equal keys one period apart mean it repeats from here on */
export function simulationStateKey(context: SimulationContext): string {
    const tick = context.tick_provider.getCurrentTick();
    return [
        ...context.state_registry.getAllStates().map(it => entityStateKey(it, tick)),
        ...context.machines.map(it => it.stateKey(tick)),
        ...context.inserters.map(it => it.stateKey(tick)),
        ...context.drills.map(it => it.stateKey(tick)),
    ].join("\n");
}
