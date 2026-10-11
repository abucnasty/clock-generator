import { Config } from "../config";
import { observedWindowsClock } from "./candidates/observed-windows";
import { BlueprintGenerationResult, GenerateClockOptions, checkedClock, clockOfPlan, planRun } from "./plan/plan-run";

/**
 * Generates a clock from a configuration: the planning run (`planRun`), the clock of the plan with its room
 * (`clockOfPlan`), and the clock-only check and export (`checkedClock`). The config override `derive_clock_windows`
 * makes the observed windows candidate instead, keeping the planned windows where they pass.
 *
 * @param config The configuration for the simulation
 * @param options Optional generation options (debug, logger, the clock-only check, belt pickup slack, …)
 * @returns The generated blueprint and related metadata
 */
export function generateClockForConfig(
    config: Config,
    options: GenerateClockOptions = {}
): BlueprintGenerationResult {
    if (config.overrides?.derive_clock_windows) {
        return observedWindowsClock(config, options, "prefer_planned");
    }
    const plan = planRun(config, options);
    const clock = clockOfPlan(plan, options);
    return checkedClock(plan, clock, clock.windows, options);
}
