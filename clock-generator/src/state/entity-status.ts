// The statuses stand alone, without the states, so the browser can take them without the simulation (see light.ts)

export const InserterStatus = {
    IDLE: "IDLE",
    PICKUP: "PICKUP",
    DROP_OFF: "DROP",
    SWING: "SWING",
    DISABLED: "DISABLED",
    /**
     * Inserter is waiting because its sink (chest) is full and it still has items in hand.
     * The inserter will retry dropping until space becomes available.
     */
    TARGET_FULL: "TARGET_FULL",
    /**
     * A hand filling from a belt that the machine cannot take any more of for now (output at its block, or the
     * ingredient at its insertion limit): the inserter keeps what it holds and waits at the belt.
     */
    WAITING_FOR_SINK: "WAITING_FOR_SINK",
} as const;

export type InserterStatus = typeof InserterStatus[keyof typeof InserterStatus];

export const MachineStatus = {
    INGREDIENT_SHORTAGE: 'INGREDIENT_SHORTAGE',
    WORKING: 'WORKING',
    OUTPUT_FULL: 'OUTPUT_FULL',
    /** A burner machine with nothing to burn, whatever its ingredients and output hold */
    NO_FUEL: 'NO_FUEL',
} as const;

export type MachineStatus = typeof MachineStatus[keyof typeof MachineStatus];

export const DrillStatus = {
    WORKING: 'WORKING',
    DISABLED: 'DISABLED',
} as const;

export type DrillStatus = typeof DrillStatus[keyof typeof DrillStatus];
