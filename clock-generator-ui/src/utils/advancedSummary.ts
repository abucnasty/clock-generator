import type { ConfigFormData } from './configForm/formData';

/**
 * How many of Advanced's settings are in use: the LCM override, the forced output swings, the search
 * for fewer wake-ups, the cold start (the backpressure start is the default), and ingredients excluded from the LCM (one, however many). Shown on the closed section ("Advanced ·
 * 2 set"), which folds again after Import, Paste and Reset, so a build that sets any is not taken for one that sets none.
 */
export function advancedSetCount(overrides: ConfigFormData['overrides']): number {
    if (!overrides) {
        return 0;
    }
    return [
        overrides.lcm !== undefined,
        overrides.terminal_swing_count !== undefined,
        overrides.search_for_fewer_wake_ups === true,
        overrides.judged_start === 'cold',
        overrides.check_start_dependence !== undefined,
        overrides.kick_start_items !== undefined,
        (overrides.ignored_lcm_ingredients?.length ?? 0) > 0,
    ].filter(Boolean).length;
}
