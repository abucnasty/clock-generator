interface DrillsSectionState {
    drillCount: number;
    /** The keyboard is somewhere in the section (its Add button, its help) */
    focusInSection: boolean;
}

/**
 * Whether the Mining drills section shows its list of drills or folds to one "Add mining drill" row. It folds with no
 * drills, but only once the focus has left the section: Shift+Tab to the header's Add button must not take the focused
 * control away (WCAG 2.4.3), nor swallow the click that moved the focus there.
 */
export function drillsListed({ drillCount, focusInSection }: DrillsSectionState): boolean {
    return drillCount > 0 || focusInSection;
}

/** Whether a blur leaves the section: the focus goes to nothing, or to something outside it */
export function focusLeaves(section: Node, next: Node | null): boolean {
    return next === null || !section.contains(next);
}
