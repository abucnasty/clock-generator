import { DrillState, EntityState, InserterState, MachineState } from "../../state";
import { SimulationContext } from "../sequence";

function entityStateKey(state: EntityState): string {
    const inventory = Object.entries(state.inventoryState.export()).sort(([a], [b]) => a.localeCompare(b));
    return `${JSON.stringify(inventory)};${ownStateKey(state)}`;
}

/** What drives the entity besides its inventory; a belt or a chest has nothing else */
function ownStateKey(state: EntityState): string {
    if (EntityState.isMachine(state)) {
        return MachineState.stateKey(state);
    }
    if (EntityState.isInserter(state)) {
        return InserterState.stateKey(state);
    }
    if (EntityState.isDrill(state)) {
        return DrillState.stateKey(state);
    }
    return "";
}

/** Everything that drives the next ticks of the simulation; equal keys one period apart mean it repeats from here on */
export function simulationStateKey(context: SimulationContext): string {
    const tick = context.tick_provider.getCurrentTick();
    return [
        ...context.state_registry.getAllStates().map(entityStateKey),
        ...context.machines.map(it => it.stateKey(tick)),
        ...context.inserters.map(it => it.stateKey(tick)),
        ...context.drills.map(it => it.stateKey(tick)),
    ].join("\n");
}
