import { machineCanMake, machineForRecipe, machineRuleOfPrototype, MachineType, placesResultsItself } from 'clock-generator/light';
import type { CraftingMachineData, CraftingMachineInfo } from '../worker/types';
import type { MachineFormData } from './configForm/formData';

/** Before the lookups arrive: no machine to pick yet */
export const NO_CRAFTING_MACHINES: CraftingMachineData = { machines: [], recipeCategories: {} };

/** The crafting machine of that prototype in the data; undefined for none or one the data does not hold (a mod's) */
export function craftingMachineOf(data: CraftingMachineData, prototype: string | undefined): CraftingMachineInfo | undefined {
    return prototype === undefined ? undefined : data.machines.find(machine => machine.name === prototype);
}

/** Whether the row's machine burns nutrients, as a biochamber does, so that its energy consumption counts (the engine's rule) */
export function burnsNutrients(row: Pick<MachineFormData, 'prototype'>, data: CraftingMachineData): boolean {
    const machine = craftingMachineOf(data, row.prototype);
    return machine !== undefined && machineRuleOfPrototype(machine) === MachineType.BIOCHAMBER;
}

/**
 * Whether the row's machine places its results itself, into the container in front of its output side (the recycler), as
 * its game data says by `vector_to_place_result`; no name decides it. Only such a machine has a result target.
 */
export function placesResults(row: Pick<MachineFormData, 'prototype'>, data: CraftingMachineData): boolean {
    const machine = craftingMachineOf(data, row.prototype);
    return machine !== undefined && placesResultsItself(machine);
}

/**
 * The patch that sets a row's machine, chosen by hand. Only a machine that places its results itself has a result target:
 * a row that changes to another loses it.
 */
export function machineChoicePatch(prototype: string, row: Pick<MachineFormData, 'result_target'>, data: CraftingMachineData): Partial<MachineFormData> {
    return {
        prototype, _prototype_source: 'hand',
        ...(row.result_target !== undefined && !placesResults({ prototype }, data) && { result_target: undefined }),
    };
}

/** The machine a row without one gets for its recipe: one that can make it, as the engine picks it; undefined when none can */
export function machineForRecipeOf(recipe: string, data: CraftingMachineData): string | undefined {
    return recipe === '' ? undefined : machineForRecipe(data.recipeCategories[recipe] ?? [], data.machines)?.name;
}

/** A recipe chosen for a row: a row without a machine gets one that can make the recipe, picked for it */
export function recipePatch(row: Pick<MachineFormData, 'prototype'>, recipe: string, data: CraftingMachineData): Partial<MachineFormData> {
    const picked = row.prototype === undefined ? machineForRecipeOf(recipe, data) : undefined;
    return { recipe, ...(picked !== undefined && { prototype: picked, _prototype_source: 'recipe' as const }) };
}

/** The ids among `recipes` that the machine can make, in their order */
export function recipesOfMachine(machine: CraftingMachineInfo, recipes: readonly string[], data: CraftingMachineData): string[] {
    return recipes.filter(recipe => machineCanMake(machine, data.recipeCategories[recipe] ?? []));
}

/** Where a row's machine came from */
type PrototypeSource = NonNullable<MachineFormData['_prototype_source']>;

/** The words for where the machine came from; a machine of a build file, a share link or an older saved build is the config's */
export function prototypeSourceText(source: PrototypeSource | undefined): string {
    switch (source) {
        case 'sidecar': return 'from Sidecar';
        case 'sample': return 'from the sample';
        case 'hand': return 'chosen by hand';
        case 'recipe': return 'picked for its recipe';
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

/** What a machine's icon stands for: "Cryogenic plant (Legendary), from Sidecar" */
export function machineIconText(machine: Pick<MachineFormData, 'prototype' | 'quality' | '_prototype_source'>,
    machineName: (id: string) => string): string {
    if (machine.prototype === undefined) return 'No machine set: simulated as an assembling machine';
    const quality = machine.quality ? ` (${qualityLabel(machine.quality)})` : '';
    return `${machineName(machine.prototype)}${quality}, ${prototypeSourceText(machine._prototype_source)}`;
}

/** Each quality's level in the game data: a machine's crafting speed rises 30% of its base with each */
const QUALITY_LEVELS: Record<MachineQuality, number> = { normal: 0, uncommon: 1, rare: 2, epic: 3, legendary: 5 };
const QUALITY_SPEED_STEP = 0.3;

/** A number of the form, without float noise: 2.375, not 2.3750000000000004 */
const shownNumber = (value: number) => Number(value.toFixed(3));

/** A machine's crafting speed at a quality, before modules and beacons: its base speed plus 30% of it per quality level */
export function machineSpeedAtQuality(machine: Pick<CraftingMachineInfo, 'crafting_speed'>, quality: MachineQuality | undefined): number {
    return shownNumber(machine.crafting_speed * (1 + QUALITY_SPEED_STEP * QUALITY_LEVELS[quality ?? 'normal']));
}

/** The picker's line under a machine: "Crafting speed 5× at Legendary (2× base)" */
export function machineSpeedText(machine: Pick<CraftingMachineInfo, 'crafting_speed'>, quality: MachineQuality | undefined): string {
    const speed = machineSpeedAtQuality(machine, quality);
    return speed === shownNumber(machine.crafting_speed)
        ? `Crafting speed ${speed}×`
        : `Crafting speed ${speed}× at ${qualityLabel(quality!)} (${shownNumber(machine.crafting_speed)}× base)`;
}

/**
 * The hint under the Crafting Speed field: what the machine does at its quality on its own, and that modules and beacons
 * change it. The field is not changed: the clock uses the speed as exported.
 */
export function craftingSpeedHint(row: Pick<MachineFormData, 'prototype' | 'quality'>, data: CraftingMachineData,
    machineName: (id: string) => string): string {
    const machine = craftingMachineOf(data, row.prototype);
    const end = 'The clock uses the speed in this field.';
    if (machine === undefined) return `Modules, beacons and the machine's quality change a machine's speed. ${end}`;
    const quality = row.quality !== undefined && row.quality !== 'normal' ? ` (${qualityLabel(row.quality)})` : '';
    return `${machineName(machine.name)}${quality}: ${machineSpeedAtQuality(machine, row.quality)}× before modules and beacons, which change it. ${end}`;
}

/** The machines of the data that can make a recipe, in the data's order */
function machinesThatMake(recipe: string, data: CraftingMachineData): CraftingMachineInfo[] {
    return data.machines.filter(machine => machineCanMake(machine, data.recipeCategories[recipe] ?? []));
}

/**
 * What a row says when its machine cannot make its recipe, in the game's words ("Assembling machine 1 can't craft
 * Lithium. Machines that can: Cryogenic plant."); undefined when it can, or when the machine or the recipe is unknown
 */
export function recipeNotMadeText(row: Pick<MachineFormData, 'prototype' | 'recipe'>, data: CraftingMachineData,
    machineName: (id: string) => string, recipeName: (id: string) => string): string | undefined {
    const machine = craftingMachineOf(data, row.prototype);
    const categories = data.recipeCategories[row.recipe];
    if (machine === undefined || categories === undefined || machineCanMake(machine, categories)) return undefined;
    const can = machinesThatMake(row.recipe, data).map(it => machineName(it.name));
    return `${machineName(machine.name)} can't craft ${recipeName(row.recipe)}. `
        + (can.length === 0 ? 'No machine of the game data can.' : `Machines that can: ${can.join(', ')}.`);
}
