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

/** The accessible name of an entity's delete button, "Delete Inserter 3" */
export function deleteButtonLabel(kind: LabelKind, id: number): string {
    return `Delete ${entityLabel(kind, id)}`;
}
