import assert from '../common/assert';
import type { Config } from '../config/schema';
import { fraction } from '../data-types/fraction';
import { createEntityRegistryFromConfig } from './sequence/simulation-context';
import { OutputCyclePlan } from './sequence/cycle/output-cycle';
import { EntityTransferCountMap } from './sequence/cycle/swing-counts';
import { TargetProductionRate } from './target-production-rate';
import type { SwingWindowCycleRejection, WholeSwingArithmeticSnapshot } from './plan/clock-window-cycle-limit';

/**
 * Descending whole-swing window cycle arithmetic. Each count uses the existing planner again: fuel rounding and ignored
 * ingredients can change its denominators, so neither scaling a previous window cycle nor binary search is sound.
 * Creating entities reads immutable recipe facts only; this never creates state, prepares or simulates a build.
 */
export function* wholeSwingWindowCyclesBelow(
    snapshot: WholeSwingArithmeticSnapshot,
    limit_ticks: number,
): Generator<SwingWindowCycleRejection> {
    const config = JSON.parse(snapshot.config_json) as Config;
    assert(config.setpoint.counts !== 'destroyed', 'Whole-swing period arithmetic needs an item-made target with integer output swings.');
    assert(Number.isSafeInteger(snapshot.terminal_swing_count) && snapshot.terminal_swing_count >= 1,
        'Whole-swing period arithmetic needs a positive integer initial count.');
    const registry = createEntityRegistryFromConfig(config);
    const target = TargetProductionRate.fromConfig(config.setpoint);
    for (let count = snapshot.terminal_swing_count - 1; count >= 1; count--) {
        const plan = OutputCyclePlan.create(target, registry, config, fraction(count), { ...config.overrides, terminal_swing_count: count });
        const computed_lcm = EntityTransferCountMap.lcm(plan.entity_transfer_map, config.overrides?.ignored_lcm_ingredients);
        const effective_lcm = config.overrides?.lcm ?? computed_lcm;
        const window_cycle_ticks = OutputCyclePlan.ticksOfCycles(plan, effective_lcm);
        assert(Number.isFinite(window_cycle_ticks) && window_cycle_ticks > 0,
            `Clock period of ${window_cycle_ticks} ticks exceeds maximum allowed ${limit_ticks} ticks`);
        yield { terminal_swing_count: count, base_cycle_ticks: plan.total_duration_ticks.toDecimal(),
            computed_lcm, effective_lcm, window_cycle_ticks, limit_ticks };
    }
}
