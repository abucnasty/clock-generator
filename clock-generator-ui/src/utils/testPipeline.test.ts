import { describe, expect, it } from 'vitest';
import type { ClockAlternativeView } from '../worker/types';
import { AUTOMATION_240, errorCaseViews, TRIALS_NOT_MADE_REASON, viewOf } from '../test/checkedLanesFixtures';
import { SUMMARY_COPY } from './clockSummary';
import { testPipelineOf, type TestBox } from './testPipeline';
import { oscillatingOf } from '../test/oscillationFixture';

/** Each box as "state: result | detail" */
const said = (clock: ClockAlternativeView) => testPipelineOf(clock).map((box: TestBox) => `${box.state}: ${box.result} | ${box.detail}`);
const namesOf = (clock: ClockAlternativeView) => testPipelineOf(clock).map(box => box.name);
const clock = (id: string) => viewOf(AUTOMATION_240, id);

describe('the tests of a clock, from the result\'s data', () => {
    it('names the three tests in the ruled order, with the copies the headline counts', () => {
        expect(namesOf(clock('time_study_windows'))).toEqual(['One copy alone', 'All 9 copies together', 'Loss of inputs']);
    });

    it('one copy fails: the copies and the loss trials are not run', () => {
        expect(said(clock('takt_batches_observed_swings_4'))).toEqual([
            'failed: Makes 180/s of 240/s | At steady state, from a cold start.',
            'not-run: Not run | One copy alone does not hold its rate.',
            'not-run: Not run | One copy alone does not hold its rate.',
        ]);
    });

    it('all pass', () => {
        expect(said(clock('time_study_windows'))).toEqual([
            'passed: Holds 240/s | At steady state, from a cold start.',
            'passed: Holds 240/s | On the lanes the copies share.',
            'passed: Recovers | After a supply stop and after an output blockage.',
        ]);
    });

    it('a loss with all the copies: the rate the card shows against the target; one copy recovers', () => {
        expect(said(clock('takt_batches_observed'))).toEqual([
            'passed: Holds 240/s | At steady state, from a cold start.',
            'failed: Makes 234.07/s of 240/s | On the lanes the copies share.',
            'passed: One copy recovers | The copies are not tried: they do not hold their rate.',
        ]);
    });

    it('all the copies pass and the copies do not recover (the trials on the copies, made only after one copy recovers)', () => {
        const pitch = clock('pitch_pickups');
        expect(pitch.assessment.disturbance_trial?.on_copies?.survives).toBe(false);
        expect(said(pitch)).toEqual([
            'passed: Holds 240/s | At steady state, from a cold start.',
            'passed: Holds 240/s | On the lanes the copies share.',
            'failed: The copies do not recover | One copy alone recovers.',
        ]);
    });

    it('a loss and one copy does not recover', () => {
        const one = clock('takt_batches_swings_1');
        expect(one.assessment.disturbance_trial?.on_copies).toBeUndefined();
        expect(said(one)).toEqual([
            'passed: Holds 240/s | At steady state, from a cold start.',
            'failed: Makes 234.46/s of 240/s | On the lanes the copies share.',
            'failed: One copy does not recover | It does not go back to its rate by itself.',
        ]);
    });

    it('a build of one copy: the inserters together do not apply where no lane is used by several, whatever one copy does', () => {
        const one = { ...clock('time_study_windows'), copies: 1, checkedLanes: undefined };
        expect(namesOf(one)[1]).toBe('Inserters together');
        expect(said(one)[1]).toBe('does-not-apply: Does not apply | No lane is used by several inserters.');
        expect(said({ ...clock('takt_batches_observed_swings_4'), copies: 1, checkedLanes: undefined })[1]).toBe('does-not-apply: Does not apply | No lane is used by several inserters.');
        // one copy that does not hold: the clock alone, and the test that comes after it does not run
        expect(said({ ...clock('takt_batches_observed_swings_4'), copies: 1 })).toEqual([
            'failed: Makes 180/s of 240/s | At steady state, from a cold start.',
            'not-run: Not run | The clock alone does not hold its rate.',
            'not-run: Not run | The clock alone does not hold its rate.',
        ]);
    });

    it('a build of fewer than one copy keeps the words of copies', () => {
        const part = { ...clock('time_study_windows'), copies: 0.5, checkedLanes: undefined };
        expect(namesOf(part)[1]).toBe('All copies together');
        expect(said(part)[1]).toBe('does-not-apply: Does not apply | The build has one copy.');
    });

    // a build of one copy whose inserters take from one lane: the engine checks the lane with all of them, and the box shows it
    it('a build of one copy with several inserters on a lane: the second test shows the check of the lane', () => {
        const loss = { ...clock('takt_batches_observed'), copies: 1 };
        expect(namesOf(loss)).toEqual(['Clock alone', 'Inserters together', 'Loss of inputs']);
        expect(said(loss)[1]).toBe('failed: Makes 234.07/s of 240/s | On the lanes several of its inserters take from.');
        expect(said({ ...clock('time_study_windows'), copies: 1 })[1]).toBe('passed: Holds 240/s | On the lanes several of its inserters take from.');
    });

    it('a build of one copy that loses swings on its lane: the loss trials say it is the inserters together that are not tried', () => {
        expect(said({ ...clock('takt_batches_observed'), copies: 1 })[2]).toBe('passed: Recovers alone | The inserters together are not tried: they do not hold their rate.');
    });

    it('a build of one copy: the trials on the inserters together that could not be made or do not recover', () => {
        const stable = { ...clock('time_study_windows'), copies: 1 };
        const trial = stable.assessment.disturbance_trial!;
        const withCopies = (on_copies: object) => ({ ...stable, assessment: { ...stable.assessment, disturbance_trial: { ...trial, on_copies } } }) as ClockAlternativeView;
        expect(said(withCopies({ ...trial.on_copies!, not_tried: 'out of memory' }))[2]).toBe('passed: Recovers alone | The inserters together could not be tried: out of memory.');
        expect(said(withCopies({ ...trial.on_copies!, survives: false }))[2]).toBe('failed: The inserters together do not recover | It recovers alone.');
    });

    it('a build of one copy where no lane they take from is run: the second test says so in the words of inserters', () => {
        const stable = { ...clock('time_study_windows'), copies: 1 };
        const notRun = { ...stable, checkedLanes: { ...stable.checkedLanes!, line: { ...stable.checkedLanes!.line, run_with_copies: false } } };
        expect(said(notRun)[1]).toBe('does-not-apply: Does not apply | No lane several inserters take from is run.');
    });

    it('no run with the copies where no lane they take from is run: the second test does not apply', () => {
        const stable = clock('time_study_windows');
        const notRun = { ...stable, checkedLanes: { ...stable.checkedLanes!, line: { ...stable.checkedLanes!.line, run_with_copies: false } } };
        expect(said(notRun)[1]).toBe('does-not-apply: Does not apply | No lane the copies take from is run with them.');
    });

    it.each<[Parameters<typeof errorCaseViews>[0], string]>([
        ['no-result', `${SUMMARY_COPY.errorNoResult}.`],
        ['not-tried', 'The loss trials could not be made: no item of the build stops arriving.'],
        ['baseline-missed', `${SUMMARY_COPY.errorBaselineMissed}.`],
    ])('Error, %s: the loss trials gave no result, and the box says why', (kind, detail) => {
        const views = errorCaseViews(kind);
        expect(TRIALS_NOT_MADE_REASON.startsWith('the loss trials')).toBe(true);
        expect(said(views[AUTOMATION_240.selected_index])[2]).toBe(`error: No result | ${detail}`);
    });

    it('a check of the shared lanes that stopped with an error, and a clock kept before the copies were run', () => {
        const stable = clock('time_study_windows');
        const stopped = { ...stable, assessment: { ...stable.assessment, shared_lane_losses: [{ kind: 'not_checked', reason: 'the belt has no lanes', text: '' }] } } as unknown as ClockAlternativeView;
        expect(said(stopped)[1]).toBe('error: No result | The lanes could not be checked: the belt has no lanes.');
        expect(said({ ...stable, checkedLanes: undefined })[1]).toBe('not-run: Not run | This clock was made before this test.');
    });

    it('trials on the copies that could not be made: one copy recovers, and why', () => {
        const stable = clock('time_study_windows');
        const trial = stable.assessment.disturbance_trial!;
        const untried = { ...stable, assessment: { ...stable.assessment, disturbance_trial: { ...trial, on_copies: { ...trial.on_copies!, not_tried: 'out of memory' } } } };
        expect(said(untried)[2]).toBe('passed: One copy recovers | The copies could not be tried: out of memory.');
    });
});

describe('the first box of a clock whose status is Oscillates', () => {
    it('says the status, as the chip does, where the clock does not hold at the setpoint', () => {
        expect(said(oscillatingOf(clock('time_study_windows')))[0]).toBe('failed: Oscillates | At steady state, from a cold start.');
    });

    it('says the rate first where the clock is off the setpoint', () => {
        const off = oscillatingOf(clock('time_study_windows'));
        const shown = { ...off, ranking: { ...off.ranking, rate_off_target: -48 }, assessment: { ...off.assessment, items_per_second: 192 } };
        expect(said(shown)[0]).toBe('failed: Makes 192/s of 240/s | At steady state, from a cold start.');
    });
});
