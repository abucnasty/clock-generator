import type { Logger } from "../common/logger";
import { FactorioDataService } from "../data/factorio-data-service";
import { machineCanMake, machineRuleOfPrototype } from "../entities/machine/machine-rule";
import { MachineType } from "../entities/machine/machine-type";
import type { Config, MachineConfiguration } from "./schema";

/**
 * The simulation rule of a machine of the config, internal to the engine: its prototype's (machine-rule.ts), else the
 * crafting rule, for a machine without a prototype or with one the game data does not hold
 */
export function machineRuleOf(machine: Pick<MachineConfiguration, "prototype">): MachineType {
    const prototype = machine.prototype === undefined ? null : FactorioDataService.findCraftingMachine(machine.prototype);
    return prototype === null ? MachineType.MACHINE : machineRuleOfPrototype(prototype);
}

/**
 * What a machine's prototype says against the rest of its config: a prototype that is no crafting machine of the game
 * data (it is simulated as an assembling machine), or a recipe the prototype cannot make (the clock is made as
 * configured). Warnings only: such a config loads, and its clock is what it was before the data named them.
 */
export interface MachinePrototypeIssue {
    machine_id: number;
    kind: "unknown-prototype" | "recipe-not-made";
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
                    + "simulated as an assembling machine." });
            continue;
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
