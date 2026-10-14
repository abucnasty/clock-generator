/**
 * Shared entity type options for belt and drill selectors.
 */

export const BELT_TYPES = [
    { value: 'transport-belt', label: 'Transport Belt' },
    { value: 'fast-transport-belt', label: 'Fast Transport Belt' },
    { value: 'express-transport-belt', label: 'Express Transport Belt' },
    { value: 'turbo-transport-belt', label: 'Turbo Transport Belt' },
];

export const DRILL_TYPES = [
    { value: 'electric-mining-drill', label: 'Electric Mining Drill' },
    { value: 'burner-mining-drill', label: 'Burner Mining Drill' },
    { value: 'big-mining-drill', label: 'Big Mining Drill' },
];

/** The saved machine types and the names the player sees for them. */
export const MACHINE_TYPE_LABELS: Record<'machine' | 'furnace' | 'biochamber', string> = {
    machine: 'Assembling machine',
    furnace: 'Furnace',
    biochamber: 'Biochamber',
};
