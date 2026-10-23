import { describe, expect, it } from 'vitest';
import type { ClockAlternativeView } from '../worker/types';
import { whyNotStableOf, WHY_NOT_STABLE_TITLE } from './whyNotStable';

/** The fields of a clock's view the note is read from, as the worker gives them: a moving-belt clock at 7.5 a second */
function view(overrides: Partial<ClockAlternativeView> = {}): ClockAlternativeView {
    return {
        id: 'swings-1', label: '1 output swing per cycle', verdict: 'unstable',
        ranking: { meets_target_rate: false, rate_off_target: 0, holds_expected_output: false, matches_belt_choice: true, wake_ups_per_minute: null, window_count: 4 },
        assessment: { holds: false, items_per_second: 7.5, wake_ups_per_minute: null, backpressure_loss: null, start_dependence: null },
        belt: { kind: 'moving', slack_ticks: [4] },
        asBuilt: { holds: false, actual_output_items: 176, start_phases_checked: 1, failed_start_offset: 0,
            failed_pickup_phases: { 'inserter:2': [3, 0] }, repeat_periods: 6, repeat_output_items: 880 },
        expectedOutputItems: 176,
        insights: [],
        ...overrides,
    } as ClockAlternativeView;
}

describe('the note on why no clock is stable', () => {
    it('names a full output chest from the clock\'s as-built check, under its own heading', () => {
        const chest = { chest_id: 1, chest_type: 'buffer-chest', name: 'Chest 1', item: 'electromagnetic-science-pack', item_label: 'electromagnetic science pack',
            held: 9600, capacity: 9600, inserter_ids: [1, 2] };
        const why = whyNotStableOf([view({ asBuilt: { holds: false, actual_output_items: 0, start_phases_checked: 1, full_output_chests: [chest] } as ClockAlternativeView['asBuilt'] })], 0, false, []);
        expect(why?.cause).toBe('output chest full');
        expect(why?.message).toContain('Chest 1 fills up. Nothing takes any electromagnetic science pack out of it, so it holds 9,600 of 9,600');
        expect(WHY_NOT_STABLE_TITLE[why!.cause]).toBe('Why no clock is stable: an output chest fills up');
    });

    it('says what the engine says of the recommended clock, from the clocks on screen', () => {
        const why = whyNotStableOf([view()], 0, false, []);
        expect(why?.cause).toBe('moving lane phases');
        expect(why?.message).toContain('not when the lanes reach inserter 2 in another phase: from such a start it moves 880 of 1056 items over 6 periods.');
        expect(why?.message).toContain('answer Backed up for the belts and generate again');
        expect(WHY_NOT_STABLE_TITLE[why!.cause]).toBe('Why no clock is stable: moving lane phases');
        // the run's belts were backed up already
        expect(whyNotStableOf([view()], 0, true, [])?.message).not.toContain('answer Backed up');
    });

    it('reads the target off the recommended clock, and lists the clocks that could not be made', () => {
        const short = view({ belt: null, asBuilt: null, assessment: { holds: false, items_per_second: 180, wake_ups_per_minute: null, backpressure_loss: null, start_dependence: null },
            ranking: { ...view().ranking, rate_off_target: -60 }, label: '2 output swings per cycle' });
        expect(whyNotStableOf([short], 0, false, [{ id: 'even-hands', label: 'Even hands', reason: 'even hands need a period of whole ticks, not 4.5' }])).toEqual({
            cause: 'nothing holds',
            message: 'No clock holds the target rate of 240 a second. The closest, 2 output swings per cycle, moves 180 a second, 60 under the target. '
                + 'Not made: Even hands (even hands need a period of whole ticks, not 4.5).',
        });
    });

    it('is not shown for a recommended clock that meets goal 1, nor without clocks', () => {
        const stable = view({ verdict: 'stable', ranking: { ...view().ranking, meets_target_rate: true } });
        expect(whyNotStableOf([view(), stable], 1, false, [])).toBeNull();
        expect(whyNotStableOf([], null, false, [])).toBeNull();
    });

    it('takes a clock kept before its belt was for one not made for a moving belt', () => {
        const kept = view({ belt: undefined });
        expect(whyNotStableOf([kept], 0, false, [])?.cause).toBe('nothing holds');
    });
});
