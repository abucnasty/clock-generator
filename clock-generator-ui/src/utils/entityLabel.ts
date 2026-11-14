import { chestName, machineNameOf, theName, type ChestType, type MachineToName } from 'clock-generator/light';

export type LabelKind = 'machine' | 'inserter' | 'belt' | 'chest' | 'drill';

const KIND_NAMES: Record<LabelKind, string> = {
    machine: 'Machine',
    inserter: 'Inserter',
    belt: 'Belt',
    chest: 'Chest',
    drill: 'Drill',
};

/** The name of an entity in every view, "Inserter 3", from its kind and its stored id, as the engine's labels have it */
export function entityLabel(kind: LabelKind, id: number): string {
    return `${KIND_NAMES[kind]} ${id}`;
}

/** A chest by what it is and its id, as the engine names it: "Car 1", "Cargo wagon 2", "Rocket silo 3", "Chest 4" */
export function chestLabel(chest: { id: number; type?: ChestType }): string {
    return chestName(chest.type, chest.id);
}

/** `entityLabel`, with a chest named by its type when the build's chests have one of that id: "Car 1" */
export function entityLabelIn(chests: readonly { id: number; type?: ChestType }[] | undefined, kind: LabelKind, id: number): string {
    const chest = kind === 'chest' ? chests?.find(row => row.id === id) : undefined;
    return chest ? chestLabel(chest) : entityLabel(kind, id);
}

/**
 * A game name (an item's, a recipe's, a machine's) as the middle of a sentence writes it, its first letter lower case, as
 * the engine writes it: "Iron plate" is "iron plate", "Power armor MK2" is "power armor MK2"
 */
export function nameInSentence(name: string): string {
    return name.charAt(0).toLowerCase() + name.slice(1);
}

/**
 * A machine as a sentence about a result names it: by its kind and its recipe in the game's names as a sentence writes
 * them, "the biochamber (machine 1) that makes rocket fuel from jelly" (the engine's machineNameOf: the number only where
 * the copy has two of a kind and recipe); "Machine 1" where the machines of the build are not known (a view kept before
 * they were carried)
 */
export function machineInSentence(id: number | string, machines: readonly MachineToName[] | undefined,
    labels: { itemLabel: (id: string) => string; recipeLabel: (id: string) => string }): string {
    const words = { kind: (kind: string) => nameInSentence(labels.itemLabel(kind)), recipe: (recipe: string) => nameInSentence(labels.recipeLabel(recipe)) };
    const name = machines === undefined ? undefined : machineNameOf(id, machines, words);
    if (name !== undefined) return `the ${name}`;
    const number = typeof id === 'number' ? id : Number(/^machine:(\d+)$/.exec(id)?.[1]);
    return Number.isFinite(number) ? entityLabel('machine', number) : String(id);
}

/** A sentence's first letter upper case: "The biochamber ..." */
export function sentenceStart(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Where a row's Entity details button goes: `EntitySettings` puts it there, next to the row's other actions */
export function settingsSlotId(kind: LabelKind, id: number): string {
    return `settings-actions-${kind}-${id}`;
}

/**
 * A belt, inserter, chest or drill as a sentence about a result names it: by its items, "the inserter that takes coal", from
 * the names the engine carried (entityNames, by entity id); its label, "Inserter 3", where they are not known (a view kept
 * before they were carried)
 */
export function entityInSentence(kind: Exclude<LabelKind, 'machine'>, id: number, entityNames: Readonly<Record<string, string>> | undefined): string {
    const name = entityNames?.[`${kind}:${id}`];
    return name === undefined ? entityLabel(kind, id) : theName(name);
}
