import { beforeAll, describe, expect, it } from "vitest";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import type { Config } from "../config";
import { Duration } from "../data-types";
import type { BlueprintGenerationResult } from "./plan/plan-run";
import { constructPrimitiveGroupedHands } from "./candidates/primitive-grouped-hands";
import { backpressureLossVerdictOf, clockVerificationSignature, startDependenceVerdictOf } from "./trial";
import { withRunMemo } from "./plan/run-memo";

const quiet = { log() {}, warn() {}, error() {}, debug() {} };

describe("verification policy compatibility", () => {
    let config: Config, result: BlueprintGenerationResult;
    beforeAll(async () => {
        const control = await loadConfigFromFile(ConfigPaths.REAL_OWNER_PINK_SCIENCE_ORIGINAL);
        config = { ...control, overrides: undefined, inserters: control.inserters.map(inserter => ({ ...inserter, overrides: undefined })) };
        const artifact = constructPrimitiveGroupedHands(config);
        const attempt = artifact.attempts.find(attempt => attempt.result.kind === "constructed" && !attempt.options.share_windows)!;
        if (attempt.result.kind !== "constructed") throw new Error("expected construction");
        result = { clock_windows: attempt.result.control_windows, simulation_duration: Duration.ofTicks(40),
            used_terminal_swing_count: 2, crafting_cycle_plan: { total_duration: Duration.ofTicks(40) },
            stability_check: { expected_output_items: 32 }, primitive_grouped: { strategy: "primitive-grouped", trigger: "initial-period-limit",
                terminal_swing_count: 1, grouped_cycles: 1, requested_terminal_swing_count: 602 } } as unknown as BlueprintGenerationResult;
    });

    it("uses identical physical verification identity from original AUTO and the derived policy clone", () => {
        const clone = { ...config, overrides: { terminal_swing_count: 1, lcm: 1 } };
        expect(clockVerificationSignature(config, result)).toBe(clockVerificationSignature(clone, result));
        const old = { ...result, primitive_grouped: undefined };
        expect(clockVerificationSignature(config, old)).not.toBe(clockVerificationSignature(config, result));
        expect(result.used_terminal_swing_count).toBe(2);
        expect(config.overrides).toBeUndefined();
    });

    it("strict recovery propagates a cancellation before simulation; legacy default still reports unavailable", () => {
        const cancelled = new Error("cancel recovery");
        const report = () => { throw cancelled; };
        expect(() => backpressureLossVerdictOf(config, result, quiet, report, "throw")).toThrow(cancelled);
        expect(backpressureLossVerdictOf(config, result, quiet, report)).toEqual({ backpressure_loss: null, backpressure_loss_not_tried: cancelled.message });
    });

    it("a memoized legacy unavailable verdict cannot hide a strict cancellation", () => withRunMemo(() => {
        const cancelled = new Error("cancel memoized recovery");
        const report = () => { throw cancelled; };
        expect(backpressureLossVerdictOf(config, result, quiet, report).backpressure_loss).toBeNull();
        expect(() => backpressureLossVerdictOf(config, result, quiet, report, "throw")).toThrow(cancelled);
    }));

    it("strict requested starts propagate cancellation; legacy default remains null", () => {
        const cancelled = new Error("cancel requested starts");
        const report = () => { throw cancelled; };
        expect(() => startDependenceVerdictOf(config, result, true, quiet, report, "throw")).toThrow(cancelled);
        expect(startDependenceVerdictOf(config, result, true, quiet, report)).toBeNull();
    });
});
