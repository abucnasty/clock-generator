import { objectStateKey } from "../../control-logic/mode/mode-state-machine";
import { EntityState } from "../../state";
import { SimulationContext } from "../sequence";

// running totals only grow, so they never repeat and do not drive the simulation;
// an inserter state's `tick` is never updated, so relative to the current tick it would never repeat either
const COUNTER_FIELDS = new Set(["craftCount", "totalCrafted", "tick"]);

function entityStateKey(state: EntityState, tick: number): string {
    const progress = (state as { craftingProgress?: { progress: number }; bonusProgress?: { progress: number } });
    const inventory = Object.entries(state.inventoryState.export()).sort(([a], [b]) => a.localeCompare(b));
    return [
        objectStateKey(state, tick, COUNTER_FIELDS),
        JSON.stringify(inventory),
        JSON.stringify((state as { held_item?: unknown }).held_item ?? null),
        progress.craftingProgress?.progress,
        progress.bonusProgress?.progress,
    ].join(";");
}

/** Everything that drives the next ticks of the simulation; equal keys one period apart mean it repeats from here on */
export function simulationStateKey(context: SimulationContext): string {
    const tick = context.tick_provider.getCurrentTick();
    return [
        ...context.state_registry.getAllStates().map(state => entityStateKey(state, tick)),
        ...context.machines.map(it => it.stateKey(tick)),
        ...context.inserters.map(it => it.stateKey(tick)),
        ...context.drills.map(it => it.stateKey(tick)),
    ].join("\n");
}
