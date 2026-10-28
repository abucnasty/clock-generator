import { DrillStatus, InserterStatus, MachineStatus } from "../state/entity-status";
import { FactorioDrillState, FactorioMachineState } from "../state/factorio-state-names";

// Small integer codes for what a component keeps in a tick, one to one with the strings of state/entity-status.ts.
// Histories, the UI, the recorder comparison and the digest keep the strings (P4 decision D3): a code maps to its string
// where an observer records it. The codes of a recorded history are another table (state/status-codes.ts).

/** A machine's crafting status, named after `defines.entity_status` of the game's runtime API */
export const CraftingStatus = {
    WORKING: 0,
    ITEM_INGREDIENT_SHORTAGE: 1,
    FULL_OUTPUT: 2,
    NO_FUEL: 3,
} as const;
export type CraftingStatus = typeof CraftingStatus[keyof typeof CraftingStatus];

/** The name of each crafting status in `defines.entity_status`, by its code */
export const CRAFTING_STATUS_DEFINES: readonly FactorioMachineState[] = [
    FactorioMachineState.WORKING,
    FactorioMachineState.ITEM_INGREDIENT_SHORTAGE,
    FactorioMachineState.FULL_OUTPUT,
    FactorioMachineState.NO_FUEL,
];

const MACHINE_STATUS_OF_CODE: readonly MachineStatus[] = [
    MachineStatus.WORKING,
    MachineStatus.INGREDIENT_SHORTAGE,
    MachineStatus.OUTPUT_FULL,
    MachineStatus.NO_FUEL,
];

const CRAFTING_STATUS_OF: Readonly<Record<MachineStatus, CraftingStatus>> = {
    [MachineStatus.WORKING]: CraftingStatus.WORKING,
    [MachineStatus.INGREDIENT_SHORTAGE]: CraftingStatus.ITEM_INGREDIENT_SHORTAGE,
    [MachineStatus.OUTPUT_FULL]: CraftingStatus.FULL_OUTPUT,
    [MachineStatus.NO_FUEL]: CraftingStatus.NO_FUEL,
};

export function craftingStatusOf(status: MachineStatus): CraftingStatus {
    return CRAFTING_STATUS_OF[status];
}

/** The string a history records for a crafting status */
export function machineStatusOf(code: CraftingStatus): MachineStatus {
    return MACHINE_STATUS_OF_CODE[code];
}

/**
 * A drill's status, named after `defines.entity_status`. The game also shows `waiting_for_space_in_destination` for a
 * blocked drill; the simulator does not derive it, and the refactor adds no status.
 */
export const DrillStatusCode = {
    WORKING: 0,
    DISABLED_BY_CONTROL_BEHAVIOR: 1,
} as const;
export type DrillStatusCode = typeof DrillStatusCode[keyof typeof DrillStatusCode];

/** The name of each drill status in `defines.entity_status`, by its code */
export const DRILL_STATUS_DEFINES: readonly FactorioDrillState[] = [
    FactorioDrillState.WORKING,
    FactorioDrillState.DISABLED_BY_CONTROL_BEHAVIOR,
];

const DRILL_STATUS_OF_CODE: readonly DrillStatus[] = [DrillStatus.WORKING, DrillStatus.DISABLED];

const DRILL_STATUS_CODE_OF: Readonly<Record<DrillStatus, DrillStatusCode>> = {
    [DrillStatus.WORKING]: DrillStatusCode.WORKING,
    [DrillStatus.DISABLED]: DrillStatusCode.DISABLED_BY_CONTROL_BEHAVIOR,
};

export function drillStatusCodeOf(status: DrillStatus): DrillStatusCode {
    return DRILL_STATUS_CODE_OF[status];
}

/** The string a history records for a drill status */
export function drillStatusOf(code: DrillStatusCode): DrillStatus {
    return DRILL_STATUS_OF_CODE[code];
}

/**
 * An inserter's phase. Not a game status: the game's status of an inserter is derived from the phase, the hand and
 * the sink (`factorioInserterState`).
 */
export const InserterPhase = {
    IDLE: 0,
    PICKUP: 1,
    SWING: 2,
    DROP: 3,
    TARGET_FULL: 4,
    WAITING_FOR_SINK: 5,
    DISABLED: 6,
} as const;
export type InserterPhase = typeof InserterPhase[keyof typeof InserterPhase];

const INSERTER_STATUS_OF_PHASE: readonly InserterStatus[] = [
    InserterStatus.IDLE,
    InserterStatus.PICKUP,
    InserterStatus.SWING,
    InserterStatus.DROP_OFF,
    InserterStatus.TARGET_FULL,
    InserterStatus.WAITING_FOR_SINK,
    InserterStatus.DISABLED,
];

const INSERTER_PHASE_OF: Readonly<Record<InserterStatus, InserterPhase>> = {
    [InserterStatus.IDLE]: InserterPhase.IDLE,
    [InserterStatus.PICKUP]: InserterPhase.PICKUP,
    [InserterStatus.SWING]: InserterPhase.SWING,
    [InserterStatus.DROP_OFF]: InserterPhase.DROP,
    [InserterStatus.TARGET_FULL]: InserterPhase.TARGET_FULL,
    [InserterStatus.WAITING_FOR_SINK]: InserterPhase.WAITING_FOR_SINK,
    [InserterStatus.DISABLED]: InserterPhase.DISABLED,
};

export function inserterPhaseOf(status: InserterStatus): InserterPhase {
    return INSERTER_PHASE_OF[status];
}

/** The string a history records for an inserter phase */
export function inserterStatusOf(phase: InserterPhase): InserterStatus {
    return INSERTER_STATUS_OF_PHASE[phase];
}
