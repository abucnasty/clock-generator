import { z, type RefinementCtx } from "zod";
import { FactorioDataService } from "../data/factorio-data-service";
import { machineForRule } from "../entities/machine/machine-rule";
import { MachineType } from "../entities/machine/machine-type";

/** The former `type` of a machine: the simulation rule, which the engine now works out from the machine's prototype */
const LegacyMachineTypeSchema = z.enum(Object.values(MachineType));

export const MACHINE_TYPE_WITHOUT_DATA_ERROR = "a machine's former `type` is read with the game data, which is not loaded";

/**
 * Read a machine's former `type` once: a machine is its `prototype`, whose game data gives the rule it is simulated
 * under, and validated, saved and exported configs have no `type`. With a `prototype` the `type` is dropped. Without
 * one the machine gets the prototype `machineForRule` picks for that rule and its recipe, so it is simulated as before:
 * a furnace or biochamber always gets one; a crafting machine gets one when one can make its recipe, and else stays
 * without, which is simulated under the crafting rule as before. A `type` that is no rule is left for the schema to
 * refuse, and `issue` is told when the game data is not there to read it.
 */
export function migrateMachineType(value: unknown, issue?: (message: string) => void): unknown {
    if (typeof value !== "object" || value === null || Array.isArray(value) || !("type" in value)) {
        return value;
    }
    const { type, ...machine } = value as Record<string, unknown>;
    if (type === undefined || machine.prototype !== undefined) {
        return machine;
    }
    const rule = LegacyMachineTypeSchema.safeParse(type);
    if (!rule.success) {
        return value;
    }
    if (!FactorioDataService.isAvailable()) {
        issue?.(MACHINE_TYPE_WITHOUT_DATA_ERROR);
        return value;
    }
    const recipe = typeof machine.recipe === "string" ? FactorioDataService.findRecipe(machine.recipe) : null;
    const prototype = machineForRule(rule.data, recipe?.categories ?? [], FactorioDataService.getAllCraftingMachines());
    return prototype === undefined ? machine : { ...machine, prototype: prototype.name };
}

/** Every machine of a config, before it is checked: a saved build, a build file or a share link, as `migrateMachineType` */
export function migrateMachineTypes(config: unknown): unknown {
    if (typeof config !== "object" || config === null || Array.isArray(config) || !("machines" in config) || !Array.isArray(config.machines)) {
        return config;
    }
    return { ...config, machines: config.machines.map(machine => migrateMachineType(machine)) };
}

/**
 * The migration as a schema step: its problem is the machine's issue at `type`, and a `type` that is no rule is refused
 * there with the rules it could name (the not-supported-yet entities by their reason, errors.ts)
 */
export function migrateMachineTypeStep(value: unknown, context: RefinementCtx): unknown {
    let told = false;
    const migrated = migrateMachineType(value, message => {
        told = true;
        context.addIssue({ code: "custom", path: ["type"], message });
    });
    if (!told && typeof migrated === "object" && migrated !== null && "type" in migrated) {
        for (const problem of LegacyMachineTypeSchema.safeParse(migrated.type).error?.issues ?? []) {
            context.addIssue({ code: "custom", path: ["type"], message: problem.message });
        }
    }
    return migrated;
}
