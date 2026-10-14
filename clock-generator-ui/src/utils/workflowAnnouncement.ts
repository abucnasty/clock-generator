/** What a screen reader is told as the workflow moves on; one place for the glossary pass (1.12) */
export const ANNOUNCEMENTS = {
    checking: 'Checking the configuration.',
    valid: 'The configuration is valid.',
    invalid: 'The configuration is not valid.',
    outOfDate: 'The configuration changed since it was checked.',
    generating: 'Generating clocks.',
    finished: (selectedLabel: string) => `Finished generating. Selected clock: ${selectedLabel}.`,
    finishedNoLabel: 'Finished generating.',
    copied: 'Blueprint copied.',
    showing: (selectedLabel: string) => `Showing ${selectedLabel}.`,
} as const;

/** The parts of the workflow bar's state that are announced when they change */
export interface WorkflowSnapshot {
    validationStatus: 'none' | 'running' | 'valid' | 'invalid' | 'out-of-date';
    isLoading: boolean;
    /** The run stopped on an error; clocks that arrived before it may still be on screen */
    failed: boolean;
    hasBlueprint: boolean;
    /** The selected clock's name, by what it is for ("Fewest wake-ups") */
    selectedLabel: string | null;
    /** The selected clock's id, which tells apart two clocks of the same name */
    selectedId: string | null;
}

/**
 * The one message a change of the workflow's state is announced with, or null when it is not news. Generation is looked
 * at before validation, and at most one message comes from a change. Progress is not announced: the progress bar has a
 * name and a value, and one message per step would interrupt the player dozens of times.
 */
export function workflowAnnouncement(prev: WorkflowSnapshot, next: WorkflowSnapshot): string | null {
    if (!prev.isLoading && next.isLoading) {
        return ANNOUNCEMENTS.generating;
    }
    if (prev.isLoading && !next.isLoading) {
        // a run that failed says so in its error alert, even when some clocks came in first; without a blueprint the run
        // was cleared, which is not news
        if (next.failed || !next.hasBlueprint) {
            return null;
        }
        return next.selectedLabel ? ANNOUNCEMENTS.finished(next.selectedLabel) : ANNOUNCEMENTS.finishedNoLabel;
    }
    // another clock chosen in the table changes the card above it, out of sight of the row
    const otherClock = prev.selectedId !== next.selectedId || prev.selectedLabel !== next.selectedLabel;
    if (!next.isLoading && prev.hasBlueprint && next.hasBlueprint && otherClock && next.selectedLabel) {
        return ANNOUNCEMENTS.showing(next.selectedLabel);
    }
    if (prev.validationStatus === next.validationStatus) {
        return null;
    }
    switch (next.validationStatus) {
        case 'running':
            return ANNOUNCEMENTS.checking;
        case 'valid':
            return ANNOUNCEMENTS.valid;
        case 'invalid':
            return ANNOUNCEMENTS.invalid;
        case 'out-of-date':
            return ANNOUNCEMENTS.outOfDate;
        case 'none':
            return null;
    }
}
