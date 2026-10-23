import { machineCanMake, machineRuleOfPrototype } from 'clock-generator/light';
import type { CraftingMachineData, CraftingMachineInfo } from '../worker/types';
import type { MachineFormData } from './configForm/formData';

/** The simulation rules a machine's `type` names */
export type MachineRule = NonNullable<MachineFormData['type']>;

/** Before the lookups arrive: no machine to pick, so every machine keeps an editable rule */
export const NO_CRAFTING_MACHINES: CraftingMachineData = { machines: [], recipeCategories: {} };

/** The crafting machine of that prototype in the data; undefined for none or one the data does not hold (a mod's) */
export function craftingMachineOf(data: CraftingMachineData, prototype: string | undefined): CraftingMachineInfo | undefined {
    return prototype === undefined ? undefined : data.machines.find(machine => machine.name === prototype);
}

/** The rule of a crafting machine, from its game data (the engine's rule: no name decides it) */
export function ruleOfMachine(machine: CraftingMachineInfo): MachineRule {
    return machineRuleOfPrototype(machine);
}

/** The rule a machine row is simulated under: its type, else its machine's, else the crafting rule (the engine's order) */
export function effectiveRule(row: Pick<MachineFormData, 'type' | 'prototype'>, data: CraftingMachineData): MachineRule {
    if (row.type !== undefined) return row.type;
    const machine = craftingMachineOf(data, row.prototype);
    return machine ? ruleOfMachine(machine) : 'machine';
}

/** The ids among `recipes` that the machine can make, in their order */
export function recipesOfMachine(machine: CraftingMachineInfo, recipes: readonly string[], data: CraftingMachineData): string[] {
    return recipes.filter(recipe => machineCanMake(machine, data.recipeCategories[recipe] ?? []));
}

/** The names of the rules where they can be edited: a rule, not a machine */
export const RULE_LABELS: Record<MachineRule, string> = {
    machine: 'Crafting rule',
    furnace: 'Furnace rule',
    biochamber: 'Biochamber rule',
};

/**
 * What a rule does to the simulation, for its tooltip; `blockedAt` is where this machine stops taking ingredients
 * ("146 Plastic bar"), when its facts are known
 */
export function ruleDescription(rule: MachineRule, blockedAt?: string): string {
    const at = blockedAt ? ` (${blockedAt})` : '';
    if (rule === 'furnace') {
        return `Takes ingredients until its output holds a full stack of the product${at}, as a furnace does in the game.`;
    }
    const crafting = `Stops taking ingredients once its output holds the overload multiplier times a craft's output${at}, as an assembling machine does in the game.`;
    return rule === 'biochamber' ? `${crafting} It also burns nutrients while it crafts.` : crafting;
}

/** Where a row's machine came from */
type PrototypeSource = NonNullable<MachineFormData['_prototype_source']>;

/** The words for where the machine came from; a machine of a build file, a share link or an older saved build is the config's */
export function prototypeSourceText(source: PrototypeSource | undefined): string {
    switch (source) {
        case 'sidecar': return 'from Sidecar';
        case 'sample': return 'from the sample';
        case 'hand': return 'chosen by hand';
        default: return 'from the config';
    }
}

/** The qualities a machine can have, in the game's order */
export const MACHINE_QUALITIES = ['normal', 'uncommon', 'rare', 'epic', 'legendary'] as const;
type MachineQuality = typeof MACHINE_QUALITIES[number];

/** "Legendary" */
export function qualityLabel(quality: MachineQuality): string {
    return quality.charAt(0).toUpperCase() + quality.slice(1);
}

/** What the Quality field's help says: a label, never a speed */
export const MACHINE_QUALITY_HELP = 'Quality is a label only: it draws the quality on the machine\'s icon, as the game does. '
    + 'The Crafting Speed and Productivity fields are what the clock is made from, and changing the quality changes neither '
    + 'of them, nor the clock. Set both to the machine\'s values in the game (Sidecar copies them).';

/** What a machine's icon stands for: "Cryogenic plant (Legendary), from Sidecar", or the rule of a row with no machine */
export function machineIconText(machine: Pick<MachineFormData, 'prototype' | 'quality' | 'type' | '_prototype_source'>,
    machineName: (id: string) => string, data: CraftingMachineData): string {
    if (machine.prototype === undefined) return `No machine set: simulated under the ${RULE_LABELS[effectiveRule(machine, data)].toLowerCase()}`;
    const quality = machine.quality ? ` (${qualityLabel(machine.quality)})` : '';
    return `${machineName(machine.prototype)}${quality}, ${prototypeSourceText(machine._prototype_source)}`;
}
