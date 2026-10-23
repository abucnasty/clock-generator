import { chestName, type ChestType } from 'clock-generator/light';

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

/** The accessible name of an entity's delete button, "Delete Inserter 3" */
export function deleteButtonLabel(kind: LabelKind, id: number): string {
    return `Delete ${entityLabel(kind, id)}`;
}
