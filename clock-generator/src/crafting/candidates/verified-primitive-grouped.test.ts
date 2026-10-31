import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadConfigFromFile } from "../../config/loader";
import { ConfigPaths } from "../../config/config-paths";
import type { Config } from "../../config";
import { Duration } from "../../data-types";
import { fraction } from "../../data-types/fraction";
import * as planning from "../plan/plan-run";
import * as trial from "../trial";
import { createEntityRegistryFromConfig } from "../sequence/simulation-context";
import { CraftingCyclePlan } from "../sequence/cycle/crafting-cycle";
import { TargetProductionRate } from "../target-production-rate";
import { CLOCK_STARTS } from "../start-dependence";
import { canonicalVerificationJson } from "../verification-signature";
import { verificationPlanningConfigOf, verificationTerminalCountOf } from "../primitive-grouped-policy";
import * as grouped from "./grouped-hands";
import { verifiedPrimitiveGroupedClock } from "./verified-primitive-grouped";

const quiet = { log() {}, warn() {}, error() {}, debug() {} };
const recovered = { survives: true, broken_by: [], recovered_after_periods: 0 };

describe("verified primitive adapter orchestration (verification outcomes are explicit test doubles)", () => {
    let config: Config;
    let made: planning.PlanRun;
    beforeAll(async () => {
        const control = await loadConfigFromFile(ConfigPaths.REAL_OWNER_PINK_SCIENCE_ORIGINAL);
        config = { ...control, overrides: undefined, inserters: control.inserters.map(inserter => ({ ...inserter, overrides: undefined })) };
    });
    afterEach(() => vi.restoreAllMocks());

    function arrange(input = config) {
        const registry = createEntityRegistryFromConfig(input);
        const cycle = CraftingCyclePlan.create(TargetProductionRate.fromConfig(input.target_output), registry, input, fraction(1), input.overrides);
        made = { logger: quiet, config: input, run: { crafting_cycle_plan: cycle, swing_counts: cycle.entity_transfer_map,
            duration: Duration.ofTicks(40), recipe_lcm: 1, simulation_context: { entity_registry: registry } } } as unknown as planning.PlanRun;
        const plan = vi.spyOn(planning, "planRun").mockImplementation(derived => { made.config = derived; return made; });
        const margins = vi.spyOn(grouped, "holdsWithMargin").mockReturnValue(null);
        vi.spyOn(planning, "withRoomForRandomAmounts").mockImplementation((_made, windows) => ({ windows }));
        const finish = vi.spyOn(grouped, "finishedClock").mockImplementation((_made, windows, _turns, _options, left_open, room) => {
            const clocks = Object.fromEntries([...windows].map(([id, ranges]) => [id, ranges.map(range => ({ start: range.start_inclusive, end: range.end_inclusive }))]));
            clocks["inserter:9"] = [{ start: 0, end: 4 }];
            return { used_terminal_swing_count: 2, used_lcm: 1, simulation_duration: Duration.ofTicks(40),
                crafting_cycle_plan: cycle, serializable_transfer_plan: {}, clock_windows: clocks,
                unplanned_inserter_clocks: { "inserter:9": { kind: "by-product", modulus: 40, own_clock: false, window: { start: 0, end: 4 } } },
                stability_check: { holds: true, actual_output_items: 32, expected_output_items: 32,
                    as_built: { holds: true, start_phases_checked: 12, long_run_proven: false, wake_ups: { wake_ups_per_minute: 10 } } },
                always_on_reasons: Object.fromEntries(left_open), random_margins: room?.random_margins,
            } as unknown as planning.BlueprintGenerationResult;
        });
        const recovery = vi.spyOn(trial, "backpressureLossVerdictOf").mockReturnValue({ backpressure_loss: recovered });
        const starts = vi.spyOn(trial, "startDependenceVerdictOf").mockReturnValue({ verdict: "stable", expected_output_items: 32,
            starts: CLOCK_STARTS.map(start => ({ id: start.id, reaches_target: true })) } as trial.ClockAssessment["start_dependence"]);
        const signature = vi.spyOn(trial, "clockVerificationSignature").mockImplementation((on, result) => canonicalVerificationJson({
            on: verificationPlanningConfigOf(on, result), windows: result.clock_windows }));
        return { plan, margins, finish, recovery, starts, signature };
    }

    it("keeps AUTO input immutable, derives one real planning context and retains every actual control", () => {
        const spies = arrange();
        const before = JSON.stringify(config);
        const result = verifiedPrimitiveGroupedClock(config, { verify_as_built: true, logger: quiet }, 602);
        expect(result.clock?.primitive_grouped).toMatchObject({ strategy: "primitive-grouped", terminal_swing_count: 1,
            requested_terminal_swing_count: 602, grouped_cycles: 1, options: { share_windows: false } });
        expect(result.clock?.used_terminal_swing_count).toBe(2);
        expect(result.report.outcome).toBe("accepted");
        expect(spies.plan).toHaveBeenCalledOnce();
        expect(spies.plan.mock.calls[0][0].overrides).toEqual({ terminal_swing_count: 1, lcm: 1 });
        expect(JSON.stringify(config)).toBe(before);
        for (const call of spies.margins.mock.calls) {
            expect(call[1].has("inserter:9")).toBe(false); // computed overlay is composed by runClockOnBuild
            expect(call[1].has("inserter:11")).toBe(true); // mixed ingredients share one real arm
            expect(call[1].get("inserter:11")!.reduce((n, range) => n + range.end_inclusive - range.start_inclusive + 1, 0)).toBe(28);
        }
        expect(result.clock?.clock_windows["inserter:9"]).toEqual([{ start: 0, end: 4 }]);
        expect(Object.keys(result.clock!.clock_windows)).toHaveLength(12);
        expect(spies.recovery.mock.calls.every(call => call[4] === "throw")).toBe(true);
        expect(spies.starts).not.toHaveBeenCalled();
    });

    it.each([false, null, "incomplete"] as const)("declines unsuccessful/unknown recovery %s rather than calling it stable", outcome => {
        const spies = arrange();
        spies.recovery.mockReturnValue({ backpressure_loss: outcome === null ? null : { ...recovered,
            survives: outcome !== false, ...(outcome === "incomplete" ? { not_tried: ["input"] } : {}) } });
        const result = verifiedPrimitiveGroupedClock(config, { verify_as_built: true, logger: quiet }, 602);
        expect(result.clock).toBeNull();
        expect(result.report.attempts.every(attempt => attempt.stage === "recovery")).toBe(true);
    });

    it.each([null, "failed", "missing"] as const)("requires all explicitly requested starts: %s", outcome => {
        const input = { ...config, overrides: { check_start_dependence: true } };
        const spies = arrange(input);
        spies.starts.mockReturnValue(outcome === null ? null : { verdict: outcome === "failed" ? "start-dependent" : "stable", expected_output_items: 32,
            starts: CLOCK_STARTS.slice(outcome === "missing" ? 1 : 0).map(start => ({ id: start.id, reaches_target: outcome !== "failed" })) } as trial.ClockAssessment["start_dependence"]);
        expect(verifiedPrimitiveGroupedClock(input, { verify_as_built: true, logger: quiet }, 602).clock).toBeNull();
        expect(spies.starts.mock.calls.every(call => call[5] === "throw")).toBe(true);
    });

    it("does not convert unexpected verification errors into a declined candidate", () => {
        const spies = arrange();
        const cancelled = new Error("cancelled by caller");
        spies.recovery.mockImplementation(() => { throw cancelled; });
        expect(() => verifiedPrimitiveGroupedClock(config, { verify_as_built: true, logger: quiet }, 602)).toThrow(cancelled);
    });

    it("rejects changed exported controls instead of blessing planning-history windows", () => {
        const spies = arrange();
        const normal = spies.finish.getMockImplementation()!;
        spies.finish.mockImplementation((...args) => { const result = normal(...args); delete result.clock_windows["inserter:9"]; return result; });
        expect(() => verifiedPrimitiveGroupedClock(config, { verify_as_built: true, logger: quiet }, 602)).toThrow("primitive exported controls changed");
    });
});

describe("derived verification count is additive", () => {
    it("uses the new planner unit and cycles while preserving the old aggregate and caller config", () => {
        const config = { overrides: { check_start_dependence: true } } as Config;
        const result = { used_terminal_swing_count: 2, primitive_grouped: { terminal_swing_count: 1, grouped_cycles: 1 } } as planning.BlueprintGenerationResult;
        expect(verificationTerminalCountOf(result)).toBe(1);
        expect(verificationPlanningConfigOf(config, result).overrides).toEqual({ check_start_dependence: true, terminal_swing_count: 1, lcm: 1 });
        expect(result.used_terminal_swing_count).toBe(2);
        expect(config.overrides).toEqual({ check_start_dependence: true });
        expect(verificationTerminalCountOf({ used_terminal_swing_count: 604 })).toBe(604);
    });
});
