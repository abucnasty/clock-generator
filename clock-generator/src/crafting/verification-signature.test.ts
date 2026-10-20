import {afterEach, beforeAll, describe, expect, it, vi} from "vitest";
import {ConfigPaths} from "../config/config-paths";
import {loadConfigFromFile} from "../config/loader";
import type {Config} from "../config";
import {generateClockForConfig} from "./generate-clock";
import {generateClockAlternatives, planClockAlternatives, runClockAlternativeTask} from "./alternatives";
import {quiet} from "./generate-blueprint-test-helpers";
import * as trial from "./trial";

const options = {logger: quiet, verify_as_built: false, fuel_consumption_view: false, factorio_states: false, modulo_blueprint: false};
const signature = trial.clockVerificationSignature;
let config: Config;
let result: ReturnType<typeof generateClockForConfig>;
beforeAll(async () => {
    config = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE);
    result = generateClockForConfig(config, options);
});
afterEach(() => vi.restoreAllMocks());

describe("candidate verification identity", () => {
    it("ignores object insertion order, preserves inputs, and shares clocks reached through fractional planning", () => {
        const before = JSON.stringify({config, result});
        const reordered = {...result, clock_windows: Object.fromEntries(Object.entries(result.clock_windows).reverse())};
        expect(signature(config, reordered)).toBe(signature(config, result));
        expect(signature({...config, overrides: {...config.overrides, use_fractional_swings: true}}, reordered))
            .toBe(signature(config, result));
        expect(JSON.stringify({config, result})).toBe(before);
    });

    it.each(["supply", "speed", "geometry", "seed", "entity order", "start checks"])("keeps %s differences separate", difference => {
        const changed = structuredClone(config);
        if (difference === "supply") changed.overrides = {...changed.overrides, backed_up_belts: true};
        if (difference === "speed") changed.belts[0].type = "express-transport-belt";
        if (difference === "geometry" && changed.inserters[0].source.type === "belt") {
            changed.inserters[0].source.pickup_length = 0.5;
            changed.inserters[0].source.pickup_layout = "side-entrance";
        }
        if (difference === "seed") changed.overrides = {...changed.overrides, loop_seed_items: 17};
        if (difference === "entity order") changed.inserters.reverse();
        if (difference === "start checks") changed.overrides = {...changed.overrides, check_start_dependence: true};
        expect(signature(changed, result)).not.toBe(signature(config, result));
    });

    it("keeps timing, expected output, own clocks and failing witnesses separate", () => {
        const original = signature(config, result);
        expect(signature(config, {...result, clock_windows: {...result.clock_windows,
            "inserter:1": [{start: 0, end: 1}]}})).not.toBe(original);
        expect(signature(config, {...result, stability_check: {...result.stability_check,
            expected_output_items: result.stability_check.expected_output_items + 1}})).not.toBe(original);
        expect(signature(config, {...result, unplanned_inserter_clocks: {"inserter:1": {
            kind: "fuel", modulus: 19, own_clock: true, window: {start: 0, end: 1}}}})).not.toBe(original);
        expect(signature(config, {...result, belt_pickup_slack_left_out: !result.belt_pickup_slack_left_out})).not.toBe(original);
        expect(signature(config, {...result, stability_check: {...result.stability_check,
            as_built: {holds: false, actual_output_items: 0, start_phases_checked: 2, failed_start_offset: 17}}})).not.toBe(original);
        const check = {holds: false, actual_output_items: 0, start_phases_checked: 1};
        expect(signature(config, {...result, stability_check: {...result.stability_check,
            as_built: {...check, failed_pickup_phases: {"inserter:1": [0, 4]}}}}))
            .not.toBe(signature(config, {...result, stability_check: {...result.stability_check,
                as_built: {...check, failed_pickup_phases: {"inserter:1": [4, 0]}}}}));
    });

    it("does not equate fractional AUTO fuel controls with whole-swing controls", async () => {
        const fuel = await loadConfigFromFile(ConfigPaths.BIOCHAMBER_FUEL);
        const built = generateClockForConfig(fuel, options);
        expect(Object.values(built.unplanned_inserter_clocks ?? {}).some(clock => clock.own_clock)).toBe(true);
        expect(signature({...fuel, overrides: {...fuel.overrides, use_fractional_swings: true}}, built))
            .not.toBe(signature(fuel, built));
        const fractional_count = {...result, used_terminal_swing_count: 1.5};
        expect(signature({...config, overrides: {...config.overrides, use_fractional_swings: true}}, fractional_count))
            .not.toBe(signature(config, fractional_count));
    });
});

describe("request-local duplicate verification", () => {
    it("shares requested sampled-start assessments along with recovery", async () => {
        const logistic = await loadConfigFromFile(ConfigPaths.LOGISTIC_SCIENCE);
        const starts = vi.spyOn(trial, "startDependenceVerdictOf");
        const generated = generateClockAlternatives({...logistic,
            overrides: {...logistic.overrides, check_start_dependence: true}}, {logger: quiet});
        const keys = starts.mock.calls.map(([config, result]) => signature(config, result));
        expect(keys.length).toBeGreaterThan(1);
        expect(new Set(keys).size).toBe(keys.length);
        expect(generated.alternatives.every(clock => clock.assessment.start_dependence !== null)).toBe(true);
    });
    it("assesses a matching primary only once and still supplies a valid run for dependency checks", async () => {
        const logistic = await loadConfigFromFile(ConfigPaths.LOGISTIC_SCIENCE);
        const recovery = vi.spyOn(trial, "backpressureLossVerdictOf");
        const generated = generateClockAlternatives(logistic, {logger: quiet});
        const keys = recovery.mock.calls.map(([config, result]) => signature(config, result));
        expect(keys.length).toBeGreaterThan(1);
        expect(new Set(keys).size).toBe(keys.length);
        // swings-2 since belt windows close before their last return swing (fewest wake-ups of the stable clocks)
        expect(generated.alternatives[generated.selected_index].id).toBe("swings-2");
        // A later request must make its own checks, rather than inherit a verdict from this generation.
        const first_count = recovery.mock.calls.length;
        generateClockAlternatives(logistic, {logger: quiet});
        expect(recovery.mock.calls.length).toBe(first_count * 2);
    });

    it("lets the worker API skip recovery of a matching primary without changing its completed assessment", async () => {
        const logistic = await loadConfigFromFile(ConfigPaths.LOGISTIC_SCIENCE);
        const plan = planClockAlternatives(logistic, {logger: quiet});
        const recovery = vi.spyOn(trial, "backpressureLossVerdictOf");
        const duplicate = runClockAlternativeTask(logistic, plan.context, "fractional", {logger: quiet}, [plan.primary!.signature]);
        expect(duplicate).toEqual({signature: plan.primary!.signature, alternatives: []});
        expect(recovery).not.toHaveBeenCalled();
        expect(plan.primary!.alternatives[0].assessment.backpressure_loss).not.toBeNull();
    });
});
