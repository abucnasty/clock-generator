import type { Logger } from "../common/logger";
import { FactorioDataService } from "../data/factorio-data-service";
import { machineCanMake, machineRuleOfPrototype } from "../entities/machine/machine-rule";
import { MachineType } from "../entities/machine/machine-type";
import type { Config, MachineConfiguration } from "./schema";

/** The simulation rule of a machine of the config: its `type` when set, else the rule of its prototype, else the crafting rule */
export function machineRuleOf(machine: Pick<MachineConfiguration, "type" | "prototype">): MachineType {
    if (machine.type !== undefined) {
        return machine.type;
    }
    const prototype = machine.prototype === undefined ? null : FactorioDataService.findCraftingMachine(machine.prototype);
    return prototype === null ? MachineType.MACHINE : machineRuleOfPrototype(prototype);
}

/** The names of the rules in the warnings */
const RULE_NAMES: Record<MachineType, string> = {
    [MachineType.MACHINE]: "the crafting rule (machine)",
    [MachineType.FURNACE]: "the furnace rule (furnace)",
    [MachineType.BIOCHAMBER]: "the biochamber rule (biochamber)",
};

/**
 * What a machine's prototype says against the rest of its config: a prototype that is no crafting machine of the game
 * data, a `type` other than the prototype's rule (the `type` is used), or a recipe the prototype cannot make (the clock
 * is made as configured). Warnings only: such a config loads, and its clock is what it was before the data named them.
 */
export interface MachinePrototypeIssue {
    machine_id: number;
    kind: "unknown-prototype" | "rule-disagrees" | "recipe-not-made";
    message: string;
}

/** The warnings of every machine of the config whose prototype is set */
export function machinePrototypeIssues(config: Pick<Config, "machines">): MachinePrototypeIssue[] {
    const issues: MachinePrototypeIssue[] = [];
    for (const machine of config.machines) {
        if (machine.prototype === undefined) {
            continue;
        }
        const prototype = FactorioDataService.findCraftingMachine(machine.prototype);
        if (prototype === null) {
            issues.push({ machine_id: machine.id, kind: "unknown-prototype",
                message: `Machine ${machine.id} names ${machine.prototype}, which is no crafting machine of the game data: it is `
                    + `simulated under ${RULE_NAMES[machineRuleOf(machine)]}, from its type.` });
            continue;
        }
        const derived = machineRuleOfPrototype(prototype);
        if (machine.type !== undefined && machine.type !== derived) {
            issues.push({ machine_id: machine.id, kind: "rule-disagrees",
                message: `Machine ${machine.id} (${machine.prototype}) crafts under ${RULE_NAMES[derived]}, but its type is `
                    + `${machine.type}: it is simulated under ${RULE_NAMES[machine.type]}. Remove the type to follow the machine.` });
        }
        const recipe = FactorioDataService.findRecipe(machine.recipe);
        if (recipe !== null && !machineCanMake(prototype, recipe.categories)) {
            issues.push({ machine_id: machine.id, kind: "recipe-not-made",
                message: `Machine ${machine.id} (${machine.prototype}) cannot make ${machine.recipe}: it makes recipes of `
                    + `${prototype.crafting_categories.join(", ")}, and the recipe is ${recipe.categories.join(", ")}. The clock is `
                    + "made as configured, but the game does not let this machine be set to the recipe." });
        }
    }
    return issues;
}

/** The warnings of the machines' prototypes as one note, the same in the log and in the live editor; null when there are none */
export function machinePrototypesNote(config: Pick<Config, "machines">): string | null {
    try {
        const issues = machinePrototypeIssues(config);
        return issues.length === 0 ? null : issues.map(issue => issue.message).join(" ");
    } catch {
        return null;
    }
}

/** Logs the warnings once for a generation whose machines' prototypes disagree with the rest of their config */
export function warnMachinePrototypes(config: Pick<Config, "machines">, logger: Logger): void {
    const note = machinePrototypesNote(config);
    if (note !== null) {
        logger.warn(note);
    }
}
