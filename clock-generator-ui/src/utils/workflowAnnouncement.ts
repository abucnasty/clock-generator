import type { CheckStatus } from './checkThenGenerate';

/** What a screen reader is told as the workflow moves on; one place for the glossary pass (1.12) */
export const ANNOUNCEMENTS = {
    checking: 'Checking the build.',
    passed: 'Check passed.',
    failed: 'Check failed. The reason is at the top of Configure.',
    generating: 'Generating clocks.',
    finished: (selectedLabel: string) => `Finished generating. Selected clock: ${selectedLabel}.`,
    finishedNoLabel: 'Finished generating.',
    copied: 'Blueprint copied.',
    showing: (selectedLabel: string) => `Showing ${selectedLabel}.`,
} as const;

/** The parts of the workflow bar's state that are announced when they change */
export interface WorkflowSnapshot {
    checkStatus: CheckStatus;
    /**
     * The running or last check was started by Generate. Generate leads on by itself: to "Generating clocks.", or to the
     * reason it failed, which it moves the focus to (and the focus reads)
     */
    checkedForGenerate: boolean;
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
 * at before the check, and at most one message comes from a change. Progress is not announced: the progress bar has a
 * name and a value, and one message per step would interrupt the player dozens of times. An edit that makes a check out
 * of date is not announced either: every edit would say it, and Generate checks again by itself.
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
    if (prev.checkStatus === next.checkStatus || next.checkedForGenerate) {
        return null;
    }
    if (next.checkStatus === 'running') {
        return ANNOUNCEMENTS.checking;
    }
    // only the end of a check is news: putting an edit back also makes the last check current again
    if (prev.checkStatus !== 'running') {
        return null;
    }
    switch (next.checkStatus) {
        case 'valid':
            return ANNOUNCEMENTS.passed;
        case 'invalid':
            return ANNOUNCEMENTS.failed;
        default:
            return null;
    }
}
