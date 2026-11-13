import { describe, expect, it } from 'vitest';
import type { ClockAlternativeView } from '../worker/types';
import { cardWarningOf, copyBlueprintLabelOf, isBelowTarget, rateWarningOf } from './rateWarning';
import { STALE_COPY_LABEL } from './resultsStaleness';
import { oscillatingOf } from '../test/oscillationFixture';
import { AUTOMATION_240, viewOf } from '../test/checkedLanesFixtures';

type Clock = Pick<ClockAlternativeView, 'verdict' | 'assessment' | 'ranking' | 'deadlockRisk'>;

/** A clock running at `itemsPerSecond`, `offTarget` from the target (negative: short of it) */
const clock = (itemsPerSecond: number, offTarget: number, meetsTarget = offTarget === 0): Clock => ({
    verdict: 'stable',
    assessment: { items_per_second: itemsPerSecond } as ClockAlternativeView['assessment'],
    ranking: { meets_target_rate: meetsTarget, rate_off_target: offTarget } as ClockAlternativeView['ranking'],
    deadlockRisk: null,
});

describe('copyBlueprintLabelOf', () => {
    // a row that leaves out stale or running has it false
    it.each<{ why: string; clock: Clock | undefined; stale?: boolean; running?: boolean; label: string }>([
        { why: 'a clock short of the target', clock: clock(192, -48), label: 'Copy blueprint (192/s, below setpoint)' },
        // the rate as the warning sentence prints it
        { why: 'a rate of 12.5/s', clock: clock(12.5, -2), label: 'Copy blueprint (12.5/s, below setpoint)' },
        { why: 'a rate of 0.333333/s', clock: clock(0.333333, -0.1), label: 'Copy blueprint (0.33/s, below setpoint)' },
        { why: 'a rate of 240/s, its zero kept', clock: clock(240, -10), label: 'Copy blueprint (240/s, below setpoint)' },
        { why: 'the smallest shortfall it prints', clock: clock(239.99, -0.01), label: 'Copy blueprint (239.99/s, below setpoint)' },
        { why: 'a shortfall too small to print', clock: clock(239.996, -0.004), label: 'Copy blueprint' },
        { why: 'no clock', clock: undefined, label: 'Copy blueprint' },
        { why: 'a clock at the target', clock: clock(240, 0, true), label: 'Copy blueprint' },
        { why: 'a clock above the target', clock: clock(252, 12, false), label: 'Copy blueprint' },
        { why: 'a clock unstable at the target rate', clock: clock(240, 0, false), label: 'Copy blueprint' },
        // while a generation is still making clocks
        { why: 'the best so far, at the target', clock: clock(240, 0, true), running: true, label: 'Copy current best' },
        { why: 'no clock yet', clock: undefined, running: true, label: 'Copy current best' },
        { why: 'the best so far, short of the target', clock: clock(192, -48), running: true, label: 'Copy current best (192/s, below setpoint)' },
        // the clocks are for an earlier build, which is said ahead of anything else
        { why: 'an old clock short of the target', clock: clock(192, -48), stale: true, label: STALE_COPY_LABEL },
        { why: 'old clocks, none selected', clock: undefined, stale: true, label: STALE_COPY_LABEL },
        { why: 'an old best so far', clock: clock(192, -48), stale: true, running: true, label: STALE_COPY_LABEL },
    ])('labels $why', ({ clock, stale = false, running, label }) => {
        expect(copyBlueprintLabelOf(clock, stale, running)).toBe(label);
    });

    it('agrees with the warning said when the blueprint is copied', () => {
        const short = clock(192, -48), atTarget = clock(240, 0, true);
        expect(rateWarningOf(short)).not.toBeNull();
        expect(copyBlueprintLabelOf(short, false)).toBe('Copy blueprint (192/s, below setpoint)');
        expect(rateWarningOf(atTarget)).toBeNull();
        expect(copyBlueprintLabelOf(atTarget, false)).toBe('Copy blueprint');
    });
});

describe('isBelowTarget', () => {
    it('counts a shortfall from the smallest the label prints', () => {
        expect(isBelowTarget(clock(239.99, -0.01))).toBe(true);
        expect(isBelowTarget(clock(239.996, -0.004))).toBe(false);
        expect(isBelowTarget(undefined)).toBe(false);
    });
});

describe('a stable clock over the target, picked where none meets it', () => {
    it('says how far over the target it runs', () => {
        const result = clock(82.286, 1.86725, false);
        result.ranking.stable_above_target = true;
        expect(rateWarningOf(result)).toBe('This clock runs over the setpoint: 82.29/s for the 80.42/s requested, 2.32% over, in the simulator.');
    });
});

describe('numerical output and actual hold checks', () => {
    it('does not turn the observed above-target numerical mismatch into a failed hold check', () => {
        const result = clock(216.061381, 0.061381, false);
        result.assessment.holds = true;
        expect(rateWarningOf(result)).toContain('output rate differs from the setpoint');
        expect(rateWarningOf(result)).toContain('216.06/s; requested 216/s');
        expect(rateWarningOf(result)).not.toContain('does not hold');
        result.assessment.holds = false;
        expect(rateWarningOf(result)).toContain('does not hold its expected output');
    });
});

// an iron gear wheel build at 9.97 a second: the 2,888-tick clock of a 2,888.666-tick window cycle meets goal 1 at 0.02% fast
describe('a clock rounded down to whole ticks that meets the target rate', () => {
    it('says how much it runs fast, and not that its rate differs', () => {
        const rounded = clock(9.972299, 0.002299, true);
        rounded.assessment.holds = true;
        rounded.ranking.runs_fast = 0.0002306;
        expect(rateWarningOf(rounded)).toBe('This clock’s window cycle time is rounded down to whole ticks, so it runs 0.02% fast: '
            + '9.972/s for the 9.97/s requested, within the 0.1% a rounded clock may run and what the machines can make.');
        expect(copyBlueprintLabelOf(rounded, false)).toBe('Copy blueprint');
    });
});

describe('a clock off the setpoint that has a loss on a shared lane', () => {
    // no sample has one: the rate the warning and the label say is what all the copies made together, the target the setpoint
    const off: Pick<ClockAlternativeView, 'verdict' | 'assessment' | 'ranking' | 'deadlockRisk' | 'checkedLanes'> = {
        ...clock(192, -48, false),
        verdict: 'unstable',
        assessment: { items_per_second: 192, shared_lane_losses: [{}] } as ClockAlternativeView['assessment'],
        checkedLanes: { copies_made: { items_per_second: 187.25, window_cycles: 30 } } as ClockAlternativeView['checkedLanes'],
    };

    it('says the copies\' rate against the setpoint, and so does the Copy label', () => {
        expect(rateWarningOf(off)).toContain('it runs at 187.25/s; requested 240/s in the simulator.');
        expect(copyBlueprintLabelOf(off, false)).toBe('Copy blueprint (187.25/s, below setpoint)');
    });

    it('says the clock-only rate where the result has no rate of the copies, as before', () => {
        const older = { ...off, checkedLanes: undefined };
        expect(rateWarningOf(older)).toContain('it runs at 192/s; requested 240/s in the simulator.');
        expect(copyBlueprintLabelOf(older, false)).toBe('Copy blueprint (192/s, below setpoint)');
    });
});

describe('the deadlock risk on the card and in the install dialog', () => {
    const what = 'Inserters 1 and 2 both bring iron plate to the machine 3 that makes gears; inserter 1 also brings coal.';
    const note = `Deadlock risk: ${what} An inserter that starts picking up an item the other has already filled the machine with holds its hand.`;
    const insight = { id: 'deadlock-risk', scope: 'build' as const, title: 'This build has a deadlock risk: two inserters bring the same item', what, why: 'Why.', explanation: 'Explanation.' };
    const risky = { ...clock(240, 0, true), deadlockRisk: note, insights: [insight] };

    it('is "Deadlock risk:" and the What of the engine\'s note on it; the Copy button\'s warning keeps the whole text', () => {
        expect(cardWarningOf(risky)).toBe(`Deadlock risk: ${what}`);
        expect(rateWarningOf(risky)).toBe(note);
    });

    it('keeps the engine\'s whole text on a result without the note, and says nothing on a build without the risk', () => {
        expect(cardWarningOf({ ...risky, insights: [] })).toBe(note);
        expect(cardWarningOf({ ...clock(240, 0, true), insights: [insight] })).toBeNull();
        expect(cardWarningOf(undefined)).toBeNull();
    });

    it('follows the clock\'s own warning, as before', () => {
        const short = { ...clock(192, -48), deadlockRisk: note, insights: [insight] };
        expect(cardWarningOf(short)).toBe(`${rateWarningOf({ ...short, deadlockRisk: null })} Deadlock risk: ${what}`);
    });
});

describe('the line at the top of a clock whose status is Oscillates', () => {
    it('says what the status means, in place of the line of a clock that does not hold', () => {
        const oscillating = oscillatingOf(viewOf(AUTOMATION_240, 'time_study_windows'));
        expect(rateWarningOf(oscillating)).toBe('This clock makes the setpoint on average, but not in every window cycle.');
    });

    it('keeps the line of a clock that does not hold where the clock is off the setpoint', () => {
        const oscillating = oscillatingOf(viewOf(AUTOMATION_240, 'time_study_windows'));
        const off = { ...oscillating, ranking: { ...oscillating.ranking, rate_off_target: -48 }, assessment: { ...oscillating.assessment, items_per_second: 192 } };
        expect(rateWarningOf(off)).toContain('does not hold its expected output');
    });
});
