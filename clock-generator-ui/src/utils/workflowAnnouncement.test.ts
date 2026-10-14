import { describe, expect, it } from 'vitest';
import { ANNOUNCEMENTS, workflowAnnouncement, type WorkflowSnapshot } from './workflowAnnouncement';

const idle: WorkflowSnapshot = { validationStatus: 'none', isLoading: false, failed: false, hasBlueprint: false, selectedLabel: null, selectedId: null };
const at = (changes: Partial<WorkflowSnapshot>, from: WorkflowSnapshot = idle): WorkflowSnapshot => ({ ...from, ...changes });

describe('workflowAnnouncement: validation', () => {
    it('says the check started', () => {
        expect(workflowAnnouncement(idle, at({ validationStatus: 'running' }))).toBe('Checking the configuration.');
    });

    it('says how the check ended', () => {
        const running = at({ validationStatus: 'running' });
        expect(workflowAnnouncement(running, at({ validationStatus: 'valid' }))).toBe('The configuration is valid.');
        expect(workflowAnnouncement(running, at({ validationStatus: 'invalid' }))).toBe('The configuration is not valid.');
    });

    it('says when a valid configuration was changed', () => {
        expect(workflowAnnouncement(at({ validationStatus: 'valid' }), at({ validationStatus: 'out-of-date' })))
            .toBe('The configuration changed since it was checked.');
    });

    it.each<WorkflowSnapshot['validationStatus']>(['running', 'valid', 'invalid', 'out-of-date'])(
        'says nothing when it goes from %s back to none',
        (status) => {
            expect(workflowAnnouncement(at({ validationStatus: status }), idle)).toBeNull();
        }
    );
});

describe('workflowAnnouncement: generation', () => {
    const valid = at({ validationStatus: 'valid' });
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
    const showing = at({ validationStatus: 'valid', hasBlueprint: true, selectedLabel: 'Fewest wake-ups', selectedId: 'a' });

    it('names the clock chosen while nothing runs', () => {
        expect(workflowAnnouncement(showing, at({ selectedLabel: 'Fewest wake windows', selectedId: 'b' }, showing)))
            .toBe('Showing Fewest wake windows.');
    });

    it('names a clock of the same name too, as the card changed', () => {
        expect(workflowAnnouncement(showing, at({ selectedId: 'c' }, showing))).toBe('Showing Fewest wake-ups.');
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
    it('looks at generation before validation when both change', () => {
        const before = at({ validationStatus: 'valid' });
        expect(workflowAnnouncement(before, at({ isLoading: true, validationStatus: 'out-of-date' }, before)))
            .toBe('Generating clocks.');
        const running = at({ isLoading: true, validationStatus: 'valid' });
        expect(workflowAnnouncement(running, at({ isLoading: false, hasBlueprint: true, selectedLabel: 'X', validationStatus: 'out-of-date' }, running)))
            .toBe('Finished generating. Selected clock: X.');
    });

    it('says nothing for an unchanged snapshot', () => {
        for (const snapshot of [idle, at({ validationStatus: 'valid' }), at({ isLoading: true }), at({ hasBlueprint: true, selectedLabel: 'X' })]) {
            expect(workflowAnnouncement(snapshot, { ...snapshot })).toBeNull();
        }
    });

    it('keeps every message a non-empty sentence', () => {
        const texts = [...Object.values(ANNOUNCEMENTS).filter((it) => typeof it === 'string'), ANNOUNCEMENTS.finished('X'), ANNOUNCEMENTS.showing('X')];
        for (const text of texts) {
            expect(text).toMatch(/^[A-Z].*\.$/);
        }
    });
});
