import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import type { Config } from "../config";
import { planClockAlternatives } from "./alternatives";
import * as generation from "./generate-clock";
import * as trial from "./trial";
import type { BlueprintGenerationResult } from "./plan/plan-run";

const quiet = { log() {}, warn() {}, error() {}, debug() {} };
const recovered = { survives: true, broken_by: [], recovered_after_periods: 0 };
const options = { logger: quiet, verify_as_built: true, factorio_states: false, fuel_consumption_view: false, modulo_blueprint: false };

describe("primitive primary integration and legacy sibling compatibility", () => {
    let config: Config, base: BlueprintGenerationResult;
    beforeAll(async () => {
        config = await loadConfigFromFile(ConfigPaths.STONE_BRICKS_DIRECT_INSERT);
        // A small in-budget clock supplies real export/result structure; candidate selection below is isolated by spies.
        base = generation.generateClockForConfig({ ...config, overrides: { ...config.overrides, terminal_swing_count: 1, lcm: 1 } }, options);
    });
    afterEach(() => vi.restoreAllMocks());

    it("does not spawn shared bootstrap, preserves grouped metadata and uses derived count in later tasks", () => {
        const result: BlueprintGenerationResult = { ...base, used_terminal_swing_count: 2, grouped_hands: { shared_windows: false },
            primitive_grouped: { strategy: "primitive-grouped", trigger: "initial-period-limit", requested_terminal_swing_count: 602,
                terminal_swing_count: 1, grouped_cycles: 1, construction_key: "test composition", loop_refinement: false,
                options: { share_windows: false, feeder_offset: 1, surplus_guard: false } } };
        const signature = trial.clockVerificationSignature(config, result);
        result.primitive_grouped!.verification = { signature, backpressure_loss: recovered, start_dependence: null };
        const generate = vi.spyOn(generation, "generateClockWithSwingBackoff").mockReturnValue(result);
        const recovery = vi.spyOn(trial, "backpressureLossVerdictOf").mockImplementation(() => { throw new Error("completed recovery should be reused"); });
        const plan = planClockAlternatives(config, options);
        expect(generate).toHaveBeenCalledOnce();
        expect(recovery).not.toHaveBeenCalled();
        expect(plan.context).toMatchObject({ swings: 1, planned_swings: 1 });
        expect(plan.context.secondary_planning).toEqual({ source: "primitive-primary", terminal_swing_count: 1 });
        expect(structuredClone(plan.context)).toEqual(JSON.parse(JSON.stringify(plan.context)));
        expect(plan.primary?.alternatives[0].label).toContain("Small batches");
        expect(plan.primary?.alternatives[0].result.grouped_hands).toEqual({ shared_windows: false });
        expect(plan.primary?.alternatives[0].assessment.backpressure_loss?.survives).toBe(true);
    });

    it("still invokes the automatic shared callback for an ordinary grouped result", () => {
        const generate = vi.spyOn(generation, "generateClockWithSwingBackoff").mockImplementation((_config, requested) => ({
            ...base, grouped_hands: { shared_windows: requested?.shared_windows === true } }));
        vi.spyOn(trial, "backpressureLossVerdictOf").mockReturnValue({ backpressure_loss: recovered });
        const plan = planClockAlternatives(config, options);
        expect(plan.context).not.toHaveProperty("secondary_planning");
        expect(generate.mock.calls.some(call => call[1]?.shared_windows === true)).toBe(true);
    });

    it("offers Small batches where the primary did not try it only as a fallback: it never re-counts the other alternatives", () => {
        vi.spyOn(generation, "generateClockWithSwingBackoff").mockReturnValue(base);
        vi.spyOn(trial, "backpressureLossVerdictOf").mockReturnValue({ backpressure_loss: recovered });
        const plan = planClockAlternatives(config, options);
        expect(plan.context).not.toHaveProperty("secondary_planning");
        expect(plan.context).not.toHaveProperty("primitive_tried");
        expect(plan.tasks.find(task => task.id === "primitive-grouped")).toEqual({ id: "primitive-grouped", label: "Small batches", only_when_needed: true, fallback: true });
    });

    it("does not offer Small batches again where the primary tried it", () => {
        const report = { strategy: "primitive-grouped" as const, eligibility: "separate-windows-only" as const, outcome: "failed" as const, attempts: [] };
        const attempt = { terminal_swing_count: 1, holds: false, actual_output_items: 0, expected_output_items: 1 };
        vi.spyOn(generation, "generateClockWithSwingBackoff").mockReturnValue({ ...base, swing_backoff_report: { triggered: false,
            initial_terminal_swing_count: 1, initial_attempt: attempt, stable_terminal_swing_count: null, attempts: [], primitive_grouped_attempt: report } });
        vi.spyOn(trial, "backpressureLossVerdictOf").mockReturnValue({ backpressure_loss: recovered });
        const plan = planClockAlternatives(config, options);
        expect(plan.context.primitive_tried).toBe(true);
        expect(plan.tasks.some(task => task.id === "primitive-grouped")).toBe(false);
    });
});
