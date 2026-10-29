import { describe, expect, it } from 'vitest';
import type { RunStop } from './resultsCache';
import { ANNOUNCEMENTS, workflowAnnouncement, type WorkflowSnapshot } from './workflowAnnouncement';

const idle: WorkflowSnapshot = { checkStatus: 'none', checkedForGenerate: false, isLoading: false, failed: false, hasBlueprint: false, selectedLabel: null, selectedId: null, selectionQuiet: false, stop: null, restoredId: 0, pickGone: null };
const at = (changes: Partial<WorkflowSnapshot>, from: WorkflowSnapshot = idle): WorkflowSnapshot => ({ ...from, ...changes });

/** What a change from the first snapshot to the second says; null for nothing */
type Change = [string, WorkflowSnapshot, WorkflowSnapshot, string | null];
const says = (changes: Change[]) => it.each(changes)('%s', (_, prev, next, text) => {
    expect(workflowAnnouncement(prev, next)).toBe(text);
});

describe('workflowAnnouncement: a check from Check only (or the swing plan)', () => {
    const check = (checkStatus: WorkflowSnapshot['checkStatus']) => at({ checkStatus });
    says([
        ['says the check started', idle, check('running'), ANNOUNCEMENTS.checking],
        ['says the check passed', check('running'), check('valid'), ANNOUNCEMENTS.passed],
        ['says the check failed', check('running'), check('invalid'), ANNOUNCEMENTS.failed],
        ['says nothing when an edit makes the check out of date', check('valid'), check('out-of-date'), null],
        ['says nothing when an edit put back makes a passed check current again', check('out-of-date'), check('valid'), null],
        ['says nothing when an edit put back makes a failed check current again', check('out-of-date'), check('invalid'), null],
        ['says nothing when a check ends out of date (the build changed while it ran)', check('running'), check('out-of-date'), null],
        ...(['running', 'valid', 'invalid', 'out-of-date'] as const).map((status): Change => [`says nothing when it goes from ${status} back to none`, check(status), idle, null]),
    ]);
});

describe('workflowAnnouncement: a check from Generate', () => {
    const forGenerate = at({ checkedForGenerate: true });
    const running = at({ checkStatus: 'running' }, forGenerate);
    const passed = at({ checkStatus: 'valid' }, forGenerate);
    says([
        ['says nothing while it runs', forGenerate, running, null],
        ['says nothing when it passes: "Generating clocks." follows', running, passed, null],
        ['says "Generating clocks." once it has passed', passed, at({ isLoading: true }, passed), ANNOUNCEMENTS.generating],
        ['says nothing when it fails: Generate moves the focus to the reason, which reads it once', running, at({ checkStatus: 'invalid' }, forGenerate), null],
    ]);
});

describe('workflowAnnouncement: generation', () => {
    const valid = at({ checkStatus: 'valid' });
    const generating = at({ isLoading: true }, valid);
    const ended = (changes: Partial<WorkflowSnapshot>) => at({ isLoading: false, ...changes }, generating);
    const withClock = at({ hasBlueprint: true, selectedLabel: 'Clock A' }, generating);
    says([
        ['says generation started', valid, generating, ANNOUNCEMENTS.generating],
        ['names the selected clock when it ends with a blueprint', generating, ended({ hasBlueprint: true, selectedLabel: 'Clock A (12 swings)' }),
            ANNOUNCEMENTS.finished('Clock A (12 swings)')],
        ['says only that it finished when the clock has no name', generating, ended({ hasBlueprint: true }), ANNOUNCEMENTS.finishedNoLabel],
        ['says nothing when it ends without a blueprint (an error, or a cleared run)', generating, ended({}), null],
        ['says nothing when it ends without a blueprint, even with a clock name', generating, ended({ selectedLabel: 'Clock A' }), null],
        ['says nothing when the run fails after some clocks arrived (its error alert says it)', withClock, at({ isLoading: false, failed: true }, withClock), null],
        ['is not repeated as the first clocks of the run arrive', generating, withClock, null],
        ['is not repeated as later clocks arrive and the selection moves', withClock, at({ selectedLabel: 'Clock B' }, withClock), null],
    ]);
});

describe('workflowAnnouncement: choosing a clock', () => {
    const showing = at({ checkStatus: 'valid', hasBlueprint: true, selectedLabel: 'Fewest wake-ups', selectedId: 'a' });
    const quiet = at({ selectedId: 'r', selectionQuiet: true }, showing);
    const running = at({ isLoading: true }, showing);
    says([
        ['names the clock chosen while nothing runs', showing, at({ selectedLabel: 'Fewest wake windows', selectedId: 'b' }, showing),
            ANNOUNCEMENTS.showing('Fewest wake windows')],
        ['names a clock of the same name too, as the card changed', showing, at({ selectedId: 'c' }, showing), ANNOUNCEMENTS.showing('Fewest wake-ups')],
        ['says nothing when Back to recommended in the card moved the focus to its name, which reads it', showing,
            at({ selectedId: 'r', selectedLabel: 'Fewest wake windows', selectionQuiet: true }, showing), null],
        ['names the next row chosen in the table after Back to recommended', quiet, at({ selectedId: 'd', selectionQuiet: false }, quiet),
            ANNOUNCEMENTS.showing('Fewest wake-ups')],
        ['says nothing while a run goes on', running, at({ selectedLabel: 'X', selectedId: 'x' }, running), null],
        ['says nothing when the clocks first appear', idle, at({ hasBlueprint: true, selectedLabel: 'X', selectedId: 'x' }), null],
        ['says nothing when the clocks are cleared', showing, idle, null],
        ['says only that the run finished when it ends on another clock', running, at({ isLoading: false, selectedLabel: 'Y', selectedId: 'y' }, running),
            ANNOUNCEMENTS.finished('Y')],
    ]);
});

describe('workflowAnnouncement: order and repeats', () => {
    const checking = at({ checkStatus: 'running' });
    const both = at({ isLoading: true, checkStatus: 'running' });
    says([
        ['looks at generation before the check when a run starts as the check passes', checking, at({ isLoading: true, checkStatus: 'valid' }, checking),
            ANNOUNCEMENTS.generating],
        ['looks at generation before the check when a run ends as the check passes', both,
            at({ isLoading: false, hasBlueprint: true, selectedLabel: 'X', checkStatus: 'valid' }, both), ANNOUNCEMENTS.finished('X')],
    ]);

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
    const stopped = at({ stop: { id: 1, kept: 'partial' } });

    it.each<[RunStop['kept'], string]>([
        ['previous', ANNOUNCEMENTS.stoppedPrevious],
        ['partial', ANNOUNCEMENTS.stoppedPartial],
        ['none', ANNOUNCEMENTS.stoppedNone],
        ['check', ANNOUNCEMENTS.stoppedCheck],
    ])('says what a Cancel that kept %s left, and nothing else of the same change', (kept, text) => {
        // the run ends and another clock is shown in the same change: only the Stopped message
        expect(workflowAnnouncement(running, at({ isLoading: false, stop: { id: 1, kept }, selectedLabel: 'B', selectedId: 'b' }, running))).toBe(text);
    });

    says([
        ['says the same Cancel once', stopped, at({ checkStatus: 'valid' }, stopped), null],
        ['says the clocks for the build are back, with the selected one', idle, at({ restoredId: 1, hasBlueprint: true, selectedLabel: 'Fewest wake-ups', selectedId: 'x' }),
            ANNOUNCEMENTS.clocksBack('Fewest wake-ups')],
        ['says the pick was not made in place of "Finished generating."', running, at({ isLoading: false, pickGone: 'Shortest period' }, running),
            ANNOUNCEMENTS.pickGone('Shortest period')],
    ]);
});
