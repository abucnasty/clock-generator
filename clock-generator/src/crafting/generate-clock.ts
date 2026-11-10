import { ClockWindowCycleLimitError, type SwingWindowCycleRejection } from "./plan/clock-window-cycle-limit";
import { wholeSwingWindowCyclesBelow } from "./whole-swing-window-cycles";
import { Config } from "../config";
import { defaultLogger } from "../common/logger";
import { roundRobinPollingClock } from "./candidates/round-robin-polling";
import { timeStudyWindowsClock } from "./candidates/time-study-windows";
import { exhaustClockOfPlan } from "./candidates/exhaust-clock";
import { BlueprintGenerationResult, GenerateClockOptions, UnclockedRun, PlannedClock, SwingAttemptResult, SwingBackoffReport, checkedClock, clockOfPlan, clockOfWindows, unclockedRun } from "./plan/unclocked-run";
import { type GhostWindow, windowsWithoutGhostWakeUps } from "./plan/ghost-windows";
import { ghostWakeUpsOfStock } from "./wake-ups";
import { inserterEnds } from "./inserter-counters";
import { LONG_RUN_SETTLE_SHARE } from "./long-run";
import type { AsBuiltRun } from "./trial";
import { ArithmeticWindowsNotApplicable, batchedSwingsWindowsByArithmetic } from "./plan/batched-arithmetic";
import { estimatedOutputSwings } from "./plan/output-swing-estimate";
import { disturbanceTrialVerdictOf } from "./trial";
import { OpenRange } from "../data-types";
import { primitiveRoundRobinPollingOptionsSupported, verifiedPrimitiveRoundRobinPollingClock } from "./candidates/round-robin-polling-primitive-verified";
import type { PrimitiveRoundRobinPollingAttemptReport } from "./round-robin-polling-primitive-policy";
import { FractionalSwingsRefusedError, fractionalSwingsWholeAt } from "./sequence/cycle/swing-distribution";

/** New budget-pruned results retain planner-unit requests separately from legacy final-taker aggregate reporting. */
export function terminalCountForAlternativePlanning(result: Pick<BlueprintGenerationResult, 'used_terminal_swing_count' | 'swing_backoff_report' | 'primitive_round_robin_polling' | 'secondary_planning'>): number {
    if (result.primitive_round_robin_polling !== undefined) return result.primitive_round_robin_polling.terminal_swing_count;
    if (result.secondary_planning !== undefined) return result.secondary_planning.terminal_swing_count;
    const report = result.swing_backoff_report;
    return report?.window_cycle_limit_pruning === undefined ? result.used_terminal_swing_count
        : report.stable_terminal_swing_count ?? report.initial_terminal_swing_count;
}

/**
 * Generates a clock from a configuration: the planning run (`unclockedRun`), the clock of the plan with its room
 * (`clockOfPlan`), and the clock-only check and export (`checkedClock`). The config override `derive_clock_windows`
 * makes the observed windows candidate instead, keeping the planned windows where they pass.
 *
 * With `options.shared_windows` it makes only the clock of the grouped hands with shared windows; where there is none the result does not hold.
 *
 * @param config The configuration for the simulation
 * @param options Optional generation options (debug, logger, the clock-only check, …)
 * @returns The generated blueprint and related metadata
 */
export function generateClockForConfig(
    config: Config,
    options: GenerateClockOptions = {}
): BlueprintGenerationResult {
    if (config.overrides?.derive_clock_windows) {
        return timeStudyWindowsClock(config, options, "prefer_planned");
    }
    const plan = unclockedRun(config, options);
    if (plan.run.output_cycle_plan.exhaust !== undefined) {
        // results that come too rarely for whole hands in a window cycle: their windows are the arithmetic's (exhaust.ts)
        return exhaustClockOfPlan(plan, options);
    }
    if (options.shared_windows === true) {
        // only the grouped hands' windows with the takers that open together sharing one; where there are none the clock is the
        // plan's, not checked and not holding, so that the output swings back off to the next count
        if (options.verify_as_built !== true) throw new Error("shared enable windows are made for a clock that is checked as built");
        const shared = roundRobinPollingClock(plan, options);
        if (shared !== null && shared.stability_check.holds) return shared;
        const unmade = clockOfPlan(plan, options);
        const unchecked = checkedClock(plan, unmade, unmade.windows, { ...options, verify_as_built: false, modulo_blueprint: false, fuel_consumption_view: false });
        return { ...unchecked, stability_check: { ...unchecked.stability_check, holds: false } };
    }
    // what each clock below was made and checked on, for the shaping of the primary against ghost wakeups
    const made: MadeClocks = new Map();
    const clock = clockOfPlan(plan, options);
    const planned = checkedAndKept(made, plan, clock, clock.windows, options);
    // where the planned windows do not hold, windows made from the hands and the sources take their place, if they do
    if (options.verify_as_built !== true || (planned.stability_check.as_built?.holds ?? planned.stability_check.holds)) {
        // beside a planned clock that holds as built, the windows made by arithmetic (decision 7). Not where it does not hold:
        // a clock that holds there would stop the searches whose clocks are selected on such builds (the blocked output
        // fixture of stack 3 lost its shifted swings, 25.0 wake-ups a minute, to the arithmetic's 37.5)
        const arithmetic = options.verify_as_built === true ? arithmeticWindowsOf(plan) : null;
        const primary = arithmetic === null ? planned : arithmeticBesidePlanned(made, plan, planned, arithmetic, options);
        if (options.verify_as_built !== true) return primary;
        // then its windows shaped against ghost wakeups, where that wakes fewer
        return withoutGhostWakeUps(made, primary, options);
    }
    const grouped = roundRobinPollingClock(plan, options);
    if (grouped !== null && grouped.stability_check.holds) {
        return grouped;
    }
    const from_entry = clockWithPickupsFromTheirEntry(made, plan, options);
    return from_entry === null ? planned : withoutGhostWakeUps(made, from_entry, options);
}

/**
 * The batched-swings windows of the plan made by arithmetic (batched-arithmetic.ts), where the arithmetic has a rule for
 * the build and they are not the planning run's own; null elsewhere, the reason logged
 */
function arithmeticWindowsOf(plan: UnclockedRun): Map<string, OpenRange[]> | null {
    const { run } = plan;
    try {
        const { windows } = batchedSwingsWindowsByArithmetic({ entity_registry: run.simulation_context.entity_registry,
            output_cycle_plan: run.output_cycle_plan, window_cycle_ticks: run.duration.ticks, recipe_lcm: run.recipe_lcm,
            always_enabled_by_config: run.always_enabled_by_config });
        if (sameWindows(windows, plan.unslacked_windows)) {
            plan.logger.log("Enable windows by arithmetic: the unclocked run's own");
            return null;
        }
        return windows;
    } catch (error) {
        if (!(error instanceof ArithmeticWindowsNotApplicable)) throw error;
        plan.logger.log(`Enable windows by arithmetic: none (${error.message})`);
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
function checkedArithmeticClock(made: MadeClocks, plan: UnclockedRun, windows: Map<string, OpenRange[]>, options: GenerateClockOptions): BlueprintGenerationResult {
    const own: UnclockedRun = { ...plan, run: { ...plan.run, stability_check: { ...plan.run.stability_check, holds: true, as_built: undefined } } };
    const clock = clockOfWindows(own, windows, options);
    const checked = checkedAndKept(made, own, clock, clock.windows, options);
    const as_built = checked.stability_check.as_built;
    plan.logger.log(`Enable windows by arithmetic: the clock ${as_built?.holds ? "holds" : "does not hold"} as built`
        + (as_built?.wake_ups === undefined ? "" : `, ${as_built.wake_ups.wake_ups_per_minute.toFixed(2)} wakeups a minute`));
    const result: BlueprintGenerationResult = { ...checked, window_maker: "arithmetic" };
    const kept = made.get(checked);
    if (kept !== undefined) made.set(result, kept);
    return result;
}

/**
 * Which of the two clocks of a plan whose planned clock holds as built is the primary (decision 7: the arithmetic maker
 * beside the planning run), decided by what both are checked to do: the clock made by arithmetic where it holds as built,
 * wakes its inserters fewer times a minute, and gets back from every backpressure loss the planned clock gets back from;
 * the planned clock everywhere else
 */
function arithmeticBesidePlanned(clocks: MadeClocks, plan: UnclockedRun, planned: BlueprintGenerationResult, windows: Map<string, OpenRange[]>,
    options: GenerateClockOptions): BlueprintGenerationResult {
    const made = checkedArithmeticClock(clocks, plan, windows, options);
    const wake_ups = (result: BlueprintGenerationResult) => result.stability_check.as_built?.wake_ups?.wake_ups_per_minute;
    const made_wake_ups = wake_ups(made), planned_wake_ups = wake_ups(planned);
    if (!made.stability_check.holds || made_wake_ups === undefined || planned_wake_ups === undefined || !(made_wake_ups < planned_wake_ups)) {
        return planned;
    }
    const survives = (result: BlueprintGenerationResult) => disturbanceTrialVerdictOf(plan.config, result, plan.logger).disturbance_trial?.survives === true;
    if (!survives(made) && survives(planned)) {
        plan.logger.log("Enable windows by arithmetic: fewer wakeups, but the clock does not go back to its rate by itself after a supply stop or an output blockage, as the planned one does");
        return planned;
    }
    plan.logger.log(`Enable windows by arithmetic: the primary clock (${made_wake_ups.toFixed(2)} against ${planned_wake_ups.toFixed(2)} wakeups a minute)`);
    return made;
}

/** A clock checked as built, with the plan, clock and windows it was checked on and the check's run (see `checkedAndKept`) */
interface MadeClock {
    plan: UnclockedRun;
    clock: PlannedClock;
    windows: Map<string, OpenRange[]>;
    run: AsBuiltRun | undefined;
}
type MadeClocks = Map<BlueprintGenerationResult, MadeClock>;

/** `checkedClock`, keeping in `made` what the result was made and checked on */
function checkedAndKept(made: MadeClocks, plan: UnclockedRun, clock: PlannedClock, windows: Map<string, OpenRange[]>,
    options: GenerateClockOptions): BlueprintGenerationResult {
    let run: AsBuiltRun | undefined;
    const result = checkedClock(plan, clock, windows, options, { on_as_built: checked => { run = checked; } });
    made.set(result, { plan, clock, windows, run });
    return result;
}

/**
 * The primary clock, or its windows shaped against ghost wakeups (`windowsWithoutGhostWakeUps`, #641): each window
 * whose switch-off left its inserter asleep on a machine's list in the primary's clock-only run closes before the
 * inserter went to sleep or took the hand it held, or is dropped where that leaves it nothing. The clock made so where it
 * holds as built, wakes its inserters fewer times a minute than the primary and gets back from every backpressure loss
 * the primary gets back from. The windows with room for a hand of fuel, and the windows of a loop, are left as they are.
 */
function withoutGhostWakeUps(made: MadeClocks, primary: BlueprintGenerationResult, options: GenerateClockOptions): BlueprintGenerationResult {
    const kept = made.get(primary);
    const stock = kept?.run?.stock;
    if (kept === undefined || stock === undefined || !(primary.stability_check.as_built?.holds ?? false)) {
        return primary;
    }
    const { plan, clock, windows, run } = kept;
    const check = run!.check;
    // the part of the run its wake-ups are counted on (trial.ts)
    const from = check.long_run_proven ? check.first_judged_tick ?? 0 : Math.floor(stock.ticks / LONG_RUN_SETTLE_SHARE);
    const ghosts = ghostWakeUpsOfStock(stock, inserterEnds(plan.config), from);
    if (ghosts.length === 0) {
        return primary;
    }
    const fixed = new Set([
        ...clock.fuel_hand_room.keys(),
        ...primary.loop_windows?.inserter_ids ?? [],
    ]);
    const left: string[] = [];
    const offset = check.clock_tick_at_first_judged === undefined || check.first_judged_tick === undefined ? undefined
        : check.first_judged_tick - check.clock_tick_at_first_judged;
    const shaped = windowsWithoutGhostWakeUps(windows, plan.run.duration.ticks, stock, ghosts, fixed, offset, (id, why) => left.push(`${id}: ${why}`));
    if (left.length > 0) {
        plan.logger.log(`Ghost wakeups: enable windows left as they are (${left.join("; ")})`);
    }
    if (shaped === null) {
        return primary;
    }
    const wake_ups = (it: BlueprintGenerationResult) => it.stability_check.as_built?.wake_ups?.wake_ups_per_minute;
    const textOf = (moved: readonly GhostWindow[]) => moved.map(it => `${it.inserter_id} ${it.window.start_inclusive}-${it.window.end_inclusive}`
        + ` -> ${it.shaped === null ? "dropped" : `${it.shaped.start_inclusive}-${it.shaped.end_inclusive}`}`).join(", ");
    // checked on a copy of the plan: the check writes the as-built result into the stability check of the plan it is given
    const checked = (shaped_windows: Map<string, OpenRange[]>) => checkedClock(
        { ...plan, run: { ...plan.run, stability_check: { ...plan.run.stability_check, as_built: undefined } } }, clock, shaped_windows, options);
    const fewer = (it: BlueprintGenerationResult, than: BlueprintGenerationResult) => (it.stability_check.as_built?.holds ?? false)
        && wake_ups(it) !== undefined && wake_ups(than) !== undefined && wake_ups(it)! < wake_ups(than)!;
    // every window shaped at once; where that does not hold or wake fewer, the windows of one inserter at a time, kept
    // where they wake fewer than what is kept so far
    let best = primary, best_windows = windows;
    const moved: GhostWindow[] = [];
    const all = checked(shaped.windows);
    const inserters = Array.from(new Set(shaped.shaped.map(it => it.inserter_id)));
    if (fewer(all, primary)) {
        best = all;
        moved.push(...shaped.shaped);
    } else {
        plan.logger.log(`Enable windows shaped against ${ghosts.length} ghost wakeups (${textOf(shaped.shaped)}): not used, `
            + (all.stability_check.as_built?.holds ? `${wake_ups(all)?.toFixed(2)} against ${wake_ups(primary)?.toFixed(2)} wakeups a minute` : "it does not hold as built"));
        if (inserters.length > 1) for (const id of inserters) {
            const own = new Map(best_windows);
            own.set(id, shaped.windows.get(id)!);
            const one = checked(own);
            const shaped_of = shaped.shaped.filter(it => it.inserter_id === id);
            if (fewer(one, best)) {
                best = one;
                best_windows = own;
                moved.push(...shaped_of);
            } else {
                plan.logger.log(`Enable windows of ${id} shaped against ghost wakeups (${textOf(shaped_of)}): not used`);
            }
        }
    }
    if (best === primary) {
        return primary;
    }
    const survives = (it: BlueprintGenerationResult) => disturbanceTrialVerdictOf(plan.config, it, plan.logger).disturbance_trial?.survives === true;
    if (!survives(best) && survives(primary)) {
        plan.logger.log(`Enable windows shaped against ghost wakeups (${textOf(moved)}): fewer wakeups, but the clock does not go back to its rate by itself after a supply stop or an output blockage, as the primary one does`);
        return primary;
    }
    plan.logger.log(`Enable windows shaped against ghost wakeups (${textOf(moved)}): the primary clock (${wake_ups(best)!.toFixed(2)} against ${wake_ups(primary)!.toFixed(2)} wakeups a minute)`);
    const range = (it: OpenRange) => ({ start: it.start_inclusive, end: it.end_inclusive });
    return { ...best, ...(primary.window_maker !== undefined && { window_maker: primary.window_maker }),
        ghost_wakeup_windows: moved.map(it => ({ inserter_id: it.inserter_id, window: range(it.window), shaped: it.shaped === null ? null : range(it.shaped),
            ghost_wake_ups: it.ghost_wake_ups })) };
}

/**
 * The clock of the same planning run with every pickup recorded from its entry, where neither the
 * plan's clock nor the grouped hands' holds as built: kept where it holds, else null. The plan's belt-fed pickups after a wait at their
 * machine's output block count from the take that freed them (`PickupStartAtTheTake`), so such a window opens a tick
 * before the hand's first stack in the planning run, and a clock that reaches it without the block lets the hand act a
 * tick before the plan did. Both starts are the plan's; the as-built check decides. Null where no pickup of the
 * planning run was counted from a take.
 */
function clockWithPickupsFromTheirEntry(made: MadeClocks, plan: UnclockedRun, options: GenerateClockOptions): BlueprintGenerationResult | null {
    if (!(plan.run.pickups_from_the_take > 0)) {
        return null;
    }
    const from_entry = unclockedRun(plan.config, { ...options, pickup_start: "entry" });
    const clock = clockOfPlan(from_entry, options);
    const checked = checkedAndKept(made, from_entry, clock, clock.windows, options);
    const holds = checked.stability_check.as_built?.holds ?? checked.stability_check.holds;
    plan.logger.log(`Pickups counted from their entry, not from the take that freed them: the clock ${holds ? "holds, kept" : "does not hold either"}`);
    return holds ? { ...checked, pickups_from_entry: true } : null;
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
 * Euclidean Swings (`options.fractional_swings`) that the insertion limits refuse at a count
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
    const can_prune_window_cycles = !swing_count_forced && options.fractional_swings !== true
        && config.setpoint.counts !== "destroyed";
    const window_cycle_rejections: SwingWindowCycleRejection[] = [];
    let requested_initial_count: number | undefined;
    let first_window_cycle_refusal: ClockWindowCycleLimitError | undefined;
    let window_cycle_frontier: Generator<SwingWindowCycleRejection> | undefined;
    let generated_count: number | undefined;
    let primitive_attempt: PrimitiveRoundRobinPollingAttemptReport | undefined;
    const can_lower_refused_fractions = !swing_count_forced && options.fractional_swings === true;
    let first_fractional_refusal: FractionalSwingsRefusedError | undefined;
    const withCount = (count: number): Config => ({ ...config, overrides: { ...config.overrides, terminal_swing_count: count } });
    const generateWithinBudget = (candidate: Config): BlueprintGenerationResult | null => {
        let attempted = candidate;
        if (window_cycle_frontier !== undefined) {
            const ceiling = candidate.overrides?.terminal_swing_count ?? Infinity;
            let eligible: number | undefined;
            for (let next = window_cycle_frontier.next(); !next.done; next = window_cycle_frontier.next()) {
                const window_cycle = next.value;
                if (window_cycle.terminal_swing_count > ceiling) continue;
                if (window_cycle.window_cycle_ticks >= window_cycle.limit_ticks) window_cycle_rejections.push(window_cycle);
                else { eligible = window_cycle.terminal_swing_count; break; }
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
            if (!can_prune_window_cycles || !(error instanceof ClockWindowCycleLimitError) || error.arithmetic === undefined) throw error;
            const initial_refusal = first_window_cycle_refusal === undefined && attempted === config;
            first_window_cycle_refusal ??= error;
            requested_initial_count ??= error.rejection.terminal_swing_count;
            window_cycle_rejections.push({ ...error.rejection });
            const below = Math.min(error.arithmetic.terminal_swing_count, attempted.overrides?.terminal_swing_count ?? Infinity);
            window_cycle_frontier = wholeSwingWindowCyclesBelow({ ...error.arithmetic, terminal_swing_count: below }, error.rejection.limit_ticks);
            if (initial_refusal && generate === generateClockForConfig && primitiveRoundRobinPollingOptionsSupported(config, options)) {
                const primitive = verifiedPrimitiveRoundRobinPollingClock(config, options, error.rejection.terminal_swing_count);
                primitive_attempt = primitive.report;
                if (primitive.clock !== null) {
                    generated_count = primitive.clock.primitive_round_robin_polling!.terminal_swing_count;
                    return primitive.clock;
                }
            }
            return generateWithinBudget(withCount(below - 1));
        }
    };
    const pruningReport = () => ({ ...(primitive_attempt === undefined ? {} : { primitive_grouped_attempt: primitive_attempt }),
        ...(window_cycle_rejections.length === 0 ? {} : { window_cycle_limit_pruning: {
        requested_terminal_swing_count: requested_initial_count!, rejections: window_cycle_rejections,
    } }) });
    const initial_result = generateWithinBudget(config);
    if (initial_result === null) throw first_window_cycle_refusal ?? first_fractional_refusal!;
    if (first_fractional_refusal !== undefined && !initial_result.output_cycle_plan.fractional_swings_enabled) {
        throw fractionalSwingsWholeAt(first_fractional_refusal, initial_result.used_terminal_swing_count);
    }
    const initial_swing_count = window_cycle_frontier !== undefined && generated_count !== undefined
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
                    actual_output_items: initial_result.primitive_round_robin_polling === undefined ? initial_result.stability_check.actual_output_items
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
        if ((window_cycle_frontier !== undefined || first_fractional_refusal !== undefined) && generated_count !== undefined) swings = generated_count;

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


