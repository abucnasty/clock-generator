import { describe, expect, it } from 'vitest';
import type { RunStop } from './resultsCache';
import { ANNOUNCEMENTS, workflowAnnouncement, type WorkflowSnapshot } from './workflowAnnouncement';

const idle: WorkflowSnapshot = { checkStatus: 'none', checkedForGenerate: false, isLoading: false, failed: false, hasBlueprint: false, selectedLabel: null, selectedId: null, selectionQuiet: false, stop: null, restoredId: 0, pickGone: null };
const at = (changes: Partial<WorkflowSnapshot>, from: WorkflowSnapshot = idle): WorkflowSnapshot => ({ ...from, ...changes });

describe('workflowAnnouncement: a check from Check only (or the swing plan)', () => {
    it('says the check started', () => {
        expect(workflowAnnouncement(idle, at({ checkStatus: 'running' }))).toBe('Checking the build.');
    });

    it('says how the check ended', () => {
        const running = at({ checkStatus: 'running' });
        expect(workflowAnnouncement(running, at({ checkStatus: 'valid' }))).toBe('Check passed.');
        expect(workflowAnnouncement(running, at({ checkStatus: 'invalid' }))).toBe('Check failed. The reason is at the top of Configure.');
    });

    it('says nothing when an edit makes the check out of date, or puts it back', () => {
        expect(workflowAnnouncement(at({ checkStatus: 'valid' }), at({ checkStatus: 'out-of-date' }))).toBeNull();
        expect(workflowAnnouncement(at({ checkStatus: 'out-of-date' }), at({ checkStatus: 'valid' }))).toBeNull();
        expect(workflowAnnouncement(at({ checkStatus: 'out-of-date' }), at({ checkStatus: 'invalid' }))).toBeNull();
    });

    it('says nothing when a check ends out of date (the build changed while it ran)', () => {
        expect(workflowAnnouncement(at({ checkStatus: 'running' }), at({ checkStatus: 'out-of-date' }))).toBeNull();
    });

    it.each<WorkflowSnapshot['checkStatus']>(['running', 'valid', 'invalid', 'out-of-date'])(
        'says nothing when it goes from %s back to none',
        (status) => {
            expect(workflowAnnouncement(at({ checkStatus: status }), idle)).toBeNull();
        }
    );
});

describe('workflowAnnouncement: a check from Generate', () => {
    const forGenerate = at({ checkedForGenerate: true });

    it('says nothing while it runs, nor when it passes: "Generating clocks." follows', () => {
        const running = at({ checkStatus: 'running' }, forGenerate);
        expect(workflowAnnouncement(forGenerate, running)).toBeNull();
        const passed = at({ checkStatus: 'valid' }, forGenerate);
        expect(workflowAnnouncement(running, passed)).toBeNull();
        expect(workflowAnnouncement(passed, at({ isLoading: true }, passed))).toBe('Generating clocks.');
    });

    it('says nothing when it fails: Generate moves the focus to the reason, which reads it once', () => {
        const running = at({ checkStatus: 'running' }, forGenerate);
        expect(workflowAnnouncement(running, at({ checkStatus: 'invalid' }, forGenerate))).toBeNull();
    });
});

describe('workflowAnnouncement: generation', () => {
    const valid = at({ checkStatus: 'valid' });
    const generating = at({ isLoading: true }, valid);

    it('says generation started', () => {
        expect(workflowAnnouncement(valid, generating)).toBe('Generating clocks.');
    });

    it('names the selected clock when it ends with a blueprint', () => {
        const done = at({ isLoading: false, hasBlueprint: true, selectedLabel: 'Clock A (12 swings)' }, generating);
        expect(workflowAnnouncement(generating, done)).toBe('Finished generating. Selected clock: Clock A (12 swings).');
    });

    it('says only that it finished when the clock has no name', () => {
        expect(workflowAnnouncement(generating, at({ isLoading: false, hasBlueprint: true }, generating)))
            .toBe('Finished generating.');
    });

    it('says nothing when it ends without a blueprint (an error, or a cleared run)', () => {
        expect(workflowAnnouncement(generating, at({ isLoading: false }, generating))).toBeNull();
        expect(workflowAnnouncement(generating, at({ isLoading: false, selectedLabel: 'Clock A' }, generating))).toBeNull();
    });

    it('says nothing when the run fails after some clocks arrived (its error alert says it)', () => {
        const withClock = at({ hasBlueprint: true, selectedLabel: 'Clock A' }, generating);
        expect(workflowAnnouncement(withClock, at({ isLoading: false, failed: true }, withClock))).toBeNull();
    });

    it('is not repeated while the run goes on and its clocks arrive', () => {
        const withClock = at({ hasBlueprint: true, selectedLabel: 'Clock A' }, generating);
        expect(workflowAnnouncement(generating, withClock)).toBeNull();
        expect(workflowAnnouncement(withClock, at({ selectedLabel: 'Clock B' }, withClock))).toBeNull();
    });
});

describe('workflowAnnouncement: choosing a clock', () => {
    const showing = at({ checkStatus: 'valid', hasBlueprint: true, selectedLabel: 'Fewest wake-ups', selectedId: 'a' });

    it('names the clock chosen while nothing runs', () => {
        expect(workflowAnnouncement(showing, at({ selectedLabel: 'Fewest wake windows', selectedId: 'b' }, showing)))
            .toBe('Showing the clock: Fewest wake windows.');
    });

    it('names a clock of the same name too, as the card changed', () => {
        expect(workflowAnnouncement(showing, at({ selectedId: 'c' }, showing))).toBe('Showing the clock: Fewest wake-ups.');
    });

    it('says nothing when Back to recommended in the card moved the focus to its name, which reads it', () => {
        expect(workflowAnnouncement(showing, at({ selectedId: 'r', selectedLabel: 'Fewest wake windows', selectionQuiet: true }, showing))).toBeNull();
        // and the next row chosen in the table is said again
        const quiet = at({ selectedId: 'r', selectionQuiet: true }, showing);
        expect(workflowAnnouncement(quiet, at({ selectedId: 'd', selectionQuiet: false }, quiet))).toBe('Showing the clock: Fewest wake-ups.');
    });

    it('says nothing while a run goes on', () => {
        const running = at({ isLoading: true }, showing);
        expect(workflowAnnouncement(running, at({ selectedLabel: 'X', selectedId: 'x' }, running))).toBeNull();
    });

    it('says nothing when the clocks first appear or are cleared', () => {
        expect(workflowAnnouncement(idle, at({ hasBlueprint: true, selectedLabel: 'X', selectedId: 'x' }))).toBeNull();
        expect(workflowAnnouncement(showing, idle)).toBeNull();
    });

    it('says only that the run finished when it ends on another clock', () => {
        const running = at({ isLoading: true }, showing);
        expect(workflowAnnouncement(running, at({ isLoading: false, selectedLabel: 'Y', selectedId: 'y' }, running)))
            .toBe('Finished generating. Selected clock: Y.');
    });
});

describe('workflowAnnouncement: order and repeats', () => {
    it('looks at generation before the check when both change', () => {
        const before = at({ checkStatus: 'running' });
        expect(workflowAnnouncement(before, at({ isLoading: true, checkStatus: 'valid' }, before)))
            .toBe('Generating clocks.');
        const running = at({ isLoading: true, checkStatus: 'running' });
        expect(workflowAnnouncement(running, at({ isLoading: false, hasBlueprint: true, selectedLabel: 'X', checkStatus: 'valid' }, running)))
            .toBe('Finished generating. Selected clock: X.');
    });

    it('says nothing for an unchanged snapshot', () => {
        for (const snapshot of [idle, at({ checkStatus: 'valid' }), at({ isLoading: true }), at({ hasBlueprint: true, selectedLabel: 'X' })]) {
            expect(workflowAnnouncement(snapshot, { ...snapshot })).toBeNull();
        }
    });

    it('keeps every message a non-empty sentence, in the glossary\'s words', () => {
        const texts = [...Object.values(ANNOUNCEMENTS).filter((it) => typeof it === 'string'), ANNOUNCEMENTS.finished('X'), ANNOUNCEMENTS.showing('X'), ANNOUNCEMENTS.clocksBack('X'), ANNOUNCEMENTS.pickGone('X'), ANNOUNCEMENTS.copiedCurrentBest('X')];
        for (const text of texts) {
            expect(text).toMatch(/^[A-Z].*\.$/);
            expect(text).not.toMatch(/configuration|valid/i);
        }
    });
});

describe('workflowAnnouncement: Cancel, kept clocks back and a pick not made', () => {
    const running = at({ isLoading: true, checkStatus: 'valid', hasBlueprint: true, selectedLabel: 'A', selectedId: 'a' });

    it.each<[RunStop['kept'], string]>([
        ['previous', 'Stopped. Your earlier clocks are back.'],
        ['partial', 'Stopped. The clocks made so far are kept.'],
        ['none', 'Stopped. No clocks were made.'],
        ['check', 'Stopped the check.'],
    ])('says what a Cancel that kept %s left, and nothing else of the same change', (kept, text) => {
        // the run ends and another clock is shown in the same change: only the Stopped message
        const stopped = at({ isLoading: false, stop: { id: 1, kept }, selectedLabel: 'B', selectedId: 'b' }, running);
        expect(workflowAnnouncement(running, stopped)).toBe(text);
        expect(workflowAnnouncement(running, stopped)).not.toMatch(/Finished generating/);
    });

    it('says the same Cancel once', () => {
        const stopped = at({ stop: { id: 1, kept: 'partial' } });
        expect(workflowAnnouncement(stopped, at({ checkStatus: 'valid' }, stopped))).toBeNull();
    });

    it('says the clocks for the build are back, with the selected one', () => {
        const back = at({ restoredId: 1, hasBlueprint: true, selectedLabel: 'Fewest wake-ups', selectedId: 'x' });
        expect(workflowAnnouncement(idle, back)).toBe('Your clocks for this build are back. Selected clock: Fewest wake-ups.');
    });

    it('says the pick was not made in place of "Finished generating."', () => {
        const done = at({ isLoading: false, pickGone: 'Shortest period' }, running);
        expect(workflowAnnouncement(running, done)).toBe(
            "Shortest period, the clock you picked, wasn't made this time, so the recommended clock is selected.");
    });
});
