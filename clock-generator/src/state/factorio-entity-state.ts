import { handSizeFor } from "../entities";
import { EntityState } from "./entity-state";
import { InserterState, InserterStatus } from "./inserter-state";
import { MachineState, MachineStatus } from "./machine-state";
import { DrillState, DrillStatus } from "./drill-state";

/**
 * The state an entity would show in Factorio, named as the game names it (`defines.entity_status`, as the recorder
 * writes it). The simulator keeps its own finer phases for debugging; this is the shared language with the game,
 * for the timeline and for laying a run against a recording.
 */
export const FactorioInserterState = {
    WORKING: "working",
    WAITING_FOR_SOURCE_ITEMS: "waiting_for_source_items",
    /** A partly filled hand waiting for more items, at a machine that has not made them yet or at a gap on a belt */
    WAITING_FOR_MORE_ITEMS: "waiting_for_more_items",
    WAITING_FOR_SPACE_IN_DESTINATION: "waiting_for_space_in_destination",
    DISABLED_BY_CONTROL_BEHAVIOR: "disabled_by_control_behavior",
} as const;
export type FactorioInserterState = typeof FactorioInserterState[keyof typeof FactorioInserterState];

export const FactorioMachineState = {
    WORKING: "working",
    ITEM_INGREDIENT_SHORTAGE: "item_ingredient_shortage",
    FULL_OUTPUT: "full_output",
    NO_FUEL: "no_fuel",
} as const;
export type FactorioMachineState = typeof FactorioMachineState[keyof typeof FactorioMachineState];

export const FactorioDrillState = {
    WORKING: "working",
    DISABLED_BY_CONTROL_BEHAVIOR: "disabled_by_control_behavior",
} as const;
export type FactorioDrillState = typeof FactorioDrillState[keyof typeof FactorioDrillState];

export type FactorioEntityState = FactorioInserterState | FactorioMachineState | FactorioDrillState;

/** True while the sink of an inserter takes nothing from anyone: a machine that takes no item, or a full chest */
function sinkTakesNothing(sink: EntityState): boolean {
    if (EntityState.isMachine(sink)) {
        return MachineState.takesNothing(sink);
    }
    if (EntityState.isChest(sink)) {
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
 *   MachineState.takesNothing), also while the arm is still on its way back from the drop. While the sink takes
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

export function factorioDrillState(state: DrillState): FactorioDrillState {
    return state.status === DrillStatus.DISABLED
        ? FactorioDrillState.DISABLED_BY_CONTROL_BEHAVIOR
        : FactorioDrillState.WORKING;
}
