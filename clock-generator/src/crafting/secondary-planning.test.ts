import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import type { Config } from "../config";
import { fraction } from "../data-types/fraction";
import { runClockAlternativeTask } from "./alternatives";
import * as generation from "./generate-clock";
import { SecondaryPlanningInvariantError, secondaryPlanningCountOf, verificationPlanningConfigOf, verificationTerminalCountOf, withSecondaryPlanningProvenance } from "./primitive-grouped-policy";
import type { BlueprintGenerationResult } from "./plan/plan-run";
import { createEntityRegistryFromConfig } from "./sequence/simulation-context";
import { CraftingCyclePlan, plannedTerminalSwingCount } from "./sequence/cycle/crafting-cycle";
import { TargetProductionRate } from "./target-production-rate";
import * as trial from "./trial";

const quiet = { log() {}, warn() {}, error() {}, debug() {} };
const options = { logger: quiet, verify_as_built: true, factorio_states: false, fuel_consumption_view: false, modulo_blueprint: false };
const policy = { source: "primitive-primary" as const, terminal_swing_count: 1 };

describe("count-only secondary planning provenance", () => {
    let config: Config;
    let base: BlueprintGenerationResult;

    beforeAll(async () => {
        config = await loadConfigFromFile(ConfigPaths.STONE_BRICKS_DIRECT_INSERT);
        base = generation.generateClockForConfig(config, options);
    });

    afterEach(() => vi.restoreAllMocks());

    it("keeps the count-only policy serializable and ignores stale policy when the caller opted out", () => {
        const context = { secondary_planning: policy };
        const untouched = structuredClone(config);
        expect(JSON.parse(JSON.stringify(context))).toEqual(context);
        expect(structuredClone(context)).toEqual(context);
        expect(secondaryPlanningCountOf(config, context)).toEqual(policy);

        const explicitCount = { ...config, overrides: { ...config.overrides, terminal_swing_count: 2 } };
        const explicitLcm = { ...config, overrides: { ...config.overrides, lcm: 3 } };
        const fractional = { ...config, overrides: { ...config.overrides, use_fractional_swings: true } };
        const destroyed = { ...config, target_output: { ...config.target_output, counts: "destroyed" as const } };
        for (const optedOut of [explicitCount, explicitLcm, fractional, destroyed]) {
            expect(secondaryPlanningCountOf(optedOut, context)).toBeUndefined();
        }
        expect(config).toEqual(untouched);
    });

    it("types invalid secondary provenance and malformed derived context as invariants", () => {
        const missingPlan = { ...base, crafting_cycle_plan: {} as BlueprintGenerationResult["crafting_cycle_plan"] };
        const badLcm = { ...base, used_lcm: Number.NaN };
        const borrowed = { ...base, primitive_grouped: { strategy: "primitive-grouped" as const,
            trigger: "initial-period-limit" as const, requested_terminal_swing_count: 602, terminal_swing_count: 1,
            grouped_cycles: 1, construction_key: "primary", loop_refinement: false as const,
            options: { share_windows: false as const, feeder_offset: 1, surplus_guard: false } } };
        for (const invalid of [missingPlan, badLcm, borrowed]) {
            expect(() => withSecondaryPlanningProvenance(invalid)).toThrow(SecondaryPlanningInvariantError);
        }
        expect(() => secondaryPlanningCountOf(config, { secondary_planning: { source: "primitive-primary", terminal_swing_count: 0 } }))
            .toThrow(SecondaryPlanningInvariantError);
    });

    it("propagates a missing actual plan through the public task boundary instead of reporting an ordinary refusal", () => {
        const context = { secondary_planning: policy, swings: 1, planned_swings: 1, primary_stable: true, period_ticks: 40 };
        const malformed = { ...base, crafting_cycle_plan: {} as BlueprintGenerationResult["crafting_cycle_plan"] };
        vi.spyOn(generation, "generateClockWithSwingBackoff").mockReturnValue(malformed);
        const notMade = vi.fn();

        expect(() => runClockAlternativeTask(config, context, "fractional", { ...options, on_not_made: notMade }))
            .toThrow(SecondaryPlanningInvariantError);
        expect(notMade).not.toHaveBeenCalled();
    });

    it("applies the derived count to default alternatives while preserving the fractional toggle", () => {
        const untouched = structuredClone(config);
        const context = { secondary_planning: policy, swings: 1, planned_swings: 1, primary_stable: true, period_ticks: 40 };
        const generated = vi.spyOn(generation, "generateClockWithSwingBackoff").mockReturnValue(base);
        vi.spyOn(trial, "backpressureLossVerdictOf").mockReturnValue({ backpressure_loss: { survives: true, broken_by: [], recovered_after_periods: 0 } });

        runClockAlternativeTask(config, context, "fractional", options);

        expect(generated).toHaveBeenCalledOnce();
        const [planned] = generated.mock.calls[0];
        expect(planned.overrides?.terminal_swing_count).toBe(1);
        expect(planned.overrides?.lcm).toBeUndefined();
        expect(planned.overrides?.use_fractional_swings).toBe(true);
        expect(config).toEqual(untouched);
    });

    it("uses each higher family's actual WeakMap plan count and LCM, not the primitive count or aggregate alias", () => {
        const registry = createEntityRegistryFromConfig(config);
        const target = TargetProductionRate.fromConfig(config.target_output);
        const actualResult = (count: number, legacyAggregate: number, lcm: number): BlueprintGenerationResult => {
            const plan = CraftingCyclePlan.create(target, registry, config, fraction(count), config.overrides ?? {});
            return { ...base, crafting_cycle_plan: plan, used_terminal_swing_count: legacyAggregate, used_lcm: lcm,
                primitive_grouped: undefined, secondary_planning: undefined };
        };
        const two = actualResult(2, 4, 605);
        const three = actualResult(3, 6, 121);
        expect(plannedTerminalSwingCount(two.crafting_cycle_plan)).toBe(2);

        const untouched = structuredClone(config);
        const context = { secondary_planning: { ...policy, terminal_swing_count: 2 }, swings: 1, planned_swings: 1,
            primary_stable: true, period_ticks: 40 };
        const generate = vi.spyOn(generation, "generateClockForConfig").mockImplementation(candidate =>
            candidate.overrides?.terminal_swing_count === 3 ? three : two);
        vi.spyOn(trial, "backpressureLossVerdictOf").mockReturnValue({ backpressure_loss: { survives: true, broken_by: [], recovered_after_periods: 0 } });

        const twoRun = runClockAlternativeTask(config, context, "swings-2", options)!;
        const threeRun = runClockAlternativeTask(config, context, "swings-3", options)!;
        expect(generate.mock.calls.map(([candidate]) => candidate.overrides?.terminal_swing_count)).toEqual([2, 3]);

        const secondaryTwo = twoRun.alternatives[0].result;
        const secondaryThree = threeRun.alternatives[0].result;
        expect(secondaryTwo.used_terminal_swing_count).toBe(4);
        expect(secondaryTwo.secondary_planning).toEqual({ source: "primitive-primary", terminal_swing_count: 2, effective_lcm: 605 });
        expect(verificationTerminalCountOf(secondaryTwo)).toBe(2);
        expect(verificationPlanningConfigOf(config, secondaryTwo).overrides).toMatchObject({ terminal_swing_count: 2, lcm: 605 });
        expect(secondaryThree.secondary_planning).toEqual({ source: "primitive-primary", terminal_swing_count: 3, effective_lcm: 121 });
        expect(secondaryThree.primitive_grouped).toBeUndefined();

        const primitive = { ...two, primitive_grouped: { strategy: "primitive-grouped" as const, trigger: "initial-period-limit" as const,
            requested_terminal_swing_count: 602, terminal_swing_count: 2, grouped_cycles: 1, construction_key: "primary",
            loop_refinement: false as const, options: { share_windows: false as const, feeder_offset: 1, surplus_guard: false } } };
        expect(verificationTerminalCountOf(primitive)).toBe(2);
        expect(verificationPlanningConfigOf(config, primitive).overrides).toMatchObject({ terminal_swing_count: 2, lcm: 1 });
        expect(verificationPlanningConfigOf(config, secondaryTwo).overrides?.lcm).not.toBe(1);
        expect(() => withSecondaryPlanningProvenance(primitive)).toThrow(/cannot borrow primitive verification/);
        expect(config).toEqual(untouched);
    });
});
