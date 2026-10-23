import { whyNotStable, whyNotStableClockOf } from 'clock-generator/light';
import type { NotMadeClock, WhyNotStable, WhyNotStableCause } from 'clock-generator/browser';
import type { ClockAlternativeView } from '../worker/types';

/** The heading of the card's note on why no clock is stable, by its cause */
export const WHY_NOT_STABLE_TITLE: Record<WhyNotStableCause, string> = {
    'moving lane phases': 'Why no clock is stable: moving lane phases',
    'output chest full': 'Why no clock is stable: an output chest fills up',
    'no recovery': 'Why no clock is stable: it does not recover',
    'nothing holds': 'Why no clock is stable: nothing holds the rate',
};

/**
 * Why the recommended clock of a generation does not meet goal 1, in the words the engine's result gives it
 * (`why_not_stable`), worked out from the clocks as they are on screen; null when it does, or while there are none.
 * The target is the recommended clock's rate less how far it is off it, as every clock of a run has the same target.
 */
export function whyNotStableOf(
    alternatives: ClockAlternativeView[],
    recommendedIndex: number | null,
    backedUpBelts: boolean,
    notMade: NotMadeClock[],
): WhyNotStable | null {
    const recommended = recommendedIndex === null ? undefined : alternatives[recommendedIndex];
    if (!recommended) {
        return null;
    }
    const clocks = alternatives.map(clock => whyNotStableClockOf({ ...clock, as_built: clock.asBuilt, expected_output_items: clock.expectedOutputItems }));
    return whyNotStable(clocks, recommendedIndex!, {
        target_items_per_second: recommended.assessment.items_per_second - recommended.ranking.rate_off_target,
        backed_up_belts: backedUpBelts,
        not_made: notMade,
    });
}
