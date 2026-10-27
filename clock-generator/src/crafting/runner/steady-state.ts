import { BeltState, DrillState, EntityState, InserterState, MachineState } from "../../state";
import { SupplyGate } from "../../state/supply-gate";
import { SimulationContext } from "../sequence";

function entityStateKey(state: EntityState, tick: number): string {
    const inventory = Object.entries(state.inventoryState.export()).sort(([a], [b]) => a.localeCompare(b));
    return `${JSON.stringify(inventory)};${supplyKey(state)};${ownStateKey(state, tick)}`;
}

/**
 * What a belt or chest withholds or refuses during a backpressure loss. Every key today is taken with the gates open
 * (losses key only after the supply is restored), so this guards against a key ever being read mid-loss.
 */
function supplyKey(state: EntityState): string {
    const supply = (state as { supply?: SupplyGate }).supply;
    if (supply === undefined || supply.isOpen()) {
        return "";
    }
    return `W:${Array.from(supply.withheld).sort().join(",")};R:${Array.from(supply.refused).sort().join(",")}`;
}

/** What drives the entity besides its inventory; a chest has nothing else, a belt only the stacks on its lanes */
function ownStateKey(state: EntityState, tick: number): string {
    if (EntityState.isMachine(state)) {
        return MachineState.stateKey(state);
    }
    if (EntityState.isInserter(state)) {
        return InserterState.stateKey(state, tick);
    }
    if (EntityState.isDrill(state)) {
        return DrillState.stateKey(state);
    }
    if (EntityState.isBelt(state)) {
        return BeltState.stateKey(state, tick);
    }
    if (EntityState.isSlotContainer(state) || EntityState.isRocketSilo(state)) {
        return state.slotKey();
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
