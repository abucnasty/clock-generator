import { describe, expect, it, vi } from 'vitest';
import type { Config } from '../config';
import { ConfigPaths } from '../config/config-paths';
import { loadConfigFromFile } from '../config/loader';
import { fraction } from '../data-types/fraction';
import { generateClockWithSwingBackoff } from './generate-clock';
import type { BlueprintGenerationResult } from './plan/plan-run';
import { planOfConfig, planOfSample } from './planner/plan-test-helpers';
import { FractionalSwingsRefusedError } from './sequence/cycle/swing-distribution';

const quiet = { log() {}, warn() {}, error() {}, debug() {} };
const config = { target_output: { counts: 'made' }, overrides: {} } as unknown as Config;

function result(count: number, holds: boolean, fractional = true): BlueprintGenerationResult {
    return { used_terminal_swing_count: count, crafting_cycle_plan: { fractional_swings_enabled: fractional },
        stability_check: { holds, actual_output_items: holds ? 32 : 16, expected_output_items: 32, used_lcm: 1 } } as unknown as BlueprintGenerationResult;
}

/** A cycle plan that refuses fractional swings above `allowed` output swings a cycle, the first plan at 16/3 */
function refusingAbove(allowed: number, made: (count: number) => BlueprintGenerationResult) {
    return vi.fn((candidate: Config) => {
        const count = candidate.overrides?.terminal_swing_count;
        if (count === undefined || count > allowed) {
            throw new FractionalSwingsRefusedError(`refused at ${count ?? '16/3'}`, count === undefined ? fraction(16, 3) : fraction(count));
        }
        return made(count);
    });
}
const countsTried = (generate: ReturnType<typeof refusingAbove>) => generate.mock.calls.map(([candidate]) => candidate.overrides?.terminal_swing_count);

describe('fractional swings the insertion limits refuse', () => {
    it('are planned at the first whole count below that the cycle plan accepts', () => {
        const generate = refusingAbove(2, count => result(count, true));
        const generated = generateClockWithSwingBackoff(config, { logger: quiet, fractional_swings: true }, generate);
        expect(countsTried(generate)).toEqual([undefined, 5, 4, 3, 2]);
        expect(generated.used_terminal_swing_count).toBe(2);
        expect(generated.swing_backoff_report).toMatchObject({ triggered: false, initial_terminal_swing_count: 2, stable_terminal_swing_count: 2 });
    });

    it('back off from there as whole swings do, past a count the cycle plan refuses', () => {
        // 3 is planned but does not hold; 2 is refused again (a sub-cycle over the limits at that count); 1 holds
        const generate = vi.fn((candidate: Config) => {
            const count = candidate.overrides?.terminal_swing_count;
            if (count === undefined || count > 3 || count === 2) {
                throw new FractionalSwingsRefusedError('refused', count === undefined ? fraction(16, 3) : fraction(count));
            }
            return result(count, count === 1);
        });
        const generated = generateClockWithSwingBackoff(config, { logger: quiet, fractional_swings: true }, generate);
        expect(countsTried(generate)).toEqual([undefined, 5, 4, 3, 2, 1]);
        expect(generated.used_terminal_swing_count).toBe(1);
        expect(generated.swing_backoff_report).toMatchObject({ triggered: true, initial_terminal_swing_count: 3,
            attempts: [{ terminal_swing_count: 1, holds: true }], stable_terminal_swing_count: 1 });
    });

    it('make no clock where every count is refused, with the first refusal as the reason', () => {
        const generate = refusingAbove(0, count => result(count, true));
        expect(() => generateClockWithSwingBackoff(config, { logger: quiet, fractional_swings: true }, generate)).toThrow('refused at 16/3');
        expect(countsTried(generate)).toEqual([undefined, 5, 4, 3, 2, 1]);
    });

    it('make no clock where the count they are planned at has every swing whole: it is the clock of that many output swings', () => {
        const generate = refusingAbove(2, count => result(count, true, false));
        expect(() => generateClockWithSwingBackoff(config, { logger: quiet, fractional_swings: true }, generate))
            .toThrow(/^refused at 16\/3 At 2 output swings a cycle, the most the insertion limits allow, every inserter swings a whole number of times a cycle: the clock of 2 output swings\.$/);
    });

    it('are not planned at another count where the config forces one, nor without fractional swings asked for', () => {
        const forced = { ...config, overrides: { terminal_swing_count: 4 } } as Config;
        const at_forced = refusingAbove(2, count => result(count, true));
        expect(() => generateClockWithSwingBackoff(forced, { logger: quiet, fractional_swings: true }, at_forced)).toThrow('refused at 4');
        expect(countsTried(at_forced)).toEqual([4]);
        const not_asked = refusingAbove(2, count => result(count, true));
        expect(() => generateClockWithSwingBackoff(config, { logger: quiet }, not_asked)).toThrow('refused at 16/3');
        expect(countsTried(not_asked)).toEqual([undefined]);
    });

    it('electromagnetic science 330/s: refused at 5, 4 and 3 output swings, the build plan lists them at 2, with its fractional inputs', async () => {
        const { plan } = await planOfSample(ConfigPaths.ELECTROMAGNETIC_SCIENCE_330);
        expect(plan.groups[0].periods.find(choice => choice.listed_as === 'fractional'))
            .toMatchObject({ swings: 2, fractional: true, period_ticks: 704, kept: true });
        // forced, the count is planned as it is
        const sample = await loadConfigFromFile(ConfigPaths.ELECTROMAGNETIC_SCIENCE_330);
        const { plan: forced } = planOfConfig({ ...sample, overrides: { ...sample.overrides, terminal_swing_count: 3 } });
        expect(forced.groups[0].periods.find(choice => choice.listed_as === 'fractional'))
            .toMatchObject({ swings: null, fractional: true, pruned: { rule: 'cycle-refused' } });
    });
});
