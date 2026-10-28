import type { Logger } from "../common/logger";
import { FactorioDataService } from "../data/factorio-data-service";
import { BurnerEnergySource } from "../entities/machine/fuel/energy-source";
import { machineCanMake, machineRuleOfPrototype, placesResultsItself } from "../entities/machine/machine-rule";
import { MachineType } from "../entities/machine/machine-type";
import { modelledBurnerOf } from "../entities/traits/energy";
import type { Config, MachineConfiguration } from "./schema";

/**
 * The simulation rule of a machine of the config, internal to the engine: its prototype's (machine-rule.ts), else the
 * crafting rule, for a machine without a prototype or with one the game data does not hold. A label (copies, facts, an
 * import's warning): what the machine does follows from its traits, not from this.
 */
export function machineRuleOf(machine: Pick<MachineConfiguration, "prototype">): MachineType {
    const prototype = machine.prototype === undefined ? null : FactorioDataService.findCraftingMachine(machine.prototype);
    return prototype === null ? MachineType.MACHINE : machineRuleOfPrototype(prototype);
}

/**
 * The fuel a machine of the config burns, as its Energy trait gives it (entities/traits/energy.ts): the one the config
 * names, else its burner's first; undefined for a machine whose fuel is not modelled. A fuel its burner does not burn
 * is refused, with the fuels it does.
 */
export function machineFuelOf(machine: Pick<MachineConfiguration, "prototype" | "fuel">): string | undefined {
    const source = modelledBurnerOf(machine.prototype === undefined ? null : FactorioDataService.findCraftingMachine(machine.prototype));
    return source === undefined ? undefined : BurnerEnergySource.selectFuel(source, machine.fuel).item_name;
}

/** Whether a machine of the config places its results itself, by its prototype's game data (machine-rule.ts) */
export function machinePlacesResults(machine: Pick<MachineConfiguration, "prototype">): boolean {
    const prototype = machine.prototype === undefined ? null : FactorioDataService.findCraftingMachine(machine.prototype);
    return prototype !== null && placesResultsItself(prototype);
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
            // in the game's words: "Assembling machine 1 can't craft Lithium. Machines that can: Cryogenic plant."
            const can = FactorioDataService.getAllCraftingMachines().filter(it => machineCanMake(it, recipe.categories))
                .map(it => FactorioDataService.itemDisplayName(it.name));
            issues.push({ machine_id: machine.id, kind: "recipe-not-made",
                message: `Machine ${machine.id}: ${FactorioDataService.itemDisplayName(machine.prototype)} can't craft `
                    + `${FactorioDataService.recipeDisplayName(machine.recipe)}. `
                    + (can.length === 0 ? "No machine of the game data can. " : `Machines that can: ${can.join(", ")}. `)
                    + "The clock is made as configured, but the game does not let this machine be set to the recipe." });
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
