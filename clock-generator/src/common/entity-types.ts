/**
 * Shared entity type constants used across config and entity modules.
 * Extracted to common directory to avoid circular dependencies.
 */

export const MiningDrillType = {
    ELECTRIC_MINING_DRILL: "electric-mining-drill",
    BURNER_MINING_DRILL: "burner-mining-drill",
    BIG_MINING_DRILL: "big-mining-drill"
} as const;

export type MiningDrillType = typeof MiningDrillType[keyof typeof MiningDrillType];

export const BeltType = {
    TRANSPORT_BELT: "transport-belt",
    FAST_TRANSPORT_BELT: "fast-transport-belt",
    EXPRESS_TRANSPORT_BELT: "express-transport-belt",
    TURBO_TRANSPORT_BELT: "turbo-transport-belt"
} as const;

export type BeltType = typeof BeltType[keyof typeof BeltType];

/**
 * normal: an endless source and sink.
 * export: normal, plus a consumption rate per lane for consumers outside the config.
 */
export const BeltStrategy = {
    NORMAL: "normal",
    EXPORT: "export"
} as const;

export type BeltStrategy = typeof BeltStrategy[keyof typeof BeltStrategy];


export const ChestType = {
    BUFFER_CHEST: "buffer-chest",
    INFINITY_CHEST: "infinity-chest"
} as const;

export type ChestType = typeof ChestType[keyof typeof ChestType];