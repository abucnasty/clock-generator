import { EntityType } from "../entity-type";

/**
 * The simulation rule of a machine. MACHINE (the crafting rule): the machine takes no more ingredients once its output
 * holds the overload multiplier times a craft's amount. FURNACE: it takes ingredients until its output holds a full
 * stack. BIOCHAMBER: the crafting rule, and it burns nutrients while crafting. Internal to the engine: a machine's rule
 * is derived from its prototype's game data (machine-rule.ts), and no config field names or sets it.
 */
export const MachineType = {
    MACHINE: EntityType.MACHINE,
    FURNACE: EntityType.FURNACE,
    /** Burns fuel (nutrients) while crafting. Otherwise behaves like a machine. */
    BIOCHAMBER: "biochamber",
} as const

export type MachineType = typeof MachineType[keyof typeof MachineType];
