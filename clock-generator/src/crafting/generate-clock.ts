import { ClockPeriodLimitError, type SwingPeriodRejection } from "./plan/clock-period-limit";
import { wholeSwingPeriodsBelow } from "./whole-swing-periods";
import { Config } from "../config";
import { defaultLogger } from "../common/logger";
import { groupedHandsClock } from "./candidates/grouped-hands";
import { observedWindowsClock } from "./candidates/observed-windows";
import { resultWindowsClockOfPlan } from "./candidates/result-windows-clock";
import { BlueprintGenerationResult, GenerateClockOptions, PlanRun, SwingAttemptResult, SwingBackoffReport, checkedClock, clockOfPlan, clockOfWindows, planRun, slackInsideWindows } from "./plan/plan-run";
import { ArithmeticWindowsNotApplicable, batchedSwingsWindowsByArithmetic } from "./plan/batched-arithmetic";
import { sharedLaneShortened } from "./plan/shared-lane-guard";
import { estimatedOutputSwings } from "./plan/output-swing-estimate";
import { backpressureLossVerdictOf } from "./trial";
import { OpenRange } from "../data-types";
import { primitiveGroupedOptionsSupported, verifiedPrimitiveGroupedClock } from "./candidates/verified-primitive-grouped";
import type { PrimitiveGroupedAttemptReport } from "./primitive-grouped-policy";
import { FractionalSwingsRefusedError, fractionalSwingsWholeAt } from "./sequence/cycle/swing-distribution";

/** New budget-pruned results retain planner-unit requests separately from legacy final-taker aggregate reporting. */
export function terminalCountForAlternativePlanning(result: Pick<BlueprintGenerationResult, 'used_terminal_swing_count' | 'swing_backoff_report' | 'primitive_grouped' | 'secondary_planning'>): number {
    if (result.primitive_grouped !== undefined) return result.primitive_grouped.terminal_swing_count;
    if (result.secondary_planning !== undefined) return result.secondary_planning.terminal_swing_count;
    const report = result.swing_backoff_report;
    return report?.period_limit_pruning === undefined ? result.used_terminal_swing_count
        : report.stable_terminal_swing_count ?? report.initial_terminal_swing_count;
}

/**
 * Generates a clock from a configuration: the planning run (`planRun`), the clock of the plan with its room
 * (`clockOfPlan`), and the clock-only check and export (`checkedClock`). The config override `derive_clock_windows`
 * makes the observed windows candidate instead, keeping the planned windows where they pass.
 *
 * With `options.shared_windows` it makes only the clock of the grouped hands with shared windows; where there is none the result does not hold.
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
    if (plan.run.crafting_cycle_plan.result_windows !== undefined) {
        // results that come too rarely for whole hands in a period: their windows are the arithmetic's (result-windows.ts)
        return resultWindowsClockOfPlan(plan, options);
    }
    if (options.shared_windows === true) {
        // only the grouped hands' windows with the takers that open together sharing one; where there are none the clock is the
        // plan's, not checked and not holding, so that the output swings back off to the next count
        if (options.verify_as_built !== true) throw new Error("shared windows are made for a clock that is checked as built");
        const shared = groupedHandsClock(plan, options);
        if (shared !== null && shared.stability_check.holds) return shared;
        const unmade = clockOfPlan(plan, { ...options, belt_pickup_slack: "always" });
        const unchecked = checkedClock(plan, unmade, unmade.windows, { ...options, verify_as_built: false, modulo_blueprint: false, fuel_consumption_view: false });
        return { ...unchecked, stability_check: { ...unchecked.stability_check, holds: false } };
    }
    const clock = clockOfPlan(plan, options);
    const planned = checkedClock(plan, clock, clock.windows, options);
    // where the planned windows do not hold, windows made from the hands and the sources take their place, if they do
    if (options.verify_as_built !== true || (planned.stability_check.as_built?.holds ?? planned.stability_check.holds)) {
        // beside a planned clock that holds as built, the windows made by arithmetic (decision 7). Not where it does not hold:
        // a clock that holds there would stop the searches whose clocks are selected on such builds (the blocked output
        // fixture of stack 3 lost its shifted swings, 25.0 wake-ups a minute, to the arithmetic's 37.5)
        const arithmetic = options.verify_as_built === true ? arithmeticWindowsOf(plan) : null;
        const primary = arithmetic === null ? planned : arithmeticBesidePlanned(plan, planned, arithmetic, options);
        // then the planning run's windows with the slack they hold already, where they wake fewer than that
        return options.verify_as_built === true ? withSlackInside(plan, planned, primary, options) : primary;
    }
    const grouped = groupedHandsClock(plan, options);
    if (grouped !== null && grouped.stability_check.holds) {
        return grouped;
    }
    return clockWithPickupsFromTheirEntry(plan, options) ?? planned;
}

/**
 * The batched-swings windows of the plan made by arithmetic (batched-arithmetic.ts), where the arithmetic has a rule for
 * the build, they are not the planning run's own and the copies do not share a belt they shorten (shared-lane-guard.ts);
 * null elsewhere, the reason logged
 */
function arithmeticWindowsOf(plan: PlanRun): Map<string, OpenRange[]> | null {
    const { run } = plan;
    try {
        const { windows } = batchedSwingsWindowsByArithmetic({ entity_registry: run.simulation_context.entity_registry,
            crafting_cycle_plan: run.crafting_cycle_plan, period_ticks: run.duration.ticks, recipe_lcm: run.recipe_lcm,
            always_enabled_by_config: run.always_enabled_by_config });
        if (sameWindows(windows, plan.unslacked_windows)) {
            plan.logger.log("Windows by arithmetic: the planning run's own");
            return null;
        }
        const shared = sharedLaneShortened(plan.config, windows, plan.unslacked_windows);
        if (shared !== null) {
            plan.logger.log(`Windows by arithmetic: not used, ${shared}`);
            return null;
        }
        return windows;
    } catch (error) {
        if (!(error instanceof ArithmeticWindowsNotApplicable)) throw error;
        plan.logger.log(`Windows by arithmetic: none (${error.message})`);
        return null;
    }
}

function sameWindows(a: ReadonlyMap<string, OpenRange[]>, b: ReadonlyMap<string, OpenRange[]>): boolean {
    const text = (windows: ReadonlyMap<string, OpenRange[]>) => Array.from(windows).filter(([, ranges]) => ranges.length > 0)
        .sort(([x], [y]) => x < y ? -1 : x > y ? 1 : 0)
        .map(([key, ranges]) => `${key}:${ranges.map(range => `${range.start_inclusive}-${range.end_inclusive}`).join(",")}`).join(" ");
    return text(a) === text(b);
}

/**
 * The clock of the windows made by arithmetic, checked as the planned clock is (the clock-only check from every start
 * phase): on a plan of its own whose stability check is the arithmetic clock's alone, not the planning run's
 */
function checkedArithmeticClock(plan: PlanRun, windows: Map<string, OpenRange[]>, options: GenerateClockOptions): BlueprintGenerationResult {
    const own: PlanRun = { ...plan, run: { ...plan.run, stability_check: { ...plan.run.stability_check, holds: true, as_built: undefined } } };
    const clock = clockOfWindows(own, windows, options);
    const checked = checkedClock(own, clock, clock.windows, options);
    const as_built = checked.stability_check.as_built;
    plan.logger.log(`Windows by arithmetic: the clock ${as_built?.holds ? "holds" : "does not hold"} as built`
        + (as_built?.wake_ups === undefined ? "" : `, ${as_built.wake_ups.wake_ups_per_minute.toFixed(2)} wake-ups a minute`));
    return { ...checked, window_maker: "arithmetic" };
}

/**
 * Which of the two clocks of a plan whose planned clock holds as built is the primary (decision 7: the arithmetic maker
 * beside the planning run), decided by what both are checked to do: the clock made by arithmetic where it holds as built,
 * wakes its inserters fewer times a minute, and gets back from every backpressure loss the planned clock gets back from;
 * the planned clock everywhere else
 */
function arithmeticBesidePlanned(plan: PlanRun, planned: BlueprintGenerationResult, windows: Map<string, OpenRange[]>,
    options: GenerateClockOptions): BlueprintGenerationResult {
    const made = checkedArithmeticClock(plan, windows, options);
    const wake_ups = (result: BlueprintGenerationResult) => result.stability_check.as_built?.wake_ups?.wake_ups_per_minute;
    const made_wake_ups = wake_ups(made), planned_wake_ups = wake_ups(planned);
    if (!made.stability_check.holds || made_wake_ups === undefined || planned_wake_ups === undefined || !(made_wake_ups < planned_wake_ups)) {
        return planned;
    }
    const survives = (result: BlueprintGenerationResult) => backpressureLossVerdictOf(plan.config, result, plan.logger).backpressure_loss?.survives === true;
    if (!survives(made) && survives(planned)) {
        plan.logger.log("Windows by arithmetic: fewer wake-ups, but the clock does not get back from a loss the planned one gets back from");
        return planned;
    }
    plan.logger.log(`Windows by arithmetic: the primary clock (${made_wake_ups.toFixed(2)} against ${planned_wake_ups.toFixed(2)} wake-ups a minute)`);
    return made;
}

/**
 * The primary clock so far (the planned clock, or the clock by arithmetic beside it), or the planned windows with the
 * belt pickup slack they hold already (`slackInsideWindows`) in place of the slack added after them, where every
 * belt-fed window stays open the slack's ticks after its last pickup: the clock made so where it holds as built, wakes
 * its inserters fewer times a minute than the primary and gets back from every backpressure loss the primary gets back
 * from. The slack added after such a window lets the arm, back from its last drop,
 * start a hand the plan does not have, and where that hand waits at its machine it costs a wake-up; it can also join two
 * windows of a period into one (the logistic science sample's two pickup windows of 176 ticks: 20.57 wake-ups a minute
 * with the slack inside, 61.71 joined by the slack added; docs/wake-ups.md).
 */
function withSlackInside(plan: PlanRun, planned: BlueprintGenerationResult, primary: BlueprintGenerationResult,
    options: GenerateClockOptions): BlueprintGenerationResult {
    if (options.belt_pickup_slack !== "always" || planned.belt?.kind !== "moving" || slackInsideWindows(plan) === null) {
        return primary;
    }
    // checked on a copy of the plan: the check writes the as-built result into the stability check of the plan it is given
    const own: PlanRun = { ...plan, run: { ...plan.run, stability_check: { ...plan.run.stability_check, as_built: undefined } } };
    const clock = clockOfPlan(own, { ...options, belt_pickup_slack: "inside" });
    const inside = checkedClock(own, clock, clock.windows, options);
    const wake_ups = (result: BlueprintGenerationResult) => result.stability_check.as_built?.wake_ups?.wake_ups_per_minute;
    const inside_wake_ups = wake_ups(inside), primary_wake_ups = wake_ups(primary);
    if (!(inside.stability_check.as_built?.holds ?? false) || inside_wake_ups === undefined || primary_wake_ups === undefined
        || !(inside_wake_ups < primary_wake_ups)) {
        return primary;
    }
    const survives = (result: BlueprintGenerationResult) => backpressureLossVerdictOf(plan.config, result, plan.logger).backpressure_loss?.survives === true;
    if (!survives(inside) && survives(primary)) {
        plan.logger.log("Belt pickup slack inside the windows: fewer wake-ups, but the clock does not get back from a loss the primary one gets back from");
        return primary;
    }
    plan.logger.log(`Belt pickup slack inside the windows: the primary clock (${inside_wake_ups.toFixed(2)} against ${primary_wake_ups.toFixed(2)} wake-ups a minute)`);
    return inside;
}

/**
 * The clock of the same planning run with every pickup recorded from its entry, where neither the
 * plan's clock nor the grouped hands' holds as built: kept where it holds, else null. The plan's belt-fed pickups after a wait at their
 * machine's output block count from the take that freed them (`PickupStartAtTheTake`), so such a window opens a tick
 * before the hand's first stack in the planning run, and a clock that reaches it without the block lets the hand act a
 * tick before the plan did. Both starts are the plan's; the as-built check decides. Null where no pickup of the
 * planning run was counted from a take.
 */
function clockWithPickupsFromTheirEntry(plan: PlanRun, options: GenerateClockOptions): BlueprintGenerationResult | null {
    if (!(plan.run.pickups_from_the_take > 0)) {
        return null;
    }
    const from_entry = planRun(plan.config, { ...options, pickup_start: "entry" });
    const clock = clockOfPlan(from_entry, options);
    const checked = checkedClock(from_entry, clock, clock.windows, options);
    const holds = checked.stability_check.as_built?.holds ?? checked.stability_check.holds;
    plan.logger.log(`Pickups counted from their entry, not from the take that freed them: the clock ${holds ? "holds, kept" : "does not hold either"}`);
    return holds ? checked : null;
}

/**
 * Generates a blueprint from a configuration with automatic output swing stability backoff.
 *
 * If the first simulation attempt produces unstable output — i.e. the items transferred
 * by output inserters deviate from the expected amount by more than SWING_STABILITY_TOLERANCE
 * (e.g. half-frequency due to excessive output blocking) — this function retries with
 * progressively lower terminal_swing_count values (initial → initial-1 → … → 1) until a
 * stable result is found or all options are exhausted.
 *
 * Backoff is skipped when `config.overrides.terminal_swing_count` is set: that count is forced as-is.
 *
 * Fractional swings (`options.fractional_swings`) that the insertion limits refuse at a count
 * (FractionalSwingsRefusedError) are planned at the whole counts below it, the first the cycle plan accepts; a
 * forced count is not. Where the first plan is refused and the count it is made at has every inserter's swings whole,
 * no clock is made: it would be the clock of that many whole output swings, which is offered on its own.
 *
 * A `swing_backoff_report` is always attached to the returned result describing what
 * happened (triggered / not triggered, which swing counts were tried, which was stable).
 *
 * @param config  The configuration for the simulation
 * @param options Optional generation options (debug, logger, …)
 * @param generate How the clock is made at each count
 * @returns The generated blueprint result from the first stable swing count, with an attached
 *          backoff report. Falls back to the initial result if no stable swing count is found.
 */
export function generateClockWithSwingBackoff(
    config: Config,
    options: GenerateClockOptions = {},
    /** The way the clock is made at each swing count: a planned clock unless a candidate is named */
    generate: (config: Config, options: GenerateClockOptions) => BlueprintGenerationResult = generateClockForConfig,
): BlueprintGenerationResult {
    const logger = options.logger ?? defaultLogger;

    const swing_count_forced = config.overrides?.terminal_swing_count !== undefined;
    const can_prune_periods = !swing_count_forced && options.fractional_swings !== true
        && config.target_output.counts !== "destroyed";
    const period_rejections: SwingPeriodRejection[] = [];
    let requested_initial_count: number | undefined;
    let first_period_refusal: ClockPeriodLimitError | undefined;
    let period_frontier: Generator<SwingPeriodRejection> | undefined;
    let generated_count: number | undefined;
    let primitive_attempt: PrimitiveGroupedAttemptReport | undefined;
    const can_lower_refused_fractions = !swing_count_forced && options.fractional_swings === true;
    let first_fractional_refusal: FractionalSwingsRefusedError | undefined;
    const withCount = (count: number): Config => ({ ...config, overrides: { ...config.overrides, terminal_swing_count: count } });
    const generateWithinBudget = (candidate: Config): BlueprintGenerationResult | null => {
        let attempted = candidate;
        if (period_frontier !== undefined) {
            const ceiling = candidate.overrides?.terminal_swing_count ?? Infinity;
            let eligible: number | undefined;
            for (let next = period_frontier.next(); !next.done; next = period_frontier.next()) {
                const period = next.value;
                if (period.terminal_swing_count > ceiling) continue;
                if (period.period_ticks >= period.limit_ticks) period_rejections.push(period);
                else { eligible = period.terminal_swing_count; break; }
            }
            if (eligible === undefined) return null;
            attempted = withCount(eligible);
        }
        try {
            const generated = generate(attempted, options);
            generated_count = attempted.overrides?.terminal_swing_count;
            return generated;
        } catch (error) {
            if (can_lower_refused_fractions && error instanceof FractionalSwingsRefusedError && error.swings_per_cycle !== undefined) {
                first_fractional_refusal ??= error;
                // the first whole count below the swings refused: 5 below 5 1/3, 4 below 5
                const refused = error.swings_per_cycle;
                const below = Math.ceil(refused.getNumerator / refused.getDenominator) - 1;
                return below < 1 ? null : generateWithinBudget(withCount(below));
            }
            if (!can_prune_periods || !(error instanceof ClockPeriodLimitError) || error.arithmetic === undefined) throw error;
            const initial_refusal = first_period_refusal === undefined && attempted === config;
            first_period_refusal ??= error;
            requested_initial_count ??= error.rejection.terminal_swing_count;
            period_rejections.push({ ...error.rejection });
            const below = Math.min(error.arithmetic.terminal_swing_count, attempted.overrides?.terminal_swing_count ?? Infinity);
            period_frontier = wholeSwingPeriodsBelow({ ...error.arithmetic, terminal_swing_count: below }, error.rejection.limit_ticks);
            if (initial_refusal && generate === generateClockForConfig && primitiveGroupedOptionsSupported(config, options)) {
                const primitive = verifiedPrimitiveGroupedClock(config, options, error.rejection.terminal_swing_count);
                primitive_attempt = primitive.report;
                if (primitive.clock !== null) {
                    generated_count = primitive.clock.primitive_grouped!.terminal_swing_count;
                    return primitive.clock;
                }
            }
            return generateWithinBudget(withCount(below - 1));
        }
    };
    const pruningReport = () => ({ ...(primitive_attempt === undefined ? {} : { primitive_grouped_attempt: primitive_attempt }),
        ...(period_rejections.length === 0 ? {} : { period_limit_pruning: {
        requested_terminal_swing_count: requested_initial_count!, rejections: period_rejections,
    } }) });
    const initial_result = generateWithinBudget(config);
    if (initial_result === null) throw first_period_refusal ?? first_fractional_refusal!;
    if (first_fractional_refusal !== undefined && !initial_result.crafting_cycle_plan.fractional_swings_enabled) {
        throw fractionalSwingsWholeAt(first_fractional_refusal, initial_result.used_terminal_swing_count);
    }
    const initial_swing_count = period_frontier !== undefined && generated_count !== undefined
        ? generated_count : initial_result.used_terminal_swing_count;
    requested_initial_count ??= initial_swing_count;

    if (initial_result.stability_check.holds || swing_count_forced || initial_swing_count <= 1) {
        return {
            ...initial_result,
            swing_backoff_report: {
                triggered: false,
                ...pruningReport(),
                initial_terminal_swing_count: initial_swing_count,
                initial_attempt: {
                    terminal_swing_count: initial_swing_count,
                    holds: initial_result.stability_check.holds,
                    actual_output_items: initial_result.primitive_grouped === undefined ? initial_result.stability_check.actual_output_items
                        : initial_result.stability_check.as_built!.actual_output_items,
                    expected_output_items: initial_result.stability_check.expected_output_items,
                },
                stable_terminal_swing_count: initial_result.stability_check.holds ? initial_swing_count : null,
                attempts: [],
            },
        };
    }

    logger.log(`\n--- Output Swing Stability Backoff ---`);
    logger.log(
        `Initial swing count ${initial_swing_count} produced unstable output ` +
        `(actual=${initial_result.stability_check.actual_output_items}, ` +
        `expected=${initial_result.stability_check.expected_output_items}). ` +
        `Attempting backoff...`
    );

    // the output swing estimate beside the counts it backs off through, for the batched clock (output-swing-estimate.ts):
    // a shadow, logged and never used to skip a count, until it is shown to drop none that meets the rate
    const estimate = generate === generateClockForConfig && options.fractional_swings !== true
        ? estimatedOutputSwings(config, initial_swing_count) : null;
    const estimated = (swings: number) => estimate?.above.find(it => it.swings === swings)?.verdict
        ?? (estimate?.swings !== null && estimate?.swings !== undefined && swings <= estimate.swings ? "keeps up" : undefined);
    if (estimate !== null) {
        logger.log(`Output swing estimate (shadow): ${estimate.swings ?? "none"}`
            + estimate.above.map(it => `; ${it.swings} ${it.verdict}${it.verdict === "no rule" ? ` (${it.reason})` : ""}`).join(""));
    }

    const attempts: SwingAttemptResult[] = [];
    let stable_result: BlueprintGenerationResult | null = null;
    let stable_swing_count: number | null = null;

    const initial_attempt: SwingAttemptResult = {
        terminal_swing_count: initial_swing_count,
        holds: false,
        actual_output_items: initial_result.stability_check.actual_output_items,
        expected_output_items: initial_result.stability_check.expected_output_items,
    };

    for (let swings = initial_swing_count - 1; swings >= 1; swings--) {
        logger.log(`Attempting terminal_swing_count=${swings}...`);
        const attempt_result = generateWithinBudget(withCount(swings));
        if (attempt_result === null) break;
        if ((period_frontier !== undefined || first_fractional_refusal !== undefined) && generated_count !== undefined) swings = generated_count;

        attempts.push({
            terminal_swing_count: swings,
            holds: attempt_result.stability_check.holds,
            actual_output_items: attempt_result.stability_check.actual_output_items,
            expected_output_items: attempt_result.stability_check.expected_output_items,
        });

        logger.log(
            `swings=${swings}: actual=${attempt_result.stability_check.actual_output_items}, ` +
            `expected=${attempt_result.stability_check.expected_output_items}, ` +
            `stable=${attempt_result.stability_check.holds}`
            + (estimated(swings) === undefined ? "" : `, estimate: ${estimated(swings)}`)
        );

        if (attempt_result.stability_check.holds) {
            stable_result = attempt_result;
            stable_swing_count = swings;
            break;
        }
    }

    const swing_backoff_report: SwingBackoffReport = {
        triggered: true,
        ...pruningReport(),
        initial_terminal_swing_count: initial_swing_count,
        initial_attempt,
        stable_terminal_swing_count: stable_swing_count,
        attempts,
    };

    if (stable_result !== null) {
        logger.log(`Backoff successful: stable swing count=${stable_swing_count}`);
        return { ...stable_result, swing_backoff_report };
    }

    logger.log(`Backoff exhausted: no stable swing count found. Returning initial result.`);
    return { ...initial_result, swing_backoff_report };
}


