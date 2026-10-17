import type { ConfigFormData } from './configForm/formData';

/**
 * How many of Advanced's settings are in use: the LCM override, the forced output swings, fractional swings, the search
 * for fewer wake-ups, and ingredients excluded from the LCM (one, however many). Shown on the closed section ("Advanced ·
 * 2 set"), which folds again after Import, Paste and Reset, so a build that sets any is not taken for one that sets none.
 * The belt question's answer is not counted: it is asked outside Advanced.
 */
export function advancedSetCount(overrides: ConfigFormData['overrides']): number {
    if (!overrides) {
        return 0;
    }
    return [
        overrides.lcm !== undefined,
        overrides.terminal_swing_count !== undefined,
        overrides.use_fractional_swings === true,
        overrides.search_for_fewer_wake_ups === true,
        overrides.check_start_dependence !== undefined,
        overrides.loop_seed_items !== undefined,
        (overrides.ignored_lcm_ingredients?.length ?? 0) > 0,
    ].filter(Boolean).length;
}
