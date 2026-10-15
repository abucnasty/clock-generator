/** The prototype name of the inserter the configs run when they name none */
export const InserterType = {
    STACK_INSERTER: "stack-inserter",
} as const;

/** The name of an inserter prototype of the game data (an unknown one is refused when a config is read) */
export type InserterType = string;
