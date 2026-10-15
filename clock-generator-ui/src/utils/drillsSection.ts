interface DrillsSectionState {
    drillCount: number;
    miningProductivityLevel: number;
    /** The productivity level field has the keyboard */
    levelFocused: boolean;
}

/**
 * Whether the Mining drills section shows its list (the productivity level and the drills) or folds to one "Add mining
 * drill" row. It folds with no drills and level 0, but not while the level field is being typed in: clearing the field
 * on the way to a new number must not take the field away.
 */
export function drillsListed({ drillCount, miningProductivityLevel, levelFocused }: DrillsSectionState): boolean {
    return drillCount > 0 || miningProductivityLevel > 0 || levelFocused;
}
