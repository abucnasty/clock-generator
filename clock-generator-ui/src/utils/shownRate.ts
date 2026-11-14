import type { ClockAlternativeView } from '../worker/types';

/** The fields of a clock its shown rate is read from */
export type RatedClock = {
    assessment: Pick<ClockAlternativeView['assessment'], 'items_per_second'> & Partial<Pick<ClockAlternativeView['assessment'], 'shared_lane_losses'>>;
} & Partial<Pick<ClockAlternativeView, 'checkedLanes'>>;

/**
 * The rate a page shows for a clock, for all its copies: on a clock with a loss on a lane its copies share, what the
 * output inserters of all the copies put down in the run of the copies (`checked_lanes.copies_made`); on any other clock,
 * and where the result has no such rate, its rate in the clock-only run (`assessment.items_per_second`). Every place that
 * shows a clock's rate reads this; the status, the ranking and the target read the assessment.
 */
export function shownRateOf(clock: RatedClock): number {
    const made = clock.checkedLanes?.copies_made;
    return (clock.assessment.shared_lane_losses?.length ?? 0) > 0 && made !== undefined ? made.items_per_second : clock.assessment.items_per_second;
}
