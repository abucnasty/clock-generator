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
        expect(plan.primary?.alternatives[0].label).toContain("Primitive grouped hands");
        expect(plan.primary?.alternatives[0].result.grouped_hands).toEqual({ shared_windows: false });
        expect(plan.primary?.alternatives[0].assessment.backpressure_loss?.survives).toBe(true);
    });

    it("still invokes the automatic shared callback for an ordinary grouped result", () => {
        const generate = vi.spyOn(generation, "generateClockWithSwingBackoff").mockImplementation((_config, requested) => ({
            ...base, grouped_hands: { shared_windows: requested?.shared_windows === true } }));
        vi.spyOn(trial, "backpressureLossVerdictOf").mockReturnValue({ backpressure_loss: recovered });
        planClockAlternatives(config, options);
        expect(generate.mock.calls.some(call => call[1]?.shared_windows === true)).toBe(true);
    });
});
