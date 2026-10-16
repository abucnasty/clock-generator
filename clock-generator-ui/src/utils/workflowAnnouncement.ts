import type { CheckStatus } from './checkThenGenerate';
import { pickGoneNote, type RunStop } from './resultsCache';

/** What a screen reader is told as the workflow moves on; one place for the glossary pass (1.12) */
export const ANNOUNCEMENTS = {
    checking: 'Checking the build.',
    passed: 'Check passed.',
    failed: 'Check failed. The reason is at the top of Configure.',
    generating: 'Generating clocks.',
    finished: (selectedLabel: string) => `Finished generating. Selected clock: ${selectedLabel}.`,
    finishedNoLabel: 'Finished generating.',
    copied: 'Blueprint copied.',
    showing: (selectedLabel: string) => `Showing the clock: ${selectedLabel}.`,
    stoppedPrevious: 'Stopped. Your earlier clocks are back.',
    stoppedPartial: 'Stopped. The clocks made so far are kept.',
    stoppedNone: 'Stopped. No clocks were made.',
    stoppedCheck: 'Stopped the check.',
    clocksBack: (selectedLabel: string) => `Your clocks for this build are back. Selected clock: ${selectedLabel}.`,
    /** After "Opened build: …" when the build's kept clocks come back with it */
    itsClocksBack: 'Its clocks are back.',
    pickGone: pickGoneNote,
    copiedCurrentBest: (selectedLabel: string) => `Copied the best clock so far: ${selectedLabel}. It stays selected.`,
    developerToolsOn: 'Developer tools on. They are at the end of Results.',
    developerToolsOff: 'Developer tools off.',
} as const;

/** What a Cancel says, by what it left on screen */
const STOPPED: Record<RunStop['kept'], string> = {
    previous: ANNOUNCEMENTS.stoppedPrevious,
    partial: ANNOUNCEMENTS.stoppedPartial,
    none: ANNOUNCEMENTS.stoppedNone,
    check: ANNOUNCEMENTS.stoppedCheck,
};

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
    /**
     * The selection last changed by a press that moves the focus to the card's name (Back to recommended in the card),
     * which reads the name out itself
     */
    selectionQuiet: boolean;
    /** The last Cancel; a new `id` is news */
    stop: RunStop | null;
    /** Bumped when results come back on an empty Results (an Undo of Import, Paste or Reset; a build switched back) */
    restoredId: number;
    /** The name of the picked clock the last run did not make; null when it made it, or there was no pick */
    pickGone: string | null;
}

/**
 * The one message a change of the workflow's state is announced with, or null when it is not news. Generation is looked
 * at before the check, and at most one message comes from a change. Progress is not announced: the progress bar has a
 * name and a value, and one message per step would interrupt the player dozens of times. An edit that makes a check out
 * of date is not announced either: every edit would say it, and Generate checks again by itself.
 */
export function workflowAnnouncement(prev: WorkflowSnapshot, next: WorkflowSnapshot): string | null {
    // a Cancel says what it left on screen, and nothing else of the same change (the run ending, another clock shown)
    if (next.stop !== null && next.stop.id !== prev.stop?.id) {
        return STOPPED[next.stop.kept];
    }
    if (next.restoredId !== prev.restoredId) {
        return next.selectedLabel ? ANNOUNCEMENTS.clocksBack(next.selectedLabel) : null;
    }
    if (!prev.isLoading && next.isLoading) {
        return ANNOUNCEMENTS.generating;
    }
    if (prev.isLoading && !next.isLoading) {
        // a run that failed says so in its error alert, even when some clocks came in first; without a blueprint the run
        // was cleared, which is not news
        if (next.failed || !next.hasBlueprint) {
            return null;
        }
        if (next.pickGone !== null) {
            return ANNOUNCEMENTS.pickGone(next.pickGone);
        }
        return next.selectedLabel ? ANNOUNCEMENTS.finished(next.selectedLabel) : ANNOUNCEMENTS.finishedNoLabel;
    }
    // another clock chosen in the table changes the card above it, out of sight of the row
    const otherClock = prev.selectedId !== next.selectedId || prev.selectedLabel !== next.selectedLabel;
    if (!next.isLoading && prev.hasBlueprint && next.hasBlueprint && otherClock && next.selectedLabel && !next.selectionQuiet) {
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
