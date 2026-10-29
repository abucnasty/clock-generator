import { handSizeFor } from "../entities";
import { EntityState } from "./entity-state";
import { InserterState } from "./inserter-state";
import { MachineState } from "./machine-state";
import { DrillState } from "./drill-state";
import { InserterStatus, MachineStatus } from "./entity-status";
import { FactorioDrillState, FactorioInserterState, FactorioMachineState } from "./factorio-state-names";
import { ContainerStorage } from "../simulation/components/container-storage";
import { DrillStatusCode } from "../simulation/status-codes";

export { FactorioInserterState, FactorioMachineState, FactorioDrillState } from "./factorio-state-names";

/** True while the sink of an inserter takes nothing from anyone: a machine that takes no item, or a full chest */
function sinkTakesNothing(sink: EntityState): boolean {
    if (EntityState.isMachine(sink)) {
        return sink.ingress.takesNothing();
    }
    if (ContainerStorage.is(sink)) {
        return sink.isFull();
    }
    return false;
}

/**
 * The state the game shows for an inserter, as recorded in Factorio 2.1.21 on five builds (agricultural and
 * automation science, low density structure, iron bacteria; 36,000 ticks each).
 *
 * Its sink decides before the inserter does, and not by what the inserter carries:
 * - Switched off by its circuit condition, it shows as disabled from that tick on, also while it finishes the swing
 *   and the drop it had begun: a window of 4 ticks shows as 4 ticks that are not disabled.
 * - With an empty hand, it waits for space in the destination while the sink takes nothing from anyone (see
 *   Ingress.takesNothing), also while the arm is still on its way back from the drop. While the sink takes
 *   anything, it is working on its way back and waits for source items once it is there with nothing to take, also
 *   when the sink takes nothing of what this inserter brings.
 * - With a hand it is filling, it is working while it grabs, waits for more items between grabs, and waits for
 *   space in the destination once the sink takes nothing.
 * - With a full hand it is working, until what it holds does not fit: a hand goes onto a belt a stack at a time and
 *   waits for space in between, and into a chest as far as there is room.
 *
 * The rule for a waiting inserter names the recorded state of every waiting sample but 188 of 328,042.
 */
export function factorioInserterState(state: InserterState, sink: EntityState): FactorioInserterState {
    if (!state.enabled) {
        return FactorioInserterState.DISABLED_BY_CONTROL_BEHAVIOR;
    }
    const held = state.held_item;
    // on a clock of the game an inserter shows as enabled the tick before it can act, and waits in that tick
    const waits = state.status === InserterStatus.IDLE || state.status === InserterStatus.WAITING_FOR_SINK
        || state.status === InserterStatus.DISABLED;
    if (held === null) {
        if (sinkTakesNothing(sink)) {
            return FactorioInserterState.WAITING_FOR_SPACE_IN_DESTINATION;
        }
        return waits ? FactorioInserterState.WAITING_FOR_SOURCE_ITEMS : FactorioInserterState.WORKING;
    }
    if (waits) {
        return sinkTakesNothing(sink)
            ? FactorioInserterState.WAITING_FOR_SPACE_IN_DESTINATION
            : FactorioInserterState.WAITING_FOR_MORE_ITEMS;
    }
    const dropped_part = state.status === InserterStatus.DROP_OFF && held.quantity < handSizeFor(state.inserter, held.item_name);
    return dropped_part || state.status === InserterStatus.TARGET_FULL
        ? FactorioInserterState.WAITING_FOR_SPACE_IN_DESTINATION
        : FactorioInserterState.WORKING;
}

/** The state the game shows for a machine, by the status the simulator keeps for it */
export const FACTORIO_MACHINE_STATE: Readonly<Record<MachineStatus, FactorioMachineState>> = {
    [MachineStatus.WORKING]: FactorioMachineState.WORKING,
    [MachineStatus.OUTPUT_FULL]: FactorioMachineState.FULL_OUTPUT,
    [MachineStatus.NO_FUEL]: FactorioMachineState.NO_FUEL,
    [MachineStatus.INGREDIENT_SHORTAGE]: FactorioMachineState.ITEM_INGREDIENT_SHORTAGE,
};

export function factorioMachineState(state: MachineState): FactorioMachineState {
    return FACTORIO_MACHINE_STATE[state.status];
}

/**
 * The state the game shows for a drill that is not disabled: waiting for space in its destination while it holds an item
 * its destination takes no room for (a full chest, a machine at its stop), else working. An item it has just mined and
 * will drop in the next tick is not waiting.
 */
export function factorioDrillStateWhileEnabled(state: DrillState): FactorioDrillState {
    return state.placement.blocked()
        ? FactorioDrillState.WAITING_FOR_SPACE_IN_DESTINATION
        : FactorioDrillState.WORKING;
}

/**
 * The state of a drill as its ticks go by it: disabled by its control while its status is DISABLED, else
 * `factorioDrillStateWhileEnabled`. The game shows a disabled drill one tick before it stops (see `DrillStateTracker`).
 */
export function factorioDrillState(state: DrillState): FactorioDrillState {
    return state.status_code === DrillStatusCode.DISABLED_BY_CONTROL_BEHAVIOR
        ? FactorioDrillState.DISABLED_BY_CONTROL_BEHAVIOR
        : factorioDrillStateWhileEnabled(state);
}
