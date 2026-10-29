import { EntityType } from "../entity-type";

/**
 * The simulation rule of a machine. MACHINE (the crafting rule): the machine takes no more ingredients once its output
 * holds the overload multiplier times a craft's amount. FURNACE: it takes ingredients until its output holds a full
 * stack. BIOCHAMBER: the crafting rule, and it burns nutrients while crafting. Internal to the engine: a machine's rule
 * is derived from its prototype's game data (machine-rule.ts), and no config field names or sets it.
 *
 * A label and a migration key only (decision D13): no behaviour branches on it. A machine reads what the rule names from
 * its traits (entities/traits): the output block from its RecipeSelection (the prototype's class), the fuel from its
 * Energy trait. Readers: the facts' `type`, the copies key, debug output, the config migration of a former `type`
 * (migrate-machine-type.ts, machineForRule) and an import's warning (sidecar-version.ts).
 */
export const MachineType = {
    MACHINE: EntityType.MACHINE,
    FURNACE: EntityType.FURNACE,
    /** Burns fuel (nutrients) while crafting. Otherwise behaves like a machine. */
    BIOCHAMBER: "biochamber",
} as const

export type MachineType = typeof MachineType[keyof typeof MachineType];
