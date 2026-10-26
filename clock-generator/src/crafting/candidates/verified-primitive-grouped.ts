import assert from "../../common/assert";
import { defaultLogger } from "../../common/logger";
import type { Config } from "../../config";
import { OpenRange } from "../../data-types";
import { Entity } from "../../entities";
import type { AlwaysOnReason } from "../always-on-reasons";
import { ClockPeriodLimitError } from "../plan/clock-period-limit";
import { planRun, withInserterClocks, withRoomForRandomAmounts, type BlueprintGenerationResult, type GenerateClockOptions } from "../plan/plan-run";
import type { PrimitiveGroupedAttemptReport, PrimitiveGroupedPolicy } from "../primitive-grouped-policy";
import { plannedTerminalSwingCount } from "../sequence/cycle/crafting-cycle";
import { EntityTransferCountMap, outputPathOf } from "../sequence/cycle/swing-counts";
import { unplannedInserterClocks } from "../sequence/unplanned-inserter-clock";
import { CLOCK_STARTS } from "../start-dependence";
import { TargetProductionRate } from "../target-production-rate";
import { backpressureLossVerdictOf, clockVerificationSignature, startDependenceVerdictOf } from "../trial";
import { canonicalVerificationJson } from "../verification-signature";
import { finishedClock, groupedClockRank, groupedHandsPlan, GroupedHandsNotApplicable, holdsWithMargin } from "./grouped-hands";
import { constructPrimitiveGroupedHands } from "./primitive-grouped-hands";

export interface VerifiedPrimitiveGroupedResult {
    clock: BlueprintGenerationResult | null;
    report: PrimitiveGroupedAttemptReport;
}

/** Only the reviewed default policy: explicit caller alternatives keep their established semantics. */
export function primitiveGroupedOptionsSupported(config: Config, options: GenerateClockOptions): boolean {
    return options.verify_as_built === true && options.shared_windows !== true
        && options.belt_pickup_slack !== "never" && options.fuel_hand_room !== true
        && config.overrides?.derive_clock_windows !== true && config.overrides?.lcm === undefined
        && config.overrides?.terminal_swing_count === undefined && config.overrides?.use_fractional_swings !== true
        && config.target_output.counts !== "destroyed";
}

/**
 * Assess a pure AUTO construction using an authentic derived PlanRun. No user config or accepted physical controls
 * are inferred from that planning run. Failure is evidence for fallback, never a fabricated simulation verdict.
 */
export function verifiedPrimitiveGroupedClock(
    config: Config, options: GenerateClockOptions, requested_terminal_swing_count: number,
    trigger: PrimitiveGroupedPolicy["trigger"] = "initial-period-limit",
): VerifiedPrimitiveGroupedResult {
    const report: PrimitiveGroupedAttemptReport = { strategy: "primitive-grouped", eligibility: "separate-windows-only",
        outcome: "inapplicable", attempts: [] };
    const refused = (reason: string): VerifiedPrimitiveGroupedResult => ({ clock: null, report: { ...report, reason } });
    if (!primitiveGroupedOptionsSupported(config, options)) return refused("the caller's scheduling options are outside the primitive separate-window policy");
    let construction;
    try { construction = constructPrimitiveGroupedHands(config); }
    catch (error) {
        if (error instanceof GroupedHandsNotApplicable || error instanceof ClockPeriodLimitError) return refused(error.message);
        throw error;
    }
    const ways = construction.attempts.filter(attempt => !attempt.options.share_windows && attempt.result.kind === "constructed");
    if (ways.length === 0) return refused(construction.attempts.filter(attempt => !attempt.options.share_windows)
        .map(attempt => attempt.result.kind === "refused" ? attempt.result.reason : "").filter(Boolean).join("; ") || "no separate grouped construction applies");
    const logger = options.logger ?? defaultLogger;
    const detail = options.on_progress_detail;
    detail?.("Preparing primitive grouped verification context");
    // This derived policy is internal. Original AUTO intent and every physical field remain untouched.
    const derived: Config = { ...config, overrides: { ...config.overrides,
        terminal_swing_count: construction.terminal_swing_count, lcm: construction.grouped_cycles } };
    const made = planRun(derived, options);
    const { run } = made;
    assert(plannedTerminalSwingCount(run.crafting_cycle_plan) === construction.terminal_swing_count, "primitive planner count changed");
    assert(run.duration.ticks === construction.period_ticks && run.recipe_lcm === construction.grouped_cycles, "primitive period/cycles changed");
    assert(canonicalVerificationJson(EntityTransferCountMap.serialize(run.swing_counts)) === canonicalVerificationJson(construction.transfer_plan), "primitive transfer facts changed");
    const registry = run.simulation_context.entity_registry;
    const clocks = unplannedInserterClocks(registry, construction.period_ticks);
    const retained = Object.fromEntries([...clocks].map(([id, clock]) => [id, { kind: clock.kind, modulus: clock.modulus,
        own_clock: clock.own_clock === true, window: { start: clock.window.start_inclusive, end: clock.window.end_inclusive } }]));
    assert(canonicalVerificationJson(retained) === canonicalVerificationJson(construction.retained_clocks), "primitive by-product controls changed");
    const target = TargetProductionRate.fromConfig(config.target_output);
    const output_paths = registry.getAll().filter(Entity.isMachine)
        .filter(machine => machine.output.item_name === target.machine_production_rate.item).map(machine => outputPathOf(machine, registry));
    const finals = [...new Set(output_paths.flatMap(path => path.container === null ? path.feeders : path.takers).map(it => it.entity_id.id))];
    assert(canonicalVerificationJson(finals) === canonicalVerificationJson(construction.final_output_inserter_ids), "primitive final-output identities changed");
    const direct_sources = new Map<string, string[]>();
    for (const edge of construction.direct_dependencies) direct_sources.set(edge.target, [...(direct_sources.get(edge.target) ?? []), edge.source]);
    const seen = new Set<string>();
    const holding: BlueprintGenerationResult[] = [];
    report.outcome = "failed";
    let held_without_room: number | undefined;
    for (const attempt of ways) {
        if (attempt.result.kind !== "constructed") continue;
        // the ways with room for one more output swing only where no other way holds
        if (attempt.options.output_room === true) {
            held_without_room ??= holding.length;
            if (held_without_room > 0) break;
        }
        const built = attempt.result;
        const grouped = groupedHandsPlan(registry, run.swing_counts, run.recipe_lcm, run.duration.ticks,
            config.overrides?.backed_up_belts !== true, attempt.options, null, { output_paths, direct_sources, retained_clocks: clocks });
        const serialize = (windows: Map<string, OpenRange[]>) => Object.fromEntries([...windows].map(([id, ranges]) =>
            [id, ranges.map(range => ({ start: range.start_inclusive, end: range.end_inclusive }))]));
        assert(canonicalVerificationJson(serialize(grouped.windows)) === canonicalVerificationJson(built.planned_windows), "primitive reconstructed windows changed");
        assert(canonicalVerificationJson(grouped.busy) === canonicalVerificationJson(built.busy), "primitive busy dispositions changed");
        const room = withRoomForRandomAmounts(made, grouped.windows);
        const windows = room.windows;
        const key = canonicalVerificationJson({ windows: serialize(windows), retained, busy: built.busy });
        if (seen.has(key)) continue;
        seen.add(key);
        const event: PrimitiveGroupedAttemptReport["attempts"][number] = { construction_key: key, stage: "margin" };
        report.attempts.push(event);
        detail?.(`Checking primitive grouped margins ${report.attempts.length}`);
        const margin = holdsWithMargin(made, windows, construction.period_ticks);
        if (margin !== null) { event.reason = margin; continue; }
        event.stage = "as-built";
        const left_open = new Map<string, AlwaysOnReason>(built.busy.map(id => [id, { kind: "busy", period_ticks: construction.period_ticks }]));
        let result = finishedClock(made, windows, grouped.turns, { ...options, loop_windows: false }, left_open, room);
        const policy: PrimitiveGroupedPolicy = { strategy: "primitive-grouped", trigger,
            requested_terminal_swing_count, terminal_swing_count: construction.terminal_swing_count, grouped_cycles: construction.grouped_cycles,
            construction_key: key, options: { ...attempt.options, share_windows: false }, loop_refinement: false };
        result = { ...result, grouped_hands: { shared_windows: false }, primitive_grouped: policy };
        assert(canonicalVerificationJson(result.clock_windows) === canonicalVerificationJson(serialize(withInserterClocks(windows, clocks, construction.period_ticks))), "primitive exported controls changed");
        assert(canonicalVerificationJson(result.unplanned_inserter_clocks ?? {}) === canonicalVerificationJson(construction.retained_clocks), "primitive exported by-product controls changed");
        for (const inserter of construction.inserters) assert(result.clock_windows[inserter.id]?.length
            || result.unplanned_inserter_clocks?.[inserter.id] !== undefined
            || (built.busy.includes(inserter.id) && result.always_on_reasons?.[inserter.id]?.kind === "busy"), `primitive control missing: ${inserter.id}`);
        for (const drill of registry.getAll().filter(Entity.isDrill)) assert(result.clock_windows[drill.entity_id.id]?.length
            || (built.busy.includes(drill.entity_id.id) && result.always_on_reasons?.[drill.entity_id.id]?.kind === "busy"), `primitive drill control missing: ${drill.entity_id.id}`);
        if (!result.stability_check.as_built?.holds || !result.stability_check.holds) { event.reason = "the as-built check did not hold"; continue; }
        if (result.stability_check.as_built.long_run_proven === undefined) { event.reason = "the as-built long-run check was unavailable"; continue; }
        event.stage = "recovery";
        detail?.(`Checking primitive grouped recovery ${report.attempts.length}`);
        const loss = backpressureLossVerdictOf(derived, result, logger, detail, "throw");
        if (loss.backpressure_loss?.survives !== true || (loss.backpressure_loss.not_tried?.length ?? 0) !== 0) {
            event.reason = loss.backpressure_loss_not_tried ?? "recovery was unsuccessful or incomplete"; continue;
        }
        event.stage = "starts";
        const starts = config.overrides?.check_start_dependence === true
            ? startDependenceVerdictOf(derived, result, true, logger, detail, "throw") : null;
        if (config.overrides?.check_start_dependence === true && (starts === null || starts.verdict !== "stable"
            || starts.starts.length !== CLOCK_STARTS.length || CLOCK_STARTS.some(start => !starts.starts.some(outcome => outcome.id === start.id && outcome.reaches_target)))) {
            event.reason = "the requested starts were unsuccessful or incomplete"; continue;
        }
        policy.verification = { signature: clockVerificationSignature(derived, result), backpressure_loss: loss.backpressure_loss, start_dependence: starts };
        event.stage = "accepted";
        holding.push(result);
    }
    // Same objective and stable-order tie break as ordinary grouped selection, within the eligible assessed set.
    const ordered = holding.map((clock, index) => ({ clock, index, rank: groupedClockRank(registry, clock) }))
        .sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1] || a.index - b.index);
    if (ordered.length === 0) return { clock: null, report };
    return { clock: ordered[0].clock, report: { ...report, outcome: "accepted" } };
}
