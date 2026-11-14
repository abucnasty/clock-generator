import type { ClockAlternativeView } from '../worker/types';
import { formatNumberText } from './numberText';
import { isOffTarget, notTriedReasonOf, SUMMARY_COPY, targetOf } from './clockSummary';
import { shownRateOf } from './shownRate';
import { rateVerbs } from './targetCounts';

/**
 * The tests a clock goes through, as the Diagnostics tab draws them: one copy alone, all the copies together, and the loss
 * of inputs. Each box's state and words come from the result's data alone (the engine's facts), never from its sentences.
 */

/** The fields of a clock its tests are read from */
export type PipelineClock = Pick<ClockAlternativeView, 'assessment' | 'ranking' | 'copies'>
    & Partial<Pick<ClockAlternativeView, 'checkedLanes' | 'counts' | 'asBuilt'>>;

/** What a box says of its test */
export type TestState = 'passed' | 'failed' | 'not-run' | 'does-not-apply' | 'error';

export interface TestBox {
    test: 'one-copy' | 'all-copies' | 'losses';
    /** The test's name */
    name: string;
    state: TestState;
    /** The result, in bold */
    result: string;
    /** One line under it */
    detail: string;
}

/** Every string of the graphic, in one place for the glossary and for review */
export const TEST_PIPELINE_COPY = {
    heading: 'Tests of this clock',
    states: { passed: 'Passed', failed: 'Failed', 'not-run': 'Not run', 'does-not-apply': 'Does not apply', error: 'Error' } satisfies Record<TestState, string>,
    // a build of one copy has no copy to run alone: the tests say the clock alone, then the inserters together
    oneCopy: (copies: number) => copies === 1 ? 'Clock alone' : 'One copy alone',
    // a build of one copy has no copies to put together: its inserters are what the test runs together on their lanes
    allCopies: (copies: number) => copies > 1 ? `All ${formatNumberText(copies)} copies together` : copies === 1 ? 'Inserters together' : 'All copies together',
    losses: 'Loss of inputs',
    holds: (target: string) => `Holds ${target}/s`,
    makesOf: (rate: string, target: string, verb: string) => `${verb} ${rate}/s of ${target}/s`,
    doesNotHold: 'Does not hold its rate',
    steadyState: 'At steady state, from a cold start.',
    /** Where the test ran: the lanes the copies share, or in a build of one copy the lanes several of its inserters take from */
    onSharedLanes: (copies: number) => copies > 1 ? 'On the lanes the copies share.' : 'On the lanes several of its inserters take from.',
    notRun: 'Not run',
    oneCopyFails: (copies: number) => copies === 1 ? 'The clock alone does not hold its rate.' : 'One copy alone does not hold its rate.',
    doesNotApply: 'Does not apply',
    oneCopyBuild: (copies: number) => copies === 1 ? 'No lane is used by several inserters.' : 'The build has one copy.',
    noLaneRun: (copies: number) => copies === 1 ? 'No lane several inserters take from is run.' : 'No lane the copies take from is run with them.',
    keptBefore: 'This clock was made before this test.',
    noResult: 'No result',
    lanesNotChecked: (reason: string) => `The lanes could not be checked: ${sentenceEnd(reason)}`,
    recovers: 'Recovers',
    oneCopyRecovers: (copies: number) => copies === 1 ? 'Recovers alone' : 'One copy recovers',
    afterLosses: 'After a supply stop and after an output blockage.',
    copiesNotTried: (copies: number) => copies === 1 ? 'The inserters together are not tried: they do not hold their rate.' : 'The copies are not tried: they do not hold their rate.',
    copiesCouldNotBeTried: (reason: string, copies: number) => `${copies === 1 ? 'The inserters together' : 'The copies'} could not be tried: ${sentenceEnd(reason)}`,
    copiesDoNotRecover: (copies: number) => copies === 1 ? 'The inserters together do not recover' : 'The copies do not recover',
    oneCopyAloneRecovers: (copies: number) => copies === 1 ? 'It recovers alone.' : 'One copy alone recovers.',
    doesNotRecover: 'Does not recover',
    oneCopyDoesNotRecover: (copies: number) => copies === 1 ? 'Does not recover alone' : 'One copy does not recover',
    notBackByItself: 'It does not go back to its rate by itself.',
};

/** A reason as the end of a sentence: its full stop, once */
function sentenceEnd(reason: string): string {
    return /[.!?]$/.test(reason) ? reason : `${reason}.`;
}

/** A reason as a sentence of its own: capitalised, with its full stop */
function sentenceOf(reason: string): string {
    return sentenceEnd(reason.charAt(0).toUpperCase() + reason.slice(1));
}

/** The rate a box says, as the card says it: "Holds 240/s" at the target, else "Makes 234.07/s of 240/s" */
function rateResult(clock: PipelineClock, rate: number): string {
    const target = targetOf(clock);
    const text = (value: number) => formatNumberText(value);
    return isOffTarget({ ranking: { ...clock.ranking, rate_off_target: rate - target } })
        ? TEST_PIPELINE_COPY.makesOf(text(rate), text(target), rateVerbs(clock.counts).title)
        : TEST_PIPELINE_COPY.holds(text(target));
}

/**
 * Test 1: one copy alone, the clock-only check (`assessment.holds`). Failed off the setpoint, its rate; at it, the status
 * Oscillates where the engine gives its reason (`as_built.output_reason`, as the status reads it), else that it does not hold
 */
function oneCopyBox(clock: PipelineClock): TestBox {
    const box = { test: 'one-copy' as const, name: TEST_PIPELINE_COPY.oneCopy(clock.copies), detail: TEST_PIPELINE_COPY.steadyState };
    const rate = clock.assessment.items_per_second;
    if (clock.assessment.holds) return { ...box, state: 'passed', result: rateResult(clock, rate) };
    const result = isOffTarget(clock) ? rateResult(clock, rate)
        : clock.asBuilt?.output_reason?.code === 'oscillation' ? SUMMARY_COPY.oscillates : TEST_PIPELINE_COPY.doesNotHold;
    return { ...box, state: 'failed', result };
}

/** Whether the run of the copies stopped with an error: a loss of kind `not_checked` */
function lanesNotChecked(clock: PipelineClock): { reason: string } | undefined {
    const loss = clock.assessment.shared_lane_losses?.find(it => 'kind' in it && it.kind === 'not_checked');
    return loss && 'reason' in loss && typeof loss.reason === 'string' ? { reason: loss.reason } : undefined;
}

/**
 * Test 2: all the copies together on the lanes they share, or every inserter of a build of one copy on the lanes several of
 * them take from. Does not apply to a build of one copy with no such lane; not run where one copy
 * alone does not hold; failed on a loss on a shared lane (`shared_lane_losses`); an error where the check stopped with one;
 * does not apply where no lane the copies take from is run (`checked_lanes.line.run_with_copies` false while one copy holds)
 */
function allCopiesBox(clock: PipelineClock): TestBox {
    const box = { test: 'all-copies' as const, name: TEST_PIPELINE_COPY.allCopies(clock.copies) };
    const checked = clock.checkedLanes;
    // the engine checks no lane of a build of one copy where no two of its inserters take from one lane
    if ((checked === undefined || checked === null) && clock.copies <= 1) {
        return { ...box, state: 'does-not-apply', result: TEST_PIPELINE_COPY.doesNotApply, detail: TEST_PIPELINE_COPY.oneCopyBuild(clock.copies) };
    }
    if (!clock.assessment.holds) return { ...box, state: 'not-run', result: TEST_PIPELINE_COPY.notRun, detail: TEST_PIPELINE_COPY.oneCopyFails(clock.copies) };
    const stopped = lanesNotChecked(clock);
    if (stopped) return { ...box, state: 'error', result: TEST_PIPELINE_COPY.noResult, detail: TEST_PIPELINE_COPY.lanesNotChecked(stopped.reason) };
    if ((clock.assessment.shared_lane_losses?.length ?? 0) > 0) {
        return { ...box, state: 'failed', result: rateResult(clock, shownRateOf(clock)), detail: TEST_PIPELINE_COPY.onSharedLanes(clock.copies) };
    }
    if (checked === undefined || checked === null) return { ...box, state: 'not-run', result: TEST_PIPELINE_COPY.notRun, detail: TEST_PIPELINE_COPY.keptBefore };
    if (!checked.line.run_with_copies) return { ...box, state: 'does-not-apply', result: TEST_PIPELINE_COPY.doesNotApply, detail: TEST_PIPELINE_COPY.noLaneRun(clock.copies) };
    return { ...box, state: 'passed', result: rateResult(clock, shownRateOf(clock)), detail: TEST_PIPELINE_COPY.onSharedLanes(clock.copies) };
}

/**
 * Test 3: the loss of inputs (`disturbance_trial`). Not run where one copy alone does not hold. An error where the trials gave
 * no result: none was made, or the run with nothing cut missed its expected output (no loss named). The trials on the copies
 * (`on_copies`) are made only after one copy recovers: there, one copy recovered and the box says whether the copies do. Where
 * the copies lose swings on a shared lane they are not tried, and the box says what one copy does.
 */
function lossesBox(clock: PipelineClock, copiesFail: boolean): TestBox {
    const box = { test: 'losses' as const, name: TEST_PIPELINE_COPY.losses };
    if (!clock.assessment.holds) return { ...box, state: 'not-run', result: TEST_PIPELINE_COPY.notRun, detail: TEST_PIPELINE_COPY.oneCopyFails(clock.copies) };
    const trial = clock.assessment.disturbance_trial;
    if (trial === null || trial === undefined) {
        const reason = notTriedReasonOf(clock);
        return { ...box, state: 'error', result: TEST_PIPELINE_COPY.noResult, detail: reason === undefined ? `${SUMMARY_COPY.errorNoResult}.` : sentenceOf(reason) };
    }
    if (!trial.survives && trial.broken_by.length === 0) {
        return { ...box, state: 'error', result: TEST_PIPELINE_COPY.noResult, detail: `${SUMMARY_COPY.errorBaselineMissed}.` };
    }
    const copies = trial.on_copies;
    if (copies !== undefined) {
        if (copies.not_tried !== undefined) {
            return { ...box, state: 'passed', result: TEST_PIPELINE_COPY.oneCopyRecovers(clock.copies), detail: TEST_PIPELINE_COPY.copiesCouldNotBeTried(copies.not_tried, clock.copies) };
        }
        return copies.survives
            ? { ...box, state: 'passed', result: TEST_PIPELINE_COPY.recovers, detail: TEST_PIPELINE_COPY.afterLosses }
            : { ...box, state: 'failed', result: TEST_PIPELINE_COPY.copiesDoNotRecover(clock.copies), detail: TEST_PIPELINE_COPY.oneCopyAloneRecovers(clock.copies) };
    }
    if (trial.survives) {
        return copiesFail
            ? { ...box, state: 'passed', result: TEST_PIPELINE_COPY.oneCopyRecovers(clock.copies), detail: TEST_PIPELINE_COPY.copiesNotTried(clock.copies) }
            : { ...box, state: 'passed', result: TEST_PIPELINE_COPY.recovers, detail: TEST_PIPELINE_COPY.afterLosses };
    }
    return { ...box, state: 'failed', result: copiesFail ? TEST_PIPELINE_COPY.oneCopyDoesNotRecover(clock.copies) : TEST_PIPELINE_COPY.doesNotRecover, detail: TEST_PIPELINE_COPY.notBackByItself };
}

/** The three tests of a clock, in the order the graphic draws them */
export function testPipelineOf(clock: PipelineClock): [TestBox, TestBox, TestBox] {
    const two = allCopiesBox(clock);
    return [oneCopyBox(clock), two, lossesBox(clock, two.state === 'failed')];
}
