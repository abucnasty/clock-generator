import assert from '../common/assert';
import type { Config } from '../config/schema';
import { fraction } from '../data-types/fraction';
import { createEntityRegistryFromConfig } from './sequence/simulation-context';
import { CraftingCyclePlan } from './sequence/cycle/crafting-cycle';
import { EntityTransferCountMap } from './sequence/cycle/swing-counts';
import { TargetProductionRate } from './target-production-rate';
import type { SwingPeriodRejection, WholeSwingArithmeticSnapshot } from './plan/clock-period-limit';

/**
 * Descending whole-swing period arithmetic. Each count uses the existing planner again: fuel rounding and ignored
 * ingredients can change its denominators, so neither scaling a previous period nor binary search is sound.
 * Creating entities reads immutable recipe facts only; this never creates state, prepares or simulates a build.
 */
export function* wholeSwingPeriodsBelow(
    snapshot: WholeSwingArithmeticSnapshot,
    limit_ticks: number,
): Generator<SwingPeriodRejection> {
    const config = JSON.parse(snapshot.config_json) as Config;
    assert(config.target_output.counts !== 'destroyed' && config.overrides?.use_fractional_swings !== true,
        'Whole-swing period arithmetic needs an item-made target with integer output swings.');
    assert(Number.isSafeInteger(snapshot.terminal_swing_count) && snapshot.terminal_swing_count >= 1,
        'Whole-swing period arithmetic needs a positive integer initial count.');
    const registry = createEntityRegistryFromConfig(config);
    const target = TargetProductionRate.fromConfig(config.target_output);
    for (let count = snapshot.terminal_swing_count - 1; count >= 1; count--) {
        const plan = CraftingCyclePlan.create(target, registry, fraction(count), { ...config.overrides, terminal_swing_count: count });
        const computed_lcm = EntityTransferCountMap.lcm(plan.entity_transfer_map, config.overrides?.ignored_lcm_ingredients);
        const effective_lcm = config.overrides?.lcm ?? computed_lcm;
        const period_ticks = CraftingCyclePlan.ticksOfCycles(plan, effective_lcm);
        assert(Number.isFinite(period_ticks) && period_ticks > 0,
            `Clock period of ${period_ticks} ticks exceeds maximum allowed ${limit_ticks} ticks`);
        yield { terminal_swing_count: count, base_cycle_ticks: plan.total_duration_ticks.toDecimal(),
            computed_lcm, effective_lcm, period_ticks, limit_ticks };
    }
}
