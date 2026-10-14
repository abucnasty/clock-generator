/** What a screen reader is told as the workflow moves on; words from the glossary in the README */
export const ANNOUNCEMENTS = {
    checking: 'Checking the build.',
    valid: 'Your build can be clocked.',
    invalid: 'Your build cannot be clocked.',
    outOfDate: 'Your build changed since it was checked.',
    generating: 'Generating clocks.',
    finished: (selectedLabel: string) => `Finished generating. Selected clock: ${selectedLabel}.`,
    finishedNoLabel: 'Finished generating.',
    copied: 'Blueprint copied.',
} as const;

/** The parts of the workflow bar's state that are announced when they change */
export interface WorkflowSnapshot {
    validationStatus: 'none' | 'running' | 'valid' | 'invalid' | 'out-of-date';
    isLoading: boolean;
    /** The run stopped on an error; clocks that arrived before it may still be on screen */
    failed: boolean;
    hasBlueprint: boolean;
    selectedLabel: string | null;
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
