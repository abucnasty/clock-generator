import type { OscillationFacts } from 'clock-generator/browser';
import type { ClockAlternativeView } from '../worker/types';

/** The output of 26 window cycles that repeat: 288 items each, but 432 in the second and 144 in the eighteenth */
export const UNEVEN_REPEAT: OscillationFacts = {
    expected: 288, window_cycles_per_bin: 1, tolerance: 16, bins: 26, proven: true, repeat_window_cycles: 26,
    made: Array.from({ length: 26 }, (_, at) => at === 1 ? 432 : at === 17 ? 144 : 288),
};

/**
 * A clock of a kept result made into one whose long run makes the expected output on average with window cycles off it (the
 * engine's reason `oscillation`): it does not hold, its verdict is unstable, its rate is the target's, and it has no loss on a
 * shared lane. Synthetic numbers: no sample of the repo shows the case.
 */
export function oscillatingOf(view: ClockAlternativeView, facts: OscillationFacts = UNEVEN_REPEAT): ClockAlternativeView {
    const target = view.assessment.items_per_second - view.ranking.rate_off_target;
    return {
        ...view,
        verdict: 'unstable',
        ranking: { ...view.ranking, meets_target_rate: false, rate_off_target: 0 },
        assessment: { ...view.assessment, holds: false, items_per_second: target, disturbance_trial: null, shared_lane_losses: undefined },
        asBuilt: { holds: false, actual_output_items: facts.expected, start_phases_checked: 1, failed_start_offset: 0, output_reason: { code: 'oscillation', data: facts } },
        expectedOutputItems: facts.expected,
    };
}
