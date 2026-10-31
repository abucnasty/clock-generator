import { beforeAll, describe, expect, it, vi } from 'vitest';
import { loadConfigFromFile } from '../config/loader';
import { ConfigPaths } from '../config/config-paths';
import type { Config } from '../config/schema';
import { wholeSwingPeriodsBelow } from './whole-swing-periods';
import { ClockPeriodLimitError, type WholeSwingArithmeticSnapshot } from './plan/clock-period-limit';
import { runBuild, type BlueprintGenerationResult, type GenerateClockOptions, type RunOptions } from './plan/plan-run';
import { generateClockWithSwingBackoff, terminalCountForAlternativePlanning } from './generate-clock';
import { createEntityRegistryFromConfig } from './sequence/simulation-context';
import { CraftingCyclePlan, plannedTerminalSwingCount } from './sequence/cycle/crafting-cycle';
import { EntityTransferCountMap } from './sequence/cycle/swing-counts';
import { TargetProductionRate } from './target-production-rate';
import { fraction } from '../data-types/fraction';

const quiet = { log() {}, warn() {}, error() {}, debug() {} };
// A newly exposed generation duration policy must also update the arithmetic-snapshot eligibility contract.
const generationExcludesDuration: Extract<keyof GenerateClockOptions, 'period_ticks' | 'timeline_recording'> extends never ? true : false = true;
function result(count: number, holds: boolean): BlueprintGenerationResult {
    return { used_terminal_swing_count: count, stability_check: { holds, actual_output_items: holds ? 32 : 16,
        expected_output_items: 32, used_lcm: 1 } } as BlueprintGenerationResult;
}
const snapshotOf = (config: Config, count: number): WholeSwingArithmeticSnapshot => ({ config_json: JSON.stringify(config), terminal_swing_count: count });
function refusalOf(config: Config, options: RunOptions = {}): ClockPeriodLimitError {
    try { runBuild(config, { logger: quiet, ...options }); }
    catch (error) { if (error instanceof ClockPeriodLimitError) return error; throw error; }
    throw new Error('Expected a period refusal before scheduled simulation');
}

describe('automatic whole-swing period eligibility', () => {
    let config: Config, refusal: ClockPeriodLimitError;
    beforeAll(async () => {
        const control = await loadConfigFromFile(ConfigPaths.REAL_OWNER_PINK_SCIENCE_ORIGINAL);
        config = { ...control, overrides: undefined, inserters: control.inserters.map(inserter => ({ ...inserter, overrides: undefined })) };
        refusal = refusalOf(config);
    });

    it('reports the actual prepared 602-hand batch and immutable arithmetic rather than a simulated failure', () => {
        expect(refusal.rejection).toEqual({ terminal_swing_count: 602, base_cycle_ticks: 24080, computed_lcm: 605,
            effective_lcm: 605, period_ticks: 14568400, limit_ticks: 500000 });
        expect(refusal.arithmetic).toEqual(snapshotOf(config, 602));
        expect(Object.isFrozen(refusal.arithmetic)).toBe(true);
        expect(Object.isFrozen(refusal.rejection)).toBe(true);
        expect(refusal).not.toHaveProperty('stability_check');
    });

    it('recomputes the nonmonotonic LCM frontier: 52 initial refusals then 550 and 495', () => {
        const rows = [refusal.rejection, ...wholeSwingPeriodsBelow(refusal.arithmetic!, 500000)];
        const eligible = rows.filter(row => row.period_ticks < row.limit_ticks);
        expect(eligible.slice(0, 3).map(({ terminal_swing_count, effective_lcm, period_ticks }) => [terminal_swing_count, effective_lcm, period_ticks]))
            .toEqual([[550, 11, 242000], [495, 11, 217800], [484, 5, 96800]]);
        expect(eligible).toHaveLength(63);
        expect(rows.filter(row => row.period_ticks >= row.limit_ticks)).toHaveLength(539);
        expect(rows.findIndex(row => row.period_ticks < row.limit_ticks)).toBe(52);
        expect(eligible.at(-1)).toMatchObject({ terminal_swing_count: 1, period_ticks: 24200 });
    });

    it('keeps shared-buffer reporting at 594 while bounding planner retries below the actual 297 count', () => {
        // Supported synthetic regression topology; the acceptance scaffold is not changed. Its prepared count is 297
        // since the takers of one machine are served in one fixed order (it was 302 under the turn rule).
        const shared: Config = { ...config, chests: config.chests!.filter(chest => chest.id !== 3),
            inserters: config.inserters.map(inserter => ({ ...inserter,
                source: inserter.source.type === 'chest' && inserter.source.id === 3 ? { type: 'chest', id: 4 } : inserter.source,
                sink: inserter.sink.type === 'chest' && inserter.sink.id === 3 ? { type: 'chest', id: 4 } : inserter.sink,
            })) };
        const failure = refusalOf(shared);
        expect(failure.rejection).toMatchObject({ terminal_swing_count: 297, base_cycle_ticks: 11880,
            computed_lcm: 55, effective_lcm: 55, period_ticks: 653400 });
        expect(failure.arithmetic!.terminal_swing_count).toBe(297);
        const eligible = [...wholeSwingPeriodsBelow(failure.arithmetic!, 500000)].filter(row => row.period_ticks < row.limit_ticks);
        expect(eligible[0]).toMatchObject({ terminal_swing_count: 275, period_ticks: 121000, effective_lcm: 11 });
        expect(eligible.every(row => row.terminal_swing_count < 297)).toBe(true);
        // A short bounded run tests the existing result alias without accepting or verifying these large windows.
        const legacy = runBuild(shared, { logger: quiet, period_ticks: 40, warmup_periods: 0 });
        expect(legacy.used_terminal_swing_count).toBe(594);
        expect(plannedTerminalSwingCount(legacy.crafting_cycle_plan)).toBe(297);
        expect(legacy.crafting_cycle_plan).not.toHaveProperty('planned_terminal_swing_count');
        const generate = vi.fn((candidate: Config) => {
            const count = candidate.overrides?.terminal_swing_count;
            if (count === undefined) throw failure;
            // Preserve the legacy shared-taker aggregate on returned results.
            return result(2 * count, count === 242);
        });
        const generated = generateClockWithSwingBackoff(shared, { logger: quiet }, generate);
        expect(generate.mock.calls.map(([candidate]) => candidate.overrides?.terminal_swing_count)).toEqual([undefined, 275, 242]);
        expect(generated.used_terminal_swing_count).toBe(484);
        expect(terminalCountForAlternativePlanning(generated)).toBe(242);
        expect(terminalCountForAlternativePlanning(result(594, false))).toBe(594);
        expect(generated.swing_backoff_report).toMatchObject({ initial_terminal_swing_count: 275,
            initial_attempt: { terminal_swing_count: 275, holds: false }, attempts: [{ terminal_swing_count: 242, holds: true }],
            period_limit_pruning: { requested_terminal_swing_count: 297 } });
    });

    it('continues the lazy cursor after 550 fails, calls only eligible generators and preserves options/config', () => {
        const before = JSON.stringify(config);
        const options: GenerateClockOptions = { logger: quiet, verify_as_built: true, on_progress_detail: vi.fn(), loop_windows: true };
        const generate = vi.fn((candidate: Config, actualOptions: GenerateClockOptions) => {
            expect(actualOptions).toBe(options);
            expect({ ...candidate, overrides: undefined }).toEqual(config);
            if (candidate.overrides?.terminal_swing_count === undefined) throw refusal;
            return result(candidate.overrides.terminal_swing_count, candidate.overrides.terminal_swing_count === 495);
        });
        const generated = generateClockWithSwingBackoff(config, options, generate);
        expect(generate.mock.calls.map(([candidate]) => candidate.overrides?.terminal_swing_count)).toEqual([undefined, 550, 495]);
        expect(generated.used_terminal_swing_count).toBe(495);
        expect(generated.swing_backoff_report).toMatchObject({ initial_terminal_swing_count: 550,
            initial_attempt: { terminal_swing_count: 550, holds: false, actual_output_items: 16 },
            attempts: [{ terminal_swing_count: 495, holds: true, actual_output_items: 32 }],
            period_limit_pruning: { requested_terminal_swing_count: 602 } });
        const rejected = generated.swing_backoff_report!.period_limit_pruning!.rejections;
        expect(rejected.map(row => row.terminal_swing_count)).not.toContain(550);
        expect(rejected.map(row => row.terminal_swing_count)).not.toContain(495);
        expect(rejected.every(row => !('holds' in row) && !('actual_output_items' in row))).toBe(true);
        expect(JSON.stringify(config)).toBe(before);
    });

    it('keeps the first actual stable attempt truthful when arithmetic alone reduced the initial count', () => {
        const generate = vi.fn((candidate: Config) => {
            if (candidate.overrides?.terminal_swing_count === undefined) throw refusal;
            return result(candidate.overrides.terminal_swing_count, true);
        });
        const generated = generateClockWithSwingBackoff(config, { logger: quiet }, generate);
        expect(generated.swing_backoff_report).toMatchObject({ triggered: false, initial_terminal_swing_count: 550,
            initial_attempt: { terminal_swing_count: 550, holds: true }, attempts: [],
            period_limit_pruning: { requested_terminal_swing_count: 602 } });
        expect(generated.swing_backoff_report!.period_limit_pruning!.rejections).toHaveLength(52);
    });

    it('retains existing descending stability backoff and report shape for an in-budget initial plan', () => {
        const generate = vi.fn((candidate: Config) => result(candidate.overrides?.terminal_swing_count ?? 3,
            candidate.overrides?.terminal_swing_count === 2));
        const generated = generateClockWithSwingBackoff(config, { logger: quiet }, generate);
        expect(generate.mock.calls.map(([candidate]) => candidate.overrides?.terminal_swing_count)).toEqual([undefined, 2]);
        expect(generated.swing_backoff_report).toEqual({ triggered: true, initial_terminal_swing_count: 3,
            initial_attempt: { terminal_swing_count: 3, holds: false, actual_output_items: 16, expected_output_items: 32 },
            stable_terminal_swing_count: 2, attempts: [{ terminal_swing_count: 2, holds: true, actual_output_items: 32, expected_output_items: 32 }] });
    });

    it('preserves legacy requested-count reporting when an in-budget custom generator reports another count', () => {
        const generate = vi.fn((candidate: Config) => candidate.overrides?.terminal_swing_count === undefined
            ? result(3, false) : result(7, true));
        const generated = generateClockWithSwingBackoff(config, { logger: quiet }, generate);
        expect(generate.mock.calls.map(([candidate]) => candidate.overrides?.terminal_swing_count)).toEqual([undefined, 2]);
        expect(generated.used_terminal_swing_count).toBe(7);
        expect(generated.swing_backoff_report).toMatchObject({ stable_terminal_swing_count: 2,
            attempts: [{ terminal_swing_count: 2, holds: true }] });
        expect(generated.swing_backoff_report).not.toHaveProperty('period_limit_pruning');
    });

    it('handles a later over-cap backoff count without changing a preceding in-budget attempt', () => {
        const row = [...wholeSwingPeriodsBelow(refusal.arithmetic!, 500000)].find(period => period.terminal_swing_count === 549)!;
        const later = new ClockPeriodLimitError(row, snapshotOf(config, 549));
        const generate = vi.fn((candidate: Config) => {
            const count = candidate.overrides?.terminal_swing_count;
            if (count === undefined) return result(550, false);
            if (count === 549) throw later;
            return result(count, true);
        });
        const generated = generateClockWithSwingBackoff(config, { logger: quiet }, generate);
        expect(generate.mock.calls.map(([candidate]) => candidate.overrides?.terminal_swing_count)).toEqual([undefined, 549, 495]);
        expect(generated.swing_backoff_report).toMatchObject({ initial_terminal_swing_count: 550,
            initial_attempt: { terminal_swing_count: 550, holds: false }, attempts: [{ terminal_swing_count: 495, holds: true }],
            period_limit_pruning: { requested_terminal_swing_count: 550 } });
    });

    it.each(['explicit', 'fractional', 'destroyed'] as const)('does not prune the %s path', kind => {
        const candidate = structuredClone(config);
        if (kind === 'explicit') candidate.overrides = { terminal_swing_count: 602 };
        if (kind === 'fractional') candidate.overrides = { use_fractional_swings: true };
        if (kind === 'destroyed') candidate.target_output.counts = 'destroyed';
        const generate = vi.fn(() => { throw refusal; });
        expect(() => generateClockWithSwingBackoff(candidate, { logger: quiet }, generate)).toThrow(refusal);
        expect(generate).toHaveBeenCalledTimes(1);
    });

    it.each(['period_ticks', 'timeline_recording'] as const)('keeps an explicit %s duration refusal outside automatic pruning', field => {
        expect(generationExcludesDuration).toBe(true);
        const options: RunOptions = field === 'period_ticks' ? { period_ticks: 500000 } : { timeline_recording: { period_ticks: 500000 } };
        const fixed = refusalOf(config, options);
        expect(fixed.rejection.period_ticks).toBe(500000);
        expect(fixed.arithmetic).toBeUndefined();
        const generate = vi.fn(() => { throw fixed; });
        expect(() => generateClockWithSwingBackoff(config, { logger: quiet }, generate)).toThrow(fixed);
        expect(generate).toHaveBeenCalledTimes(1);
    });

    it.each([
        'Missing inserter coverage', 'Insufficient capacity', 'Invalid filter',
        'Clock period of 14568400 ticks exceeds maximum allowed 500000 ticks',
    ])('propagates unrelated errors without interpreting their text: %s', message => {
        const failure = new Error(message), generate = vi.fn(() => { throw failure; });
        expect(() => generateClockWithSwingBackoff(config, { logger: quiet }, generate)).toThrow(failure);
        expect(generate).toHaveBeenCalledTimes(1);
    });
});

describe('strict period limits and existing arithmetic policies', () => {
    const plain = (): Config => ({ target_output: { recipe: 'iron-plate', items_per_second: 16, copies: 1 },
        machines: [{ id: 1, recipe: 'iron-plate', productivity: 0, crafting_speed: 100 }], belts: [],
        chests: [{ id: 1, type: 'infinity-chest', item_filter: [{ item_name: 'iron-ore', request_count: 100 }] },
            { id: 2, type: 'infinity-chest', item_filter: [], remove_unfiltered_items: true }],
        inserters: [{ source: { type: 'chest', id: 1 }, sink: { type: 'machine', id: 1 } },
            { source: { type: 'machine', id: 1 }, sink: { type: 'chest', id: 2 } }] });

    it('rejects exact equality at the cap and returns the original refusal if no count is eligible', () => {
        const config = plain(), arithmetic = snapshotOf(config, 2);
        const failure = new ClockPeriodLimitError({ terminal_swing_count: 2, base_cycle_ticks: 120, computed_lcm: 1,
            effective_lcm: 1, period_ticks: 120, limit_ticks: 60 }, arithmetic);
        expect([...wholeSwingPeriodsBelow(arithmetic, 60)]).toMatchObject([{ terminal_swing_count: 1, period_ticks: 60 }]);
        const generate = vi.fn(() => { throw failure; });
        expect(() => generateClockWithSwingBackoff(config, { logger: quiet }, generate)).toThrow(failure);
        expect(generate).toHaveBeenCalledTimes(1);
    });

    it.each([NaN, Infinity, 0, -1, 59])('does not classify an invalid/in-budget period %s as a retryable refusal', period => {
        expect(() => new ClockPeriodLimitError({ terminal_swing_count: 2, base_cycle_ticks: period,
            computed_lcm: 1, effective_lcm: 1, period_ticks: period, limit_ticks: 60 }, snapshotOf(plain(), 2))).toThrow(RangeError);
    });

    it('uses the configured LCM without rewriting it', () => {
        const config = plain(); config.overrides = { lcm: 7 };
        expect([...wholeSwingPeriodsBelow(snapshotOf(config, 3), 1000)]).toMatchObject([
            { terminal_swing_count: 2, computed_lcm: 1, effective_lcm: 7, period_ticks: 840 },
            { terminal_swing_count: 1, computed_lcm: 1, effective_lcm: 7, period_ticks: 420 },
        ]);
    });

    it('recomputes rounded burner fuel and honors ignored ingredients instead of scaling a previous period', async () => {
        const config = await loadConfigFromFile(ConfigPaths.AGRICULTURAL_SCIENCE);
        config.overrides = { ignored_lcm_ingredients: ['nutrients'] };
        const registry = createEntityRegistryFromConfig(config), target = TargetProductionRate.fromConfig(config.target_output);
        const at = (count: number) => CraftingCyclePlan.create(target, registry, config, fraction(count));
        const seven = at(7), six = at(6);
        const fuelAt = (plan: typeof seven) => [...plan.entity_transfer_map.values()].find(row => row.entity.entity_id.number === 11)!
            .item_transfers.find(item => item.item_name === 'nutrients')!.transfer_count;
        // Existing fuel rounding: seven swings carry 3/5 hands, not six swings' fuel scaled by 7/6.
        expect(fuelAt(seven).toString()).toBe('3/5');
        expect(fuelAt(six).multiply(fraction(7, 6)).toString()).not.toBe('3/5');
        const rows = [...wholeSwingPeriodsBelow(snapshotOf(config, 8), 500000)];
        expect(rows[0]).toMatchObject({ terminal_swing_count: 7,
            computed_lcm: EntityTransferCountMap.lcm(seven.entity_transfer_map, ['nutrients']),
            period_ticks: CraftingCyclePlan.ticksOfCycles(seven, EntityTransferCountMap.lcm(seven.entity_transfer_map, ['nutrients'])) });
        expect(rows[1]).toMatchObject({ terminal_swing_count: 6,
            computed_lcm: EntityTransferCountMap.lcm(six.entity_transfer_map, ['nutrients']) });
        const immutable = snapshotOf(config, 3);
        config.overrides.lcm = 1000;
        expect([...wholeSwingPeriodsBelow(immutable, 500000)][0].effective_lcm).not.toBe(1000);
    });
});
