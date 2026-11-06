import type { Config } from "../../config";
import { fraction } from "../../data-types/fraction";
import { CraftingCyclePlan } from "../sequence/cycle/crafting-cycle";
import { EntityTransferCountMap } from "../sequence/cycle/swing-counts";
import { createEntityRegistryFromConfig } from "../sequence/simulation-context";
import { TargetProductionRate } from "../target-production-rate";
import { ArithmeticBatchesFallBehind, ArithmeticWindowsNotApplicable, batchedSwingsWindowsByArithmetic } from "./batched-arithmetic";
import { alwaysEnabledByConfig } from "./plan-run";

/**
 * The output swing estimate: whether the batched-swings clock of a count of output swings a cycle keeps up with its
 * target, from the build's supply, each machine's stock and the length of its output windows, by arithmetic and with
 * no run of the build. The count's cycle is planned as the planning run plans it (CraftingCyclePlan.create, no
 * prepare step), and its windows made by the stock walk (batched-arithmetic.ts): the output takes each cycle's hands
 * in one batch from the cycle's start, lengthened to the hands the walk sees come late.
 *
 * - "keeps up": the walk makes every cycle's hands in the batches.
 * - "falls behind": the output machine does not make a cycle's hands in its batch however often the batch is
 *   lengthened (`ArithmeticBatchesFallBehind`): the machine cannot hold the hands of the count between batches.
 * - "no rule": the arithmetic has no rule for the build at that count (the reason given).
 *
 * It is an estimate of the batched clock the arithmetic makes, not a proof about every clock of the count: the
 * planning run reads its windows off a run of the build, and its clock can be longer at the output than the
 * arithmetic's. Nothing is skipped on it: the swing backoff logs it beside the counts it simulates (the shadow).
 */
export type OutputSwingEstimate =
    | { swings: number; verdict: "keeps up" | "falls behind" }
    | { swings: number; verdict: "no rule"; reason: string };

export function outputSwingEstimate(config: Config, swings: number): OutputSwingEstimate {
    if (!Number.isInteger(swings) || swings < 1) return { swings, verdict: "no rule", reason: `${swings} is no whole count of swings` };
    if (config.target_output.counts === "destroyed") return { swings, verdict: "no rule", reason: "a target that counts an item destroyed" };
    const overrides = { ...config.overrides, terminal_swing_count: swings };
    const counted: Config = { ...config, overrides };
    try {
        const entity_registry = createEntityRegistryFromConfig(counted);
        const target = TargetProductionRate.fromConfig(counted.target_output);
        const crafting_cycle_plan = CraftingCyclePlan.create(target, entity_registry, counted, fraction(swings), overrides);
        const recipe_lcm = EntityTransferCountMap.lcm(crafting_cycle_plan.entity_transfer_map);
        batchedSwingsWindowsByArithmetic({ entity_registry, crafting_cycle_plan, recipe_lcm,
            period_ticks: crafting_cycle_plan.total_duration_ticks.toDecimal() * recipe_lcm,
            always_enabled_by_config: alwaysEnabledByConfig(counted) });
        return { swings, verdict: "keeps up" };
    } catch (error) {
        if (error instanceof ArithmeticBatchesFallBehind) return { swings, verdict: "falls behind" };
        if (error instanceof ArithmeticWindowsNotApplicable) return { swings, verdict: "no rule", reason: error.message };
        // a count the cycle plan refuses (fractional swings, insertion limits) is refused by the planning run the same way
        return { swings, verdict: "no rule", reason: error instanceof Error ? error.message : String(error) };
    }
}

/**
 * The estimated output swings a cycle: the highest count from `from` down to 1 at which the batched clock by
 * arithmetic keeps up, with the estimate of every count above it; null where no count keeps up or one has no rule
 * before one keeps up (the estimate then says nothing about the counts below)
 */
export function estimatedOutputSwings(config: Config, from: number): { swings: number | null; above: OutputSwingEstimate[] } {
    const above: OutputSwingEstimate[] = [];
    for (let swings = from; swings >= 1; swings--) {
        const estimate = outputSwingEstimate(config, swings);
        if (estimate.verdict === "keeps up") return { swings, above };
        above.push(estimate);
        if (estimate.verdict === "no rule") return { swings: null, above };
    }
    return { swings: null, above };
}
