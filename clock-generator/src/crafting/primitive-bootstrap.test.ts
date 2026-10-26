import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../config';
import { ConfigPaths } from '../config/config-paths';
import { loadConfigFromFile } from '../config/loader';
import { ClockPeriodLimitError } from './plan/clock-period-limit';
import type { BlueprintGenerationResult, GenerateClockOptions, PlanRun } from './plan/plan-run';
import { generateClockWithSwingBackoff } from './generate-clock';
import { primitiveGroupedOptionsSupported } from './candidates/verified-primitive-grouped';
import type { PrimitiveGroupedAttemptReport } from './primitive-grouped-policy';

const mocks = vi.hoisted(() => ({
    planRun: vi.fn(),
    clockOfPlan: vi.fn(),
    checkedClock: vi.fn(),
    groupedHandsClock: vi.fn(),
    observedWindowsClock: vi.fn(),
    resultWindowsClockOfPlan: vi.fn(),
    verifiedPrimitiveGroupedClock: vi.fn(),
}));

vi.mock('./plan/plan-run', async importOriginal => {
    const actual = await importOriginal<typeof import('./plan/plan-run')>();
    return { ...actual, planRun: mocks.planRun, clockOfPlan: mocks.clockOfPlan, checkedClock: mocks.checkedClock };
});

vi.mock('./candidates/verified-primitive-grouped', async importOriginal => {
    const actual = await importOriginal<typeof import('./candidates/verified-primitive-grouped')>();
    return { ...actual, verifiedPrimitiveGroupedClock: mocks.verifiedPrimitiveGroupedClock };
});

vi.mock('./candidates/grouped-hands', async importOriginal => {
    const actual = await importOriginal<typeof import('./candidates/grouped-hands')>();
    return { ...actual, groupedHandsClock: mocks.groupedHandsClock };
});

vi.mock('./candidates/observed-windows', async importOriginal => {
    const actual = await importOriginal<typeof import('./candidates/observed-windows')>();
    return { ...actual, observedWindowsClock: mocks.observedWindowsClock };
});

vi.mock('./candidates/result-windows-clock', async importOriginal => {
    const actual = await importOriginal<typeof import('./candidates/result-windows-clock')>();
    return { ...actual, resultWindowsClockOfPlan: mocks.resultWindowsClockOfPlan };
});

const quiet = { log() {}, warn() {}, error() {}, debug() {} };
const acceptedReport: PrimitiveGroupedAttemptReport = {
    strategy: 'primitive-grouped', eligibility: 'separate-windows-only', outcome: 'accepted', attempts: [],
};

let original: Config;

function config(overrides?: Config['overrides'], counts: Config['target_output']['counts'] = original.target_output.counts): Config {
    return { ...original, target_output: { ...original.target_output, counts }, overrides,
        inserters: original.inserters.map(inserter => ({ ...inserter, overrides: undefined })) };
}

function result(count: number, holds: boolean, primitive = false): BlueprintGenerationResult {
    return {
        used_terminal_swing_count: primitive ? 2 : count,
        ...(primitive && { primitive_grouped: {
            strategy: 'primitive-grouped', trigger: 'initial-period-limit', requested_terminal_swing_count: 602,
            terminal_swing_count: 1, grouped_cycles: 1, construction_key: 'test-construction',
            options: { share_windows: false, feeder_offset: 16, surplus_guard: false }, loop_refinement: false,
        } }),
        stability_check: { holds, actual_output_items: primitive ? 16 : holds ? 32 : 16, expected_output_items: 32, used_lcm: 1,
            as_built: { holds, actual_output_items: primitive ? 32 : holds ? 32 : 16, start_phases_checked: 12, long_run_proven: false } },
    } as unknown as BlueprintGenerationResult;
}

function refusalFor(candidate: Config): ClockPeriodLimitError {
    return new ClockPeriodLimitError({ terminal_swing_count: 602, base_cycle_ticks: 24080,
        computed_lcm: 605, effective_lcm: 605, period_ticks: 14568400, limit_ticks: 500000 },
    { config_json: JSON.stringify(candidate), terminal_swing_count: 602 });
}

function report(outcome: 'inapplicable' | 'failed', reason: string): PrimitiveGroupedAttemptReport {
    return { strategy: 'primitive-grouped', eligibility: 'separate-windows-only', outcome, reason,
        attempts: outcome === 'failed' ? [{ construction_key: 'one', stage: 'as-built', reason }] : [] };
}

function preparedPlan(candidate: Config): PlanRun {
    return { config: candidate, run: { crafting_cycle_plan: { result_windows: undefined } } } as unknown as PlanRun;
}

function prepareOrdinaryRun(candidate: Config): void {
    const refusal = refusalFor(candidate);
    mocks.planRun.mockImplementation((next: Config) => {
        if (next.overrides?.terminal_swing_count === undefined) throw refusal;
        return preparedPlan(next);
    });
    mocks.clockOfPlan.mockReturnValue({ windows: new Map() });
    mocks.checkedClock.mockImplementation((plan: PlanRun) => {
        const count = plan.config.overrides?.terminal_swing_count ?? 602;
        return result(count, count !== 550);
    });
    mocks.groupedHandsClock.mockReturnValue(null);
    mocks.observedWindowsClock.mockReturnValue(result(1, true));
    mocks.resultWindowsClockOfPlan.mockReturnValue(result(1, true));
}

describe('verified primitive bootstrap orchestration', () => {
    const options: GenerateClockOptions = { logger: quiet, verify_as_built: true };

    beforeAll(async () => {
        const loaded = await loadConfigFromFile(ConfigPaths.REAL_OWNER_PINK_SCIENCE_ORIGINAL);
        original = { ...loaded, overrides: undefined,
            inserters: loaded.inserters.map(inserter => ({ ...inserter, overrides: undefined })) };
    });

    beforeEach(() => vi.clearAllMocks());

    it('tries the primitive once only for the initial typed period refusal and preserves its planner count', () => {
        const candidate = config();
        prepareOrdinaryRun(candidate);
        const constructed = result(1, true, true);
        mocks.verifiedPrimitiveGroupedClock.mockReturnValue({ clock: constructed, report: acceptedReport });

        const generated = generateClockWithSwingBackoff(candidate, options);

        expect(mocks.verifiedPrimitiveGroupedClock).toHaveBeenCalledTimes(1);
        expect(mocks.verifiedPrimitiveGroupedClock).toHaveBeenCalledWith(candidate, options, 602);
        expect(mocks.planRun).toHaveBeenCalledTimes(1); // 602 was refused arithmetically; no simulation was invented.
        expect(mocks.checkedClock).not.toHaveBeenCalled();
        expect(generated.used_terminal_swing_count).toBe(2); // Preserve the legacy aggregate report.
        expect(generated.primitive_grouped?.terminal_swing_count).toBe(1);
        expect(generated.stability_check.actual_output_items).toBe(16); // Planner output is diagnostic, not as-built verdict.
        expect(generated.swing_backoff_report).toMatchObject({ triggered: false, initial_terminal_swing_count: 1,
            initial_attempt: { terminal_swing_count: 1, holds: true, actual_output_items: 32 }, attempts: [],
            primitive_grouped_attempt: acceptedReport,
            period_limit_pruning: { requested_terminal_swing_count: 602 } });
    });

    it.each([
        ['inapplicable/refused', report('inapplicable', 'not supported')],
        ['failed/incomplete', report('failed', 'the as-built check did not hold')],
        ['incomplete recovery', { ...report('failed', 'recovery was incomplete'), attempts: [{ construction_key: 'one', stage: 'recovery', reason: 'recovery was incomplete' }] }],
    ] as const)('falls back unchanged after one primitive %s result', (_name, primitiveReport) => {
        const candidate = config();
        prepareOrdinaryRun(candidate);
        mocks.verifiedPrimitiveGroupedClock.mockReturnValue({ clock: null, report: primitiveReport });

        const generated = generateClockWithSwingBackoff(candidate, options);

        expect(mocks.verifiedPrimitiveGroupedClock).toHaveBeenCalledTimes(1);
        expect(mocks.verifiedPrimitiveGroupedClock).toHaveBeenCalledWith(candidate, options, 602);
        expect(mocks.planRun.mock.calls.map(([next]) => next.overrides?.terminal_swing_count)).toEqual([undefined, 550, 495]);
        expect(mocks.checkedClock.mock.calls.map(([plan]) => plan.config.overrides?.terminal_swing_count)).toEqual([550, 495]);
        expect(generated.used_terminal_swing_count).toBe(495);
        expect(generated.swing_backoff_report).toMatchObject({ triggered: true, initial_terminal_swing_count: 550,
            initial_attempt: { terminal_swing_count: 550, holds: false },
            attempts: [{ terminal_swing_count: 495, holds: true }], primitive_grouped_attempt: primitiveReport,
            period_limit_pruning: { requested_terminal_swing_count: 602 } });
    });

    it('propagates unexpected primitive adapter errors without starting arithmetic fallback', () => {
        const candidate = config();
        prepareOrdinaryRun(candidate);
        const unexpected = new Error('unexpected adapter failure');
        mocks.verifiedPrimitiveGroupedClock.mockImplementation(() => { throw unexpected; });

        expect(() => generateClockWithSwingBackoff(candidate, options)).toThrow(unexpected);
        expect(mocks.verifiedPrimitiveGroupedClock).toHaveBeenCalledTimes(1);
        expect(mocks.planRun).toHaveBeenCalledTimes(1);
        expect(mocks.checkedClock).not.toHaveBeenCalled();
    });

    it('does not invoke primitive bootstrap for an in-budget first result', () => {
        const candidate = config();
        mocks.planRun.mockImplementation((next: Config) => preparedPlan(next));
        mocks.clockOfPlan.mockReturnValue({ windows: new Map() });
        mocks.checkedClock.mockImplementation((plan: PlanRun) => result(plan.config.overrides?.terminal_swing_count ?? 3, true));

        const generated = generateClockWithSwingBackoff(candidate, options);

        expect(generated.stability_check.holds).toBe(true);
        expect(mocks.verifiedPrimitiveGroupedClock).not.toHaveBeenCalled();
    });

    it('does not invoke primitive bootstrap from a custom generator', () => {
        const candidate = config();
        const refusal = refusalFor(candidate);
        const custom = vi.fn((next: Config) => {
            if (next.overrides?.terminal_swing_count === undefined) throw refusal;
            return result(next.overrides.terminal_swing_count, true);
        });

        expect(generateClockWithSwingBackoff(candidate, options, custom).stability_check.holds).toBe(true);
        expect(custom.mock.calls.map(([next]) => next.overrides?.terminal_swing_count)).toEqual([undefined, 550]);
        expect(mocks.verifiedPrimitiveGroupedClock).not.toHaveBeenCalled();
    });

    it.each([
        ['explicit count', () => config({ terminal_swing_count: 602 })],
        ['fractional swings', () => config({ use_fractional_swings: true })],
        ['destroyed target', () => config(undefined, 'destroyed')],
    ] as const)('does not bootstrap the %s path', (_name, makeConfig) => {
        const candidate = makeConfig();
        const refusal = refusalFor(candidate);
        mocks.planRun.mockImplementation(() => { throw refusal; });

        expect(() => generateClockWithSwingBackoff(candidate, options)).toThrow(refusal);
        expect(mocks.verifiedPrimitiveGroupedClock).not.toHaveBeenCalled();
        expect(mocks.planRun).toHaveBeenCalledTimes(1);
    });

    it('does not bootstrap with a manual LCM', () => {
        const candidate = config({ lcm: 11 });
        prepareOrdinaryRun(candidate);
        mocks.checkedClock.mockImplementation((plan: PlanRun) => result(plan.config.overrides?.terminal_swing_count ?? 602, true));
        expect(primitiveGroupedOptionsSupported(candidate, options)).toBe(false);

        try { generateClockWithSwingBackoff(candidate, options); }
        catch (error) { expect(error).toBeInstanceOf(ClockPeriodLimitError); }

        expect(mocks.verifiedPrimitiveGroupedClock).not.toHaveBeenCalled();
    });

    it.each([
        ['shared-only request', () => config(), { ...options, shared_windows: true }],
        ['derived windows', () => config({ derive_clock_windows: true }), options],
        ['disabled belt slack', () => config(), { ...options, belt_pickup_slack: 'never' as const }],
        ['fuel hand room', () => config(), { ...options, fuel_hand_room: true }],
    ] as const)('does not bootstrap with %s', (_name, makeConfig, actualOptions) => {
        const candidate = makeConfig();
        prepareOrdinaryRun(candidate);
        mocks.checkedClock.mockImplementation((plan: PlanRun) => result(plan.config.overrides?.terminal_swing_count ?? 602, true));
        expect(primitiveGroupedOptionsSupported(candidate, actualOptions)).toBe(false);
        if (actualOptions.shared_windows === true) mocks.groupedHandsClock.mockReturnValue(result(550, true));

        const generated = generateClockWithSwingBackoff(candidate, actualOptions);

        expect(generated.stability_check.holds).toBe(true);
        expect(mocks.verifiedPrimitiveGroupedClock).not.toHaveBeenCalled();
        if (candidate.overrides?.derive_clock_windows === true) {
            expect(mocks.observedWindowsClock).toHaveBeenCalledTimes(1);
            expect(mocks.planRun).not.toHaveBeenCalled();
        } else {
            expect(mocks.planRun.mock.calls[0][0]).toBe(candidate);
            expect(mocks.planRun).toHaveBeenCalledTimes(2);
        }
    });
});
