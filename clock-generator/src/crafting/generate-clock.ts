import { ClockPeriodLimitError, type SwingPeriodRejection } from "./plan/clock-period-limit";
import { wholeSwingPeriodsBelow } from "./whole-swing-periods";
import { Config } from "../config";
import { defaultLogger } from "../common/logger";
import { groupedHandsClock } from "./candidates/grouped-hands";
import { observedWindowsClock } from "./candidates/observed-windows";
import { resultWindowsClockOfPlan } from "./candidates/result-windows-clock";
import { BlueprintGenerationResult, GenerateClockOptions, SwingAttemptResult, SwingBackoffReport, checkedClock, clockOfPlan, planRun } from "./plan/plan-run";
import { primitiveGroupedOptionsSupported, verifiedPrimitiveGroupedClock } from "./candidates/verified-primitive-grouped";
import type { PrimitiveGroupedAttemptReport } from "./primitive-grouped-policy";

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
        return planned;
    }
    const grouped = groupedHandsClock(plan, options);
    return grouped !== null && grouped.stability_check.holds ? grouped : planned;
}

/**
 * A clock made for a moving belt, for a config whose belts are backed up: the build is planned on a copy of the config
 * whose belts move, so a belt-fed hand is planned at the pace moving stacks come into reach, and every belt-fed window
 * gets the belt pickup slack. The clock-only check runs on the config itself, with its belts backed up, and the clock
 * holds when that check holds: the planning run moved its items on belts the config does not have, so the swing
 * backoff goes by the check alone. A backed-up belt refills a pickup at its own speed: where that is slower than a
 * stack a tick, windows planned for a stack a tick close before the hand is full, and these wait for it.
 */
export function movingBeltClock(config: Config, options: GenerateClockOptions = {}): BlueprintGenerationResult {
    const plan = planRun({ ...config, overrides: { ...config.overrides, backed_up_belts: false } }, options);
    const clock = clockOfPlan(plan, { ...options, belt_pickup_slack: "always" });
    // checked on the belts the config describes, not the ones the plan was made on
    const result = checkedClock({ ...plan, config }, clock, clock.windows, options);
    const { as_built } = result.stability_check;
    return as_built === undefined ? result : { ...result, stability_check: { ...result.stability_check, holds: as_built.holds } };
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
    const can_prune_periods = !swing_count_forced && config.overrides?.use_fractional_swings !== true
        && config.target_output.counts !== "destroyed";
    const period_rejections: SwingPeriodRejection[] = [];
    let requested_initial_count: number | undefined;
    let first_period_refusal: ClockPeriodLimitError | undefined;
    let period_frontier: Generator<SwingPeriodRejection> | undefined;
    let generated_count: number | undefined;
    let primitive_attempt: PrimitiveGroupedAttemptReport | undefined;
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
    if (initial_result === null) throw first_period_refusal!;
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
        if (period_frontier !== undefined && generated_count !== undefined) swings = generated_count;

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


