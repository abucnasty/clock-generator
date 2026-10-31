/**
 * What the build plan's tests share: a sample's plan as a generation would make it, with the cycle arithmetic of its
 * planning run (one prepare step on the config with fractional swings on and one with them off, as validateConfig
 * makes it), and the validation of the config that the plan's periods are held to.
 */
import type { Config } from "../../config/schema";
import { loadConfigFromFile } from "../../config/loader";
import type { BuildPlan } from "../../data-types/build-plan";
import type Fraction from "../../data-types/fraction";
import { toPlannerFacts } from "../facts/to-planner-facts";
import { feasibilityOf, type Feasibility } from "../feasibility/assert-feasible";
import { plannerGraphOf } from "../graph/build-graph";
import { maxSwingsOfPreparedBuild } from "../plan/plan-run";
import { ConfigValidation, validateConfig } from "../plan/validate-config";
import { PrepareStep } from "../runner/steps/prepare-step";
import { createEntityRegistryFromConfig, SimulationContext } from "../sequence/simulation-context";
import { planBuild } from "./plan-build";

const quiet = { log() { }, info() { }, warn() { }, error() { }, debug() { } };

/** The output swings a cycle the prepare step finds on the config with fractional swings on or off */
export function maxSwingsOf(config: Config, fractional: boolean): Fraction {
    const variant: Config = (config.overrides?.use_fractional_swings === true) === fractional ? config
        : { ...config, overrides: { ...config.overrides, use_fractional_swings: fractional } };
    const context = SimulationContext.fromConfig(variant);
    new PrepareStep(context).execute();
    return maxSwingsOfPreparedBuild(variant, context, quiet);
}

export interface PlannedSample {
    readonly config: Config;
    readonly feasibility: Feasibility;
    readonly plan: BuildPlan;
    /** What validating the config finds (its planning run's period); null where it is refused */
    readonly validation: ConfigValidation | null;
}

/** The plan of a config; without a cycle where validating it fails (a refused config) */
export function planOfConfig(config: Config): PlannedSample {
    const facts = toPlannerFacts(config);
    const graph = plannerGraphOf(facts);
    const feasibility = feasibilityOf(facts, graph);
    let validation: ConfigValidation | null = null;
    try {
        validation = validateConfig(config, { logger: quiet });
    } catch {
        validation = null;
    }
    const memo = new Map<boolean, Fraction>();
    const max_swings = (fractional: boolean) => {
        if (!memo.has(fractional)) memo.set(fractional, maxSwingsOf(config, fractional));
        return memo.get(fractional)!;
    };
    const cycle = validation === null ? null : {
        config,
        registry: createEntityRegistryFromConfig(config),
        max_swings: config.target_output.counts === "destroyed" ? null : max_swings,
    };
    return { config, feasibility, plan: planBuild(facts, graph, feasibility, cycle), validation };
}

export async function planOfSample(file: string): Promise<PlannedSample> {
    return planOfConfig(await loadConfigFromFile(file) as Config);
}
