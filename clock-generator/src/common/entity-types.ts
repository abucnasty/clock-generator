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
    INFINITY_CHEST: "infinity-chest",
    /** A car, a tank or a cargo wagon: slots of the game data's size, filtered or free, holding mixed items */
    CAR: "car",
    TANK: "tank",
    CARGO_WAGON: "cargo-wagon",
    /** A rocket silo as a chest: its rocket inventory by weight, and its recipe's ingredients in its input slots */
    ROCKET_SILO: "rocket-silo",
} as const;

export type ChestType = typeof ChestType[keyof typeof ChestType];

/** The chest types whose slots come from a container prototype of the game data, named by the type */
export const SlotContainerType = {
    CAR: ChestType.CAR,
    TANK: ChestType.TANK,
    CARGO_WAGON: ChestType.CARGO_WAGON,
} as const;

export type SlotContainerType = typeof SlotContainerType[keyof typeof SlotContainerType];