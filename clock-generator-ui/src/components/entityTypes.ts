/**
 * Shared entity type options for belt and drill selectors.
 */

export const BELT_TYPES = [
    { value: 'transport-belt', label: 'Yellow' },
    { value: 'fast-transport-belt', label: 'Red' },
    { value: 'express-transport-belt', label: 'Blue' },
    { value: 'turbo-transport-belt', label: 'Green' },
];

export const DRILL_TYPES = [
    { value: 'electric-mining-drill', label: 'Electric mining drill' },
    { value: 'burner-mining-drill', label: 'Burner mining drill' },
    { value: 'big-mining-drill', label: 'Big mining drill' },
];

/**
 * Belt types use their short colour names; drills use the game's name when available.
 */
export function entityTypeLabel(value: string, itemLabel: (id: string) => string): string {
    const belt = BELT_TYPES.find(option => option.value === value);
    if (belt) return belt.label;
    const name = itemLabel(value);
    if (name !== value) return name;
    return [...BELT_TYPES, ...DRILL_TYPES].find((option) => option.value === value)?.label ?? value;
}
