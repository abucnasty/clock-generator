import { describe, expect, it } from 'vitest';
import { advancedSetCount } from './advancedSummary';

describe('advancedSetCount', () => {
    it('is 0 with no overrides, or only the belt question\'s answer', () => {
        expect(advancedSetCount(undefined)).toBe(0);
        expect(advancedSetCount({})).toBe(0);
        expect(advancedSetCount({ non_moving_belts: true })).toBe(0);
        expect(advancedSetCount({ use_fractional_swings: false, ignored_lcm_ingredients: [] })).toBe(0);
    });

    it('counts each setting in use, and the LCM exclusions as one', () => {
        expect(advancedSetCount({ lcm: 60 })).toBe(1);
        expect(advancedSetCount({ terminal_swing_count: 2, search_for_fewer_wake_ups: true })).toBe(2);
        expect(advancedSetCount({ check_start_dependence: false, loop_seed_items: 0 })).toBe(2);
        expect(advancedSetCount({
            lcm: 60,
            terminal_swing_count: 2,
            use_fractional_swings: true,
            search_for_fewer_wake_ups: true,
            ignored_lcm_ingredients: ['iron-plate', 'coal'],
        })).toBe(5);
    });
});
