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
    /** A partly filled hand waiting at the belt for more items: only with belt gaps, which the simulator has none of */
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

/** The game shows every movement as working, and tells an idle inserter's wait apart by what it waits for */
export function factorioInserterState(state: InserterState): FactorioInserterState {
    switch (state.status) {
        case InserterStatus.DISABLED:
            return FactorioInserterState.DISABLED_BY_CONTROL_BEHAVIOR;
        case InserterStatus.PICKUP:
        case InserterStatus.SWING:
        case InserterStatus.DROP_OFF:
            return FactorioInserterState.WORKING;
        case InserterStatus.WAITING_FOR_SINK:
        case InserterStatus.TARGET_FULL:
            return FactorioInserterState.WAITING_FOR_SPACE_IN_DESTINATION;
        case InserterStatus.IDLE:
            return state.waits_for_sink
                ? FactorioInserterState.WAITING_FOR_SPACE_IN_DESTINATION
                : FactorioInserterState.WAITING_FOR_SOURCE_ITEMS;
    }
}

export function factorioMachineState(state: MachineState): FactorioMachineState {
    switch (state.status) {
        case MachineStatus.WORKING:
            return FactorioMachineState.WORKING;
        case MachineStatus.OUTPUT_FULL:
            return FactorioMachineState.FULL_OUTPUT;
        case MachineStatus.NO_FUEL:
            return FactorioMachineState.NO_FUEL;
        case MachineStatus.INGREDIENT_SHORTAGE:
            return FactorioMachineState.ITEM_INGREDIENT_SHORTAGE;
    }
}

export function factorioDrillState(state: DrillState): FactorioDrillState {
    return state.status === DrillStatus.DISABLED
        ? FactorioDrillState.DISABLED_BY_CONTROL_BEHAVIOR
        : FactorioDrillState.WORKING;
}
