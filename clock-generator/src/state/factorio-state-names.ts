// The names stand alone, without the states, so the browser can take them without the simulation (see light.ts)

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
