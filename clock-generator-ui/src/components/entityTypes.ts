/**
 * Shared entity type options for belt and drill selectors.
 */

export const BELT_TYPES = [
    { value: 'transport-belt', label: 'Transport belt' },
    { value: 'fast-transport-belt', label: 'Fast transport belt' },
    { value: 'express-transport-belt', label: 'Express transport belt' },
    { value: 'turbo-transport-belt', label: 'Turbo transport belt' },
];

export const DRILL_TYPES = [
    { value: 'electric-mining-drill', label: 'Electric mining drill' },
    { value: 'burner-mining-drill', label: 'Burner mining drill' },
    { value: 'big-mining-drill', label: 'Big mining drill' },
];

/**
 * What the player sees for a belt or drill type: the game's name for it (sentence case, "Turbo transport belt"), else
 * the option's own label while no names are known.
 */
export function entityTypeLabel(value: string, itemLabel: (id: string) => string): string {
    const name = itemLabel(value);
    if (name !== value) return name;
    return [...BELT_TYPES, ...DRILL_TYPES].find((option) => option.value === value)?.label ?? value;
}

/** The saved machine types and the names the player sees for them. */
export const MACHINE_TYPE_LABELS: Record<'machine' | 'furnace' | 'biochamber', string> = {
    machine: 'Assembling machine',
    furnace: 'Furnace',
    biochamber: 'Biochamber',
};
