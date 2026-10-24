import assert from "../common/assert";
import { Config } from "../config";
import { EnableControlOverrideConfig, EnableControlRange } from "../config/schema";
import { InserterClock, unplannedInserterClocks } from "./sequence/unplanned-inserter-clock";
import { createEntityRegistryFromConfig, MovingPickupPhases } from "./sequence/simulation-context";
import { Duration, OpenRange } from "../data-types";
import { Entity, EntityId } from "../entities";
import { Logger, defaultLogger } from "../common/logger";
import { StockRecording } from "./machine-stock";
import { InserterEnds, WakeUps, wakeUpsOfStock } from "./wake-ups";
import { judgeLongRun, judgeProvenCycle, LONG_RUN_SETTLE_SHARE, longRunPeriods } from "./long-run";
import { BackpressureLoss, BackpressureLossOptions, BackpressureLossReport, BackpressureLossVerdict, backpressureLossesOf, LossOutcome, lossLimitOf, reportOf, verdictOf } from "./backpressure-loss";
import { CIRCUIT_LATENCY_TICKS, SerializableClockWindows, rotateRanges, shiftRangesForCircuitLatency, subtickClockForPeriod, withBeltPickupSlack } from "./clock";
import { currentRunMemo } from "./plan/run-memo";
import { BlueprintGenerationResult, LCM_STABILITY_TOLERANCE, MAX_SIMULATION_TICKS, RunOptions, TrialRun, alwaysEnabledByConfig, checkedClock, clockOfPlan, coldControlledTrialBuild, planRun, provenRepeatBin, runBuild, trialRunOf, withInserterClocks } from "./plan/plan-run";
import { SimulationTick } from "./runner/simulation-tick";
import { simulationStateKey } from "./runner/steady-state";
import { loopInserterWindows } from "./candidates/loop-windows";
import { CLOCK_STARTS, ClockStart, StartDependence, StartOutcome, cycleOf, startVerdictOf, startsReachingTarget } from "./start-dependence";
import { movingPickupPhaseStarts } from "./moving-pickup-phase-starts";
import { canonicalVerificationJson } from "./verification-signature";
import { DeciderOrder, deciderBuildOrder, reversedDeciderOrder } from "./decider-order";
import { withChestDrillWindows } from "./chest-drill-windows";
import type { FullOutputChest } from "./full-output-chests";
import { ExportShortfall, exportShortfallOfBins, exportShortfallsOfRun, exportedItemsOf } from "./export-delivery";

/**
 * Number of clock start offsets the as-built check tries. Depending on how the clock lines up with the
 * machines when it starts, a factory can settle into different steady states (seen in game: 64/32 instead of 96).
 */
export const AS_BUILT_START_PHASES = 12;

/** Start phases for the confirming check; failing phases can be a narrow band that the quick check skips */
export const FULL_CHECK_START_PHASES = 112;


/**
 * What the trial of a clock on its build found, in the terms of GOALS.md: whether it holds its expected output, whether
 * it survives backpressure loss, the rate it runs the build at (goal 1), and its wake-ups (goal 2).
 */
export interface ClockAssessment {
    /**
     * The clock-only check (the build driven only by the exported clock windows) reaches the expected output, from
     * the modeled cold start: full input supplies, empty machines, buffers and hands, clock phase 0, and the configured
     * one-time self-ingredient seed (default 200), with sampled clock offsets and moving-lane phases.
     * Rates are assessed after model warm-up and checks.
     */
    holds: boolean;
    /**
     * Whether the clock gets back to its expected output after each loss of its build, and the losses it does not get
     * back from (see backpressure-loss.ts). Null when no loss was tried: the clock does not hold its expected output
     * to begin with, or the trials could not be run on it (then `backpressure_loss_not_tried` says why).
     */
    backpressure_loss: BackpressureLossVerdict | null;
    /**
     * Why the losses could not be tried on a clock that holds its expected output: the trials' error, such as a period
     * that does not repeat in whole ticks. Absent when they were tried, or the clock does not hold.
     */
    backpressure_loss_not_tried?: string;
    /** Items per second the exported clock moved in its clock-only run, over all copies; the target when it holds */
    items_per_second: number;
    /**
     * Wake-ups a minute, summed over the inserters of one copy of the build in the long run of the clock (see
     * wake-ups.ts); null when the clock had no long run. Fewer is better: each one is a machine waking an inserter
     * that a narrower window would have left disabled. Among the clocks that meet the target rate, the one with the
     * fewest is selected.
     */
    wake_ups_per_minute: number | null;
    /**
     * Where the clock gets to from the starts of CLOCK_STARTS (see start-dependence.ts); null when the config did not ask
     * for start dependence to be checked (`overrides.check_start_dependence`), and the clock was judged from the cold
     * start alone, or when the requested start checks could not run. Actual samples are in `starts`.
     */
    start_dependence: StartDependence | null;
}

/**
 * The one word for a clock (GOALS.md, "Backpressure Loss"): stable when it holds its expected output and gets back to
 * it by itself after every backpressure loss of its build (and, when the start dependence was checked, reaches it from every
 * start); no recovery when it holds and does not get back from some
 * loss; unstable when it does not hold or fails the sampled-start check. A clock the losses could not be tried on keeps
 * the word of what it holds, stable, and `backpressure_loss_not_tried` says why they were not: it ranks below every
 * clock tried and getting back, and above every clock tried and not (`recoveryUntried`, rank.ts).
 */
export type ClockVerdict = "stable" | "no recovery" | "unstable";

export function clockVerdictOf(assessment: ClockAssessment): ClockVerdict {
    // a clock that reaches its target from some starts only is not one to rely on: it is listed as unstable here, and
    // named start-dependent by `start_dependence`
    if (!assessment.holds || (assessment.start_dependence !== null && assessment.start_dependence.verdict !== "stable")) {
        return "unstable";
    }
    return assessment.backpressure_loss?.survives === false ? "no recovery" : "stable";
}

export interface AsBuiltStabilityCheck {
    /** Clock windows alone reach expected output from the sampled clock/lane phases and over the long run. */
    holds: boolean;
    /** Output of the first failing stock/clock start, or of the unshifted clock when all pass. */
    actual_output_items: number;
    /**
     * What `actual_output_items` is, on a clock assessed for listing (see `settledOutputOf`) that fails its first
     * check: the mean items a period over the judged part of the clock's long run, or, where its period is too long
     * for a long run, the one period the check measured. Absent on a check as the generator makes it.
     */
    output_basis?: "long-run mean" | "one period";
    /** The unshifted clock did not hold its first period: `actual_output_items` is that one period (see `withSettledOutput`) */
    first_check_failed?: true;
    /** Number of clock start phases simulated (stops at the first failure) */
    start_phases_checked: number;
    /** Clock offset of the first failing start phase */
    failed_start_offset?: number;
    /** Additional ordinary moving-lane stock starts checked, one pickup at a time. */
    pickup_phase_starts_checked?: number;
    /** Lane phases of the first failing stock start, by inserter id, in 1/32-tile units. */
    failed_pickup_phases?: Record<string, readonly [number, number]>;
    /** Periods after which the reported run repeats, when the simulation found the repeat; see SimulationStabilityCheck */
    repeat_periods?: number;
    /** Output items of the reported run over its repeat_periods periods; set when repeat_periods is more than 1 */
    repeat_output_items?: number;
    /**
     * The long run repeated a simulation state at a bin boundary (see runner/steady-state.ts), so its judged bins
     * are what the build does forever: its verdict is a proof, not a sample of 120 periods. Absent when the check
     * made no long run; false when the long run ran its full length without a state coming up again.
     */
    long_run_proven?: boolean;
    /** Clock periods in the repeating cycle the proven long run was judged on */
    long_run_cycle_periods?: number;
    /**
     * Every clock start phase of the whole period was checked, each resolved by proof: its own repeating cycle, or
     * a state met on another phase's proven orbit (see exhaustiveStartPhases). Absent when the check sampled its
     * start phases; false when some phase hit the cap unresolved and was judged on its last bin as a sample.
     */
    start_phases_proven?: boolean;
    /** Phases of the exhaustive check that hit its cap unresolved */
    unresolved_start_phases?: number;
    /**
     * How often the machines woke the inserters asleep on their wake-up lists (goal 2 of GOALS.md, see wake-ups.ts),
     * for one copy of the build over the judged part of the long run of the unshifted clock. Absent when the check
     * made no long run: the clock already failed its one-period check, or its period is too long for one.
     */
    wake_ups?: WakeUps;
    /** The chests the output goes into that nothing empties and that were full where the failing run ended */
    full_output_chests?: FullOutputChest[];
    /**
     * The export belts (belt lanes with a consumption rate) that received less than their consumers take, over the run
     * that failed the clock: its period, or the judged part of its long run. The clock moves its target and is not
     * stable. Absent when none fell short.
     */
    export_shortfalls?: ExportShortfall[];
}


/** A trial logs nothing but errors: it is one of many runs the generator makes of a clock */
const quietLogger = (logger: Logger): Logger => ({ log: () => { }, warn: () => { }, error: logger.error.bind(logger), debug: () => { } });

/**
 * Runs a build on clock windows alone, as its blueprint runs it in the game: what has windows is enabled by them, a
 * tick of the circuit network later, a fuel inserter by its fuel clock, and everything else is always enabled (see
 * `buildAsBuiltConfig`). Such a run plans nothing and checks nothing of its own; `options` say what it records and
 * how long it runs. It starts as the staged scaffold does: the machines empty and the clock from tick 0 (`cold_start`),
 * unless the options name a start of their own (`keep_output_buffers`, `start_stock`).
 */
export function runClockOnBuild(
    config: Config,
    windows: Map<string, OpenRange[]>,
    period: number,
    logger: Logger,
    options: RunOptions = {},
    /** Fuel clocks to run the fuel inserters on; without them the run makes its own from its plan */
    fuel_clocks?: ReadonlyMap<string, InserterClock>,
): TrialRun {
    const named_start = options.keep_output_buffers === true || options.start_stock !== undefined;
    // a clock of whole ticks is counted by its own period, also where the plan's is not whole (a clock rounded down)
    return trialRunOf(runBuild(buildAsBuiltConfig(config, windows, period, fuel_clocks, options.decider_order),
        { logger: quietLogger(logger), cold_start: !named_start, ...(Number.isInteger(period) && { period_ticks: period }), ...options }));
}

/** Ticks a clock is run on its own to see that the build keeps up: ten minutes of game time */
export const FREE_RUNNING_CHECK_TICKS = 36000;

/**
 * Ticks the long run lasts when it verifies a clock WITH the windows of the inserters of a loop (see
 * `trialWithLoopWindows`): twice the standard check, the length of one game recording. The windows are an
 * optimisation, so they have to clear a longer run than the clock they are added to: with the standard length a
 * variant of the agricultural science sample (egg biochambers at speed 72, stack size 12 on the inserters into the
 * science biochamber) kept windows that came up a hand or more short in two periods of 200. A longer run is still not
 * a proof, only a smaller chance of keeping windows that drift.
 */
export const LOOP_WINDOW_CHECK_TICKS = 2 * FREE_RUNNING_CHECK_TICKS;

/**
 * The long run stops at this many periods: a drift shows within a hundred, and short periods would run thousands.
 * A fractional period is run for more of them where it takes more for the judged part to hold one whole repeat of
 * the period, up to LONG_RUN_MAX_TICKS (see longRunPeriods).
 */
const LONG_RUN_MAX_PERIODS = 120;

/** Periods the long run of a clock of this period lasts when it is asked to cover `check_ticks` ticks (see longRunPeriods) */
export function longRunPeriodsOf(period: number, check_ticks: number = FREE_RUNNING_CHECK_TICKS): number {
    const max_periods = Math.floor((MAX_SIMULATION_TICKS - 1) / period);
    // a longer check than the standard one is not cut short by the cap on periods, which short periods would hit first
    const wanted_periods = Math.ceil(check_ticks / period);
    return longRunPeriods(period, subtickClockForPeriod(period), Math.min(check_ticks > FREE_RUNNING_CHECK_TICKS ? wanted_periods : Math.min(LONG_RUN_MAX_PERIODS, wanted_periods), max_periods), max_periods);
}

/**
 * A build does not always repeat with its clock, so one period says little about it: in game builds with inserters
 * left always enabled held their rate for thousands of ticks before a period came up a hand or two short, and a
 * machine with spare speed can drift for dozens of periods. The clock is run for ten minutes of game time or 120
 * periods instead, longer for a fractional period whose repeat needs it, and judged on what follows the first third:
 * in bins of whole ticks (a period, or the repeat of a fractional one), none more than a hand off what it expects
 * and all of them together within a hand.
 *
 * The run watches for the simulation state repeating at a bin boundary (see `detect_repeat`): a build on fixed
 * clocks repeats forever from a repeated state, so the run stops there and the bins of the repeating cycle are
 * judged instead, as a proof (`proven`) rather than a sample — every cycle bin within a hand, and the cycle as a
 * whole exactly at its expected output (see judgeProvenCycle). A run that never repeats within its periods is
 * judged as before.
 */
function longRunOfFreeRunningBuild(
    config: Config,
    decider_windows: Map<string, OpenRange[]>,
    period: number,
    expected_output_items: number,
    logger: Logger,
    check_ticks: number = FREE_RUNNING_CHECK_TICKS,
    /** How the run starts; the cold start of the staged scaffold with the default orders by default */
    start: Pick<RunOptions, "competing_takers_order" | "decider_order"> = {},
): {
    keeps_up: boolean;
    output_items_per_period: number;
    /** Items the output inserters dropped in each judged bin */ judged: number[];
    off_bins: number;
    span_items: number;
    stock: StockRecording;
    /** The judged bins repeat forever: the verdict is a proof of the build's eternity, not a sample of 120 periods */
    proven: boolean;
    /** Clock periods in the proven repeating cycle; null when the run never repeated */
    cycle_periods: number | null;
    /** Tick of the run the first judged bin starts at, for judging the same window the verdict is of */
    first_judged_tick: number;
    /** The chests the output goes into that nothing empties and that were full where the run ended */
    full_output_chests: FullOutputChest[] | undefined;
    /** The export belts that received less than their consumers take over the judged part; undefined when none did */
    export_shortfalls: ExportShortfall[] | undefined;
} | null {
    // every build: a machine with spare speed over its plan can drift for dozens of periods before it shows
    const registry = createEntityRegistryFromConfig(config);
    // a fractional period repeats in whole ticks only every few periods, as its subtick clock counts them
    const repeat = subtickClockForPeriod(period);
    const periods = longRunPeriodsOf(period, check_ticks);
    if (periods <= 1) {
        return null;
    }
    // only its stock is read, which names the state of every inserter itself
    const run = runClockOnBuild(config, decider_windows, period, logger, { simulate_periods: periods, machine_stock: true, factorio_states: false, detect_repeat: true, ...start });
    const stock = run.machine_stock;
    if (!stock) {
        return null;
    }
    // what the output inserters drop, counted as the recordings of a build are: by whole periods of the clock that
    // is built, which for a fractional period is the subtick clock and its repeat (see long-run.ts)
    const makers = new Set(registry.getAll().filter(Entity.isMachine)
        .filter(machine => machine.output.item_name === config.target_output.recipe).map(machine => machine.entity_id.id));
    const output_inserters = registry.getAll().filter(Entity.isInserter)
        .filter(it => makers.has(it.source.entity_id.id) && !EntityId.isMachine(it.sink.entity_id));
    const output_ids = new Set(output_inserters.map(it => it.entity_id.id));
    const hand = Math.max(1, ...output_inserters.map(it => it.metadata.stack_size));
    const held = stock.inserters.filter(it => output_ids.has(it.inserter_id)).map(it => it.held);
    // the first third of the run carries its start-up, which a loop can take a dozen periods to work out of, as a
    // build does in game before a recording is settled; a build is judged by what follows: the span as a whole has
    // to come out within a hand, and no bin further off than a hand. A run that repeated is judged on its cycle.
    const verdict = run.state_repeat !== undefined
        ? judgeProvenCycle(held, stock.ticks, run.state_repeat, expected_output_items, hand)
        : judgeLongRun(held, stock.ticks, period, repeat, expected_output_items, hand);
    const proven = run.state_repeat !== undefined;
    // the exports are judged in the bins of the output: a belt with a consumption rate has to receive it in every bin
    const exported = exportedItemsOf(registry, output_ids);
    const export_shortfalls = exportShortfallsOfRun(exported, new Map(stock.inserters.map(it => [it.inserter_id, it.held])),
        { first_tick: verdict.first_judged_tick, bin_ticks: verdict.bin_ticks, ticks: stock.ticks, count: verdict.judged.length, proven });
    if (export_shortfalls.length > 0) {
        logger.log(`Free running build: ${export_shortfalls.map(it => `belt ${it.belt_id} got ${Number(it.delivered_per_second.toFixed(2))} ${it.item} a second, consumers take ${it.expected_per_second}`).join("; ")}`);
    }
    const bins = verdict.bin_ticks === null ? "span(s)" : verdict.periods_per_bin === 1 ? "periods" : `repeats of ${verdict.periods_per_bin} periods (${verdict.bin_ticks} ticks)`;
    logger.log(`Free running build over ${verdict.judged.length} ${bins}${proven ? " (repeats forever)" : ""}: moved ${verdict.total} of ${verdict.expected_total}, ${verdict.off_bins.length} more than a hand off the expected ${verdict.expected_per_bin} (${verdict.off_bins.map(it => `${it.index}: ${it.items}`).join(", ") || "none"})`);
    return {
        keeps_up: verdict.keeps_up && export_shortfalls.length === 0,
        output_items_per_period: verdict.output_items_per_period,
        judged: verdict.judged,
        off_bins: verdict.off_bins.length,
        span_items: verdict.total - verdict.expected_total,
        stock,
        proven,
        cycle_periods: run.state_repeat === undefined ? null : run.state_repeat.cycle_bins * run.state_repeat.periods_per_bin,
        first_judged_tick: verdict.first_judged_tick,
        full_output_chests: run.stability_check.full_output_chests,
        export_shortfalls: export_shortfalls.length > 0 ? export_shortfalls : undefined,
    };
}

/**
 * Runs a build driven only by clock windows, as its blueprint does in game, for a number of periods, and returns what
 * every machine and inserter held after each tick. For laying the simulator against a recording of the same clock.
 */
export function simulateClockOnly(
    config: Config,
    clock_windows: SerializableClockWindows,
    period_ticks: number,
    periods: number,
    logger: Logger = defaultLogger,
    /**
     * How the build is when the clock starts. By default as the staged scaffold starts: the machines, buffers and hands
     * empty and the clock from tick 0 (`cold_start`), the inserters that compete for a product served in
     * `competing_takers_order`. `keep_output_buffers` leaves the machines the output is taken from as full as they get
     * when nothing takes it, and starts the clock at once. `start_stock` names what machines hold instead, to start in a
     * state the game was recorded in: with `warmup_periods: 0` the first tick of the run is the first tick after that
     * state.
     */
    start: Pick<RunOptions, "cold_start" | "competing_takers_order" | "keep_output_buffers" | "warmup_periods" | "start_stock"> = {},
): StockRecording {
    const windows = new Map(Object.entries(clock_windows).map(([entity_id, ranges]) =>
        [entity_id, ranges.map(range => OpenRange.from(range.start, range.end))] as const));
    const run = runClockOnBuild(
        { ...config, overrides: { ...config.overrides, derive_clock_windows: false } }, windows, period_ticks, logger,
        { ...start, simulate_periods: periods, machine_stock: true },
    );
    return run.machine_stock!;
}

/**
 * The clock with the windows given, built as they are, and checked as the generator checks its own: for a clock that
 * it did not make, such as one tightened by hand, or one of its own with windows changed. The windows have to be of
 * the period the config is planned on (`overrides.terminal_swing_count` sets the output swings per cycle it has).
 */
export function clockFromWindows(
    config: Config,
    clock_windows: SerializableClockWindows,
    period_ticks: number,
    logger: Logger = defaultLogger,
): BlueprintGenerationResult {
    const plan = planRun({ ...config, overrides: { ...config.overrides, derive_clock_windows: false } }, { logger });
    // the windows are built as they are: nothing is added to them, so the clock goes without belt pickup slack, and the
    // inserters of a loop without windows stay always enabled
    const clock = clockOfPlan(plan, { belt_pickup_slack: "never" });
    const windows = new Map(Object.entries(clock_windows).map(([entity_id, ranges]) =>
        [entity_id, ranges.map(range => OpenRange.from(range.start, range.end))] as const));
    const result = checkedClock(plan, clock, windows, { logger, verify_as_built: true, loop_windows: false });
    assert(result.simulation_duration.ticks === period_ticks,
        `The windows are of a clock of ${period_ticks} ticks, and the config is planned on one of ${result.simulation_duration.ticks}`);
    return result;
}

/**
 * Whether a clock survives backpressure loss (GOALS.md): the build is run on the windows alone, as its blueprint runs
 * it, once undisturbed and once for every loss it can have (each item that comes off a belt or out of a chest stops
 * arriving, each item it puts on a belt or in a chest is not taken away), and has to be back at exactly its expected
 * output after each. Ordinary moving pickups are also tried with independent lane phases, one pickup at a time. The
 * losses stop at the first the clock does not get back from; the ones left are reported as not tried.
 * See backpressure-loss.ts for how a loss is run and judged.
 *
 * The config has to be the one the clock was planned on, as for clockFromWindows: the plan gives a fuel inserter its
 * clock. `expected_output_items` is what the output inserters drop in a period of the clock when it holds.
 */
export function backpressureLossOf(
    config: Config,
    clock_windows: SerializableClockWindows,
    period_ticks: number,
    expected_output_items: number,
    logger: Logger = defaultLogger,
    options: Omit<BackpressureLossOptions, "loss" | "period_ticks" | "expected_output_items"> = {},
    /** Called before the run of each loss, the one with nothing cut included */
    on_loss?: (loss: BackpressureLoss, index: number, total: number) => void,
): BackpressureLossReport {
    const windows = new Map(Object.entries(clock_windows).map(([entity_id, ranges]) =>
        [entity_id, ranges.map(range => OpenRange.from(range.start, range.end))] as const));
    const check_config = { ...config, overrides: { ...config.overrides, derive_clock_windows: false } };
    // each loss on a run of its own, so that a clock one loss breaks is not broken for the next
    const outcomeOf = (loss: BackpressureLossOptions["loss"], phases?: MovingPickupPhases): LossOutcome => runClockOnBuild(check_config, windows, period_ticks, logger, {
        factorio_states: false,
        moving_pickup_phases: phases,
        backpressure_loss: { loss_limit_ticks: loss_limit?.ticks, ...options, loss, period_ticks, expected_output_items },
    }).backpressure_loss!;
    const phase_starts = [...movingPickupPhaseStarts(config)];
    const registry = createEntityRegistryFromConfig(config);
    const losses = backpressureLossesOf(registry, config.target_output.recipe);
    // a build whose items spoil is tried with losses shorter than its loss limit only
    const loss_limit = lossLimitOf(registry);
    const tried = (loss: BackpressureLoss, index: number): LossOutcome => {
        on_loss?.(loss, index, losses.length + 1);
        const canonical = outcomeOf(loss);
        if (!canonical.recovers || phase_starts.length === 0) return canonical;
        let ticks = canonical.ticks, recovery = canonical.recovered_after_bins!, stopped = canonical.stopped_after_ticks;
        for (const [index, phases] of phase_starts.entries()) {
            const outcome = outcomeOf(loss, phases);
            ticks += outcome.ticks;
            if (!outcome.recovers) return {...outcome, ticks, pickup_phase_starts_checked: index + 1,
                failed_pickup_phases: Object.fromEntries(phases)};
            recovery = Math.max(recovery, outcome.recovered_after_bins!);
            stopped = stopped === null || outcome.stopped_after_ticks === null ? null : Math.max(stopped, outcome.stopped_after_ticks);
        }
        return {...canonical, ticks, recovered_after_bins: recovery, stopped_after_ticks: stopped,
            pickup_phase_starts_checked: phase_starts.length};
    };
    const undisturbed = tried({ kind: "none" }, 0);
    // The losses are tried in the order backpressureLossesOf gives: the supplies, then the outputs, the product's first.
    // Of the losses the clocks of the samples do not get back from, the supplies are the more often, and no other order
    // saves more than a point and a half of the trials. They stop at the first the clock does not get back from at the
    // modeled phase: it does not recover whatever the rest do, and the rest are reported as not tried. A loss it gets back
    // from there and not from another lane phase does not stop them, so that this cause stays apart from the others
    // (see why-not-stable.ts).
    const outcomes: LossOutcome[] = [];
    for (const loss of losses) {
        const outcome = tried(loss, outcomes.length + 1);
        outcomes.push(outcome);
        if (!outcome.recovers && outcome.failed_pickup_phases === undefined) {
            break;
        }
    }
    return reportOf(period_ticks, expected_output_items, undisturbed, outcomes, loss_limit, losses.slice(outcomes.length));
}

/** The machines at the ends of every inserter of the config */
function inserterEnds(config: Config): InserterEnds[] {
    const machineId = (entity_id: EntityId) => EntityId.isMachine(entity_id) ? entity_id.id : null;
    return createEntityRegistryFromConfig(config).getAll().filter(Entity.isInserter).map(inserter => ({
        inserter_id: inserter.entity_id.id,
        source_machine_id: machineId(inserter.source.entity_id),
        sink_machine_id: machineId(inserter.sink.entity_id),
    }));
}


/**
 * Where a clock gets to from the starts of CLOCK_STARTS: each is run as the long run of the clock is, from that start,
 * and judged on what follows its first third. Every start is judged on the same checks (`startsReachingTarget`): the
 * cold start on all the checks of the generator (`cold_holds`), the others on their long run, unless the cold start
 * fails a check that is not about the start, which fails every start. A clock whose period is too long for
 * a long run is judged on one period. `expected_output_items` is what a period has to move.
 */
export function startDependenceOf(
    config: Config,
    clock_windows: SerializableClockWindows,
    period: number,
    expected_output_items: number,
    cold_holds: boolean,
    logger: Logger,
    starts: readonly ClockStart[] = CLOCK_STARTS,
): StartDependence {
    const windows = new Map(Object.entries(clock_windows).map(([entity_id, ranges]) =>
        [entity_id, ranges.map(range => OpenRange.from(range.start, range.end))] as const));
    const check_config = { ...config, overrides: { ...config.overrides, derive_clock_windows: false } };
    // a clock stands at another place of a period of a whole number of ticks only; a fractional one is tried unshifted
    const tried = starts.filter(start => start.clock_shift === 0 || Number.isInteger(period));
    const runs = tried.map(start => {
        const standing = new Map(Array.from(windows, ([key, ranges]) =>
            [key, start.clock_shift === 0 ? ranges : rotateRanges(ranges, period - start.clock_shift % period, period)] as const));
        const order = { competing_takers_order: start.competing_takers_order, decider_order: start.decider_order };
        const long_run = longRunOfFreeRunningBuild(check_config, standing, period, expected_output_items, logger, FREE_RUNNING_CHECK_TICKS, order);
        const keeps_up = long_run !== null
            ? long_run.keeps_up
            : runClockOnBuild(check_config, standing, period, logger, { factorio_states: false, ...order }).stability_check.holds;
        return { long_run, keeps_up };
    });
    // the first start is the one the clock is judged on: all its checks decide, not the long run alone; a clock that
    // fails one of the checks that are not about the start fails from every start
    const reaching = startsReachingTarget(cold_holds, runs.map(it => it.keeps_up));
    const outcomes: StartOutcome[] = tried.map((start, index) => {
        const { long_run } = runs[index];
        return {
            id: start.id,
            label: start.label,
            reaches_target: reaching[index],
            output_items_per_period: long_run?.output_items_per_period ?? null,
            cycle: long_run === null ? null : cycleOf(long_run.judged),
            off_bins: long_run === null ? null : { count: long_run.off_bins, of: long_run.judged.length },
            span_items: long_run?.span_items ?? null,
            long_run_keeps_up: long_run?.keeps_up ?? null,
        };
    });
    return { verdict: startVerdictOf(outcomes), starts: outcomes, expected_output_items };
}

/** Crossings a phase run of the exhaustive check may take to resolve before it is judged on its last bin instead */
const PHASE_PROOF_CAP_CROSSINGS = 48;

/** What checking every start phase of the period found (see exhaustiveStartPhases) */
export interface ExhaustiveStartPhasesOutcome {
    /** The eternal cycle every phase settles into holds the expected output; false as soon as one does not */
    holds: boolean;
    /** Phases simulated; the whole period, or fewer when one failed */
    phases_checked: number;
    /** First failing phase, as the windows are rotated for it */
    failed_start_offset?: number;
    /** Items a period of the failing phase's cycle moved */
    failed_output_items?: number;
    /** Every checked phase was resolved by proof: its own repeating cycle, or a merge into a proven orbit */
    proven: boolean;
    /** Phases that hit the cap unresolved and were judged on their last bin as a sample */
    unresolved_phases: number;
    /** Phases resolved by meeting a state of another phase's proven orbit */
    merged_phases: number;
    /** Ticks simulated over all phases */
    ticks: number;
}

/**
 * Checks every clock start phase of the period, not a sample of them: in game a blueprint's machines can meet the
 * clock at any of its `period` ticks, and each meeting is a start phase. Exhausting them is affordable because a
 * phase's run is not run to a verdict of its own: it stops at the first crossing of the clock's phase 0 whose
 * simulation state was seen on a phase already resolved, and inherits that phase's eternal cycle — most phases fall
 * into the orbit of an earlier one within a few periods. A phase no earlier orbit catches runs until a crossing
 * repeats a state of its own run, which proves its cycle: every bin of it (a period, or the merge with own fuel
 * clocks) has to be within the stability tolerance of the expected output. States of different phases compare at
 * these crossings because every clock of the build stands at the same place there; with fuel clocks of their own
 * moduli they do not, so those builds resolve each phase by its own repeat alone. Null when the check does not
 * apply: a fractional period, or a build not on fixed clocks throughout, keeps the sampled check.
 *
 * What stays sampled here: moving-lane phases (varied one pickup at a time elsewhere), and the competing-takers
 * order, which is the one the game was observed to use.
 */
export function exhaustiveStartPhases(
    config: Config,
    decider_windows: Map<string, OpenRange[]>,
    period: number,
    logger: Logger,
    report?: (checked: number, total: number) => void,
): ExhaustiveStartPhasesOutcome | null {
    if (!Number.isInteger(period)) {
        return null;
    }
    const as_built = buildAsBuiltConfig(config, decider_windows, period);
    const proof_bin = provenRepeatBin(as_built, period);
    if (proof_bin === null) {
        return null;
    }
    const quiet = quietLogger(logger);
    // one run with the full machinery gives the crafting cycle plan, the expected output and the output inserters,
    // which rotating the windows changes nothing of; every phase's cold build reuses them
    const base = runBuild(as_built, { logger: quiet, cold_start: true, factorio_states: false });
    const stride_periods = proof_bin.ticks / period;
    // the belts with a consumption rate are held to what their consumers take, in the bins the output is
    const exported = exportedItemsOf(base.simulation_context.entity_registry, base.output_inserter_ids);
    // at a crossing of one phase's run a fuel clock of its own modulus stands elsewhere than at another's, so only
    // a build whose clocks all share the period merges phases into one another's orbits
    const can_merge = stride_periods === 1;
    const expected_per_bin = base.total_expected_output * stride_periods;
    const tolerance = LCM_STABILITY_TOLERANCE * stride_periods;

    const orbit_of = new Map<string, number>();
    const orbit_holds: boolean[] = [];
    const outcome: ExhaustiveStartPhasesOutcome = {
        holds: true, phases_checked: 0, proven: true, unresolved_phases: 0, merged_phases: 0, ticks: 0,
    };

    for (let offset = 0; offset < period && outcome.holds; offset++) {
        const rotated_config = offset === 0 ? as_built : buildAsBuiltConfig(config,
            new Map(Array.from(decider_windows, ([key, ranges]) => [key, rotateRanges(ranges, offset, period)] as const)), period);
        const context = coldControlledTrialBuild(rotated_config, base.crafting_cycle_plan, base.recipe_lcm, {}, quiet);
        const output_states = context.inserters.map(it => it.inserter_state)
            .filter(state => base.output_inserter_ids.has(state.entity_id.id));
        const dropped = () => output_states.reduce((sum, state) => sum + state.items_dropped, 0);
        const filler_states = exported.map(it => context.inserters.map(inserter => inserter.inserter_state).filter(state => it.filler_ids.includes(state.entity_id.id)));
        const exported_drops = () => filler_states.map(states => states.reduce((sum, state) => sum + state.items_dropped, 0));
        const exports_at: number[][] = [];
        // the exports that fell short in the bins `from` on (a cumulative count at each crossing, ending with `last`)
        const exports_short = (from: number, last: number[], proven: boolean) => exported.some((it, at) => {
            const counts = exports_at.slice(from).map(counted => counted[at]).concat(last[at]);
            const delivered = counts.slice(1).map((count, index) => count - counts[index]);
            return delivered.length > 0 && exportShortfallOfBins(it, delivered, proof_bin.ticks, proven) !== null;
        });
        const control_logic = new SimulationTick(context);
        const now = () => context.tick_provider.getCurrentTick();

        // the rotated windows enable at tick t what the unrotated enable at t - offset, so the unrotated clock's
        // phase 0 falls on the local ticks offset, offset + bin, ...: the crossings every phase's states compare at
        const own_crossing = new Map<string, number>();
        const keys_of_run: string[] = [];
        const drops_at: number[] = [];
        let run_holds: boolean | null = null;
        let run_output: number | null = null;
        let run_proven = true;
        for (let crossing = 0; run_holds === null; crossing++) {
            const until = offset + crossing * proof_bin.ticks;
            while (now() < until) {
                control_logic.executeForTick();
            }
            const key = simulationStateKey(context);
            const earlier = own_crossing.get(key);
            if (earlier !== undefined) {
                // the run's own cycle: the bins from `earlier` repeat forever
                const cycle = drops_at.slice(earlier + 1).concat(dropped()).map((drops, index, all) =>
                    drops - (index === 0 ? drops_at[earlier] : all[index - 1]));
                run_holds = cycle.every(items => Math.abs(items - expected_per_bin) <= tolerance) && !exports_short(earlier, exported_drops(), true);
                run_output = Math.round((dropped() - drops_at[earlier]) / (cycle.length * stride_periods));
                break;
            }
            const orbit = can_merge ? orbit_of.get(key) : undefined;
            if (orbit !== undefined) {
                run_holds = orbit_holds[orbit];
                outcome.merged_phases++;
                break;
            }
            if (crossing >= PHASE_PROOF_CAP_CROSSINGS) {
                // unresolved: judged on its last bin, a sample as the shifted runs of the sampled check are
                const last_bin = dropped() - drops_at[drops_at.length - 1];
                run_holds = Math.abs(last_bin - expected_per_bin) <= tolerance && !exports_short(exports_at.length - 1, exported_drops(), false);
                run_output = Math.round(last_bin / stride_periods);
                run_proven = false;
                outcome.unresolved_phases++;
                break;
            }
            own_crossing.set(key, crossing);
            keys_of_run.push(key);
            drops_at.push(dropped());
            exports_at.push(exported_drops());
        }
        if (can_merge && run_proven) {
            const orbit_id = orbit_holds.push(run_holds!) - 1;
            for (const key of keys_of_run) {
                orbit_of.set(key, orbit_id);
            }
        }
        outcome.ticks += now();
        outcome.phases_checked++;
        outcome.proven &&= run_proven;
        report?.(outcome.phases_checked, period);
        if (run_holds === false) {
            outcome.holds = false;
            outcome.failed_start_offset = offset;
            if (run_output !== null) {
                outcome.failed_output_items = run_output;
            }
        }
    }
    logger.log(`Exhaustive start phases: ${outcome.phases_checked} of ${period} checked, ${outcome.merged_phases} merged into earlier orbits, `
        + `${outcome.unresolved_phases} unresolved, ${outcome.ticks} ticks${outcome.holds ? "" : `, failed at offset ${outcome.failed_start_offset}`}`);
    return outcome;
}

/**
 * The stability check of a lane-phase start's run, judged over its repeating cycle where the run went on with nothing
 * cut (see `pickup_phase_cycles` of runAsBuiltCheck): a run that holds its first period but does not stay at the
 * expected output does not hold, and reports the lowest period of the cycle it ends in.
 */
function overItsCycle(run: TrialRun): TrialRun["stability_check"] {
    const cycle = run.backpressure_loss;
    if (!run.stability_check.holds || cycle === undefined || cycle.recovers) {
        return run.stability_check;
    }
    const ends = cycle.trials[0]?.ends_in ?? [];
    const export_shortfalls = cycle.trials[0]?.export_shortfalls;
    return {
        ...run.stability_check,
        holds: false,
        actual_output_items: ends.length > 0 ? Math.min(...ends) : run.stability_check.expected_output_items - 1,
        repeat_periods: ends.length || undefined,
        repeat_output_items: ends.length > 1 ? ends.reduce((sum, items) => sum + items, 0) : undefined,
        ...(export_shortfalls !== undefined && { export_shortfalls }),
    };
}

/**
 * The clock-only check of a clock: the build driven only by the decider windows, first with the clock as planned and
 * then with the whole clock shifted to other start offsets relative to the machines' initial state, and, when the
 * unshifted run holds, over a long run (`longRunOfFreeRunningBuild`), which counts the wake-ups. Stops at the first
 * start phase that fails. Moving lane phases are also varied per pickup, without enumerating joint starts across
 * different pickups. Fractional periods are only checked unshifted.
 *
 * With CLOCK_PROOF_PHASES=1 the shifted start offsets are not sampled: every phase of the period is checked by
 * proof instead (see exhaustiveStartPhases), where that check applies.
 *
 * With `pickup_phase_cycles` each lane-phase start is judged over its repeating cycle, not its first period: its run
 * goes on with nothing cut, as the loss report's undisturbed run does (see backpressureLossOf), and a start that does
 * not stay at the expected output fails. Observed windows ask for it: they are read off a run from one lane phase, and
 * on the express mirrored moving over-the-hood pickup windows read that way held their first period from every lane
 * phase but repeated six periods of 112 and one of 96 from nine of them, as the game does after a loss.
 */
export function runAsBuiltCheck(
    config: Config,
    decider_windows: Map<string, OpenRange[]>,
    period: number,
    logger: Logger,
    start_phases: number = AS_BUILT_START_PHASES,
    report?: (checked: number, total: number) => void,
    long_run_ticks: number = FREE_RUNNING_CHECK_TICKS,
    /**
     * A check that already PASSED on exactly these windows, config and period: its unshifted run and pickup phase
     * starts are taken over instead of being run again, and so is its long run where it made one as long as this
     * check's. The start phases are still this check's own: their step differs with the count of phases.
     */
    passed?: { run: AsBuiltRun; long_run_ticks: number },
    pickup_phase_cycles: boolean = false,
): AsBuiltRun {
    // the drills into chests run on the windows made from their takers' in these windows, as the export gives them
    decider_windows = withChestDrillWindows(config, decider_windows, period);
    const step = Math.max(1, Math.floor(period / start_phases));
    const total = Math.min(start_phases, Math.floor((period - 1) / step) + 1);
    const result = passed !== undefined ? passed.run.result : runClockOnBuild(config, decider_windows, period, logger);
    const check: AsBuiltStabilityCheck = {
        holds: result.stability_check.holds,
        actual_output_items: result.stability_check.actual_output_items,
        start_phases_checked: 1,
        ...(!result.stability_check.holds && { first_check_failed: true as const }),
        repeat_periods: result.stability_check.repeat_periods,
        repeat_output_items: result.stability_check.repeat_output_items,
    };
    report?.(1, total);
    if (!check.holds && result.stability_check.full_output_chests !== undefined) {
        check.full_output_chests = result.stability_check.full_output_chests;
    }
    if (result.stability_check.export_shortfalls !== undefined) {
        check.export_shortfalls = result.stability_check.export_shortfalls;
    }
    let stock: StockRecording | undefined;
    if (check.holds) for (const phases of movingPickupPhaseStarts(config)) {
        if (passed !== undefined) {
            // the handed-over check asked from this start and it held
            check.pickup_phase_starts_checked = (check.pickup_phase_starts_checked ?? 0) + 1;
            continue;
        }
        const shifted = runClockOnBuild(config, decider_windows, period, logger,
            {moving_pickup_phases: phases, factorio_states: false, ...(pickup_phase_cycles && {backpressure_loss:
                {loss: {kind: "none"}, period_ticks: period, expected_output_items: result.stability_check.expected_output_items}})});
        check.pickup_phase_starts_checked = (check.pickup_phase_starts_checked ?? 0) + 1;
        const judged = overItsCycle(shifted);
        if (!judged.holds) {
            check.holds = false;
            check.actual_output_items = judged.actual_output_items;
            check.failed_pickup_phases = Object.fromEntries(phases);
            if (judged.export_shortfalls !== undefined) {
                check.export_shortfalls = judged.export_shortfalls;
            }
            if (shifted.stability_check.full_output_chests !== undefined) {
                check.full_output_chests = shifted.stability_check.full_output_chests;
            }
            if (shifted.stability_check.export_shortfalls !== undefined) {
                check.export_shortfalls = shifted.stability_check.export_shortfalls;
            }
            check.repeat_periods = judged.repeat_periods;
            check.repeat_output_items = judged.repeat_output_items;
            break;
        }
    }
    if (check.holds) {
        if (passed !== undefined && passed.long_run_ticks === long_run_ticks) {
            // the handed-over check made this long run and the build kept up in it
            stock = passed.run.stock;
            if (stock) {
                check.wake_ups = passed.run.check.wake_ups;
                check.long_run_proven = passed.run.check.long_run_proven;
                check.long_run_cycle_periods = passed.run.check.long_run_cycle_periods;
            }
        } else {
            // no long run when none is asked for (a quick trial of a search)
            const long_run = long_run_ticks > 0 ? longRunOfFreeRunningBuild(config, decider_windows, period, result.stability_check.expected_output_items, logger, long_run_ticks) : null;
            stock = long_run?.stock;
            if (long_run && stock) {
                // judged as the long run is: the proven cycle, or what follows the start-up of a sampled run
                check.wake_ups = wakeUpsOfStock(stock, inserterEnds(config),
                    long_run.proven ? long_run.first_judged_tick : Math.floor(stock.ticks / LONG_RUN_SETTLE_SHARE));
                check.long_run_proven = long_run.proven;
                if (long_run.cycle_periods !== null) {
                    check.long_run_cycle_periods = long_run.cycle_periods;
                }
            }
            if (long_run && !long_run.keeps_up) {
                check.holds = false;
                check.actual_output_items = long_run.output_items_per_period;
                if (long_run.full_output_chests !== undefined) {
                    check.full_output_chests = long_run.full_output_chests;
                }
                if (long_run.export_shortfalls !== undefined) {
                    check.export_shortfalls = long_run.export_shortfalls;
                }
            }
        }
    }
    if (!check.holds) {
        check.failed_start_offset = 0;
        return { result, check, stock };
    }

    if (typeof process !== "undefined" && process.env?.CLOCK_PROOF_PHASES === "1") {
        const exhaustive = exhaustiveStartPhases(config, decider_windows, period, logger, report);
        if (exhaustive !== null) {
            check.start_phases_checked = exhaustive.phases_checked;
            check.start_phases_proven = exhaustive.proven;
            if (exhaustive.unresolved_phases > 0) {
                check.unresolved_start_phases = exhaustive.unresolved_phases;
            }
            if (!exhaustive.holds) {
                check.holds = false;
                check.failed_start_offset = exhaustive.failed_start_offset;
                if (exhaustive.failed_output_items !== undefined) {
                    check.actual_output_items = exhaustive.failed_output_items;
                }
            }
            return { result, check, stock };
        }
    }
    for (let offset = step; offset < period && check.start_phases_checked < start_phases; offset += step) {
        const rotated = new Map(Array.from(decider_windows, ([key, ranges]) => [key, rotateRanges(ranges, offset, period)] as const));
        // only its output count is read
        const shifted = runClockOnBuild(config, rotated, period, logger, { factorio_states: false });
        check.start_phases_checked++;
        report?.(check.start_phases_checked, total);
        if (!shifted.stability_check.holds) {
            check.holds = false;
            check.actual_output_items = shifted.stability_check.actual_output_items;
            check.failed_start_offset = offset;
            if (shifted.stability_check.full_output_chests !== undefined) {
                check.full_output_chests = shifted.stability_check.full_output_chests;
            }
            if (shifted.stability_check.export_shortfalls !== undefined) {
                check.export_shortfalls = shifted.stability_check.export_shortfalls;
            }
            check.repeat_periods = shifted.stability_check.repeat_periods;
            check.repeat_output_items = shifted.stability_check.repeat_output_items;
            break;
        }
    }
    return { result, check, stock };
}

/**
 * The windows of the inserters that take out of a loop are an optimisation, kept when the build passes the same check
 * with them as it did without: the long run of the check just made (`run`) gives the output of every machine, so no
 * other run is needed to make them. Returns the check with them, the windows with theirs in, their ids and item names
 * (identical windows and items share one combinator, as the nutrient inserters of the egg biochambers do), or null when
 * there are none or the check with them does not pass as without (see `loopInserterWindows`). Whether the clock with
 * them gets back from a loss is judged where the clock is assessed (see `runAlternativeOf`).
 */
export function trialWithLoopWindows(
    config: Config,
    windows: Map<string, OpenRange[]>,
    period: number,
    run: { check: AsBuiltStabilityCheck; stock?: StockRecording },
    start_phases: number,
    logger: Logger,
    report?: (detail: string) => void,
    /** Judge each lane-phase start over its repeating cycle (see runAsBuiltCheck) */
    pickup_phase_cycles: boolean = false,
): {
    result: TrialRun;
    check: AsBuiltStabilityCheck;
    stock?: StockRecording;
    windows: Map<string, OpenRange[]>;
    loop_windows: NonNullable<BlueprintGenerationResult["loop_windows"]>;
    item_names: Map<string, string>;
} | null {
    if (run.stock === undefined) {
        return null;
    }
    const loop = loopInserterWindows(config, period, run.stock, logger);
    if (loop.size === 0) {
        return null;
    }
    const looped_windows = new Map(windows);
    for (const [inserter_id, it] of loop) {
        looped_windows.set(inserter_id, it.windows);
    }
    const looped_run = runAsBuiltCheck(config, looped_windows, period, logger, start_phases,
        (n, total) => report?.(`Checking the windows out of the loop, clock start ${n}/${total}`), LOOP_WINDOW_CHECK_TICKS, undefined, pickup_phase_cycles);
    const passes_as_before = looped_run.check.holds && looped_run.check.failed_start_offset === undefined
        && looped_run.check.start_phases_checked === run.check.start_phases_checked;
    logger.log(`Loop windows: ${passes_as_before ? "kept" : "dropped, the as-built check with them does not pass as without"}`);
    if (!passes_as_before) {
        return null;
    }
    return {
        ...looped_run,
        windows: looped_windows,
        loop_windows: {
            inserter_ids: Array.from(loop.keys()),
            window_count_without_loop_windows: Array.from(loop.keys()).reduce((sum, id) => sum + (windows.get(id)?.length ?? 0), 0),
        },
        item_names: new Map(Array.from(loop, ([inserter_id, it]) => [inserter_id, it.item_name])),
    };
}

/** What runAsBuiltCheck yields */
export interface AsBuiltRun {
    result: TrialRun;
    check: AsBuiltStabilityCheck;
    /** The long run of the check, when it made one */
    stock?: StockRecording;
}

export interface BeltPickupSlackDecision {
    helps: boolean;
    /**
     * The check that decided for the slack, with the exact windows it ran on: a caller checking the same windows
     * reuses it instead of running the identical check again (see checkedClock). Null when no check ran, or when
     * the slack is left out.
     */
    verified: { windows: Map<string, OpenRange[]>; run: AsBuiltRun } | null;
}

/**
 * Slack lets a belt-fed inserter finish a late pickup, but in a short period it can also leave time for an
 * extra swing when the machine is not at its insertion limit. `helps` is false only when the clock-only check
 * passes without the slack but not with it, or lands further from the expected output with it. The config is
 * checked with `derive_clock_windows` off, which only `generateClockForConfig` reads: the run is the same as
 * on the config as given.
 */
export function beltPickupSlackTrial(
    config: Config,
    windows: Map<string, OpenRange[]>,
    slack: Map<string, number>,
    period: number,
    expected_output: number,
    logger: Logger,
): BeltPickupSlackDecision {
    if (Array.from(slack.values()).every(ticks => ticks === 0) || !Number.isInteger(period)) {
        return { helps: true, verified: null };
    }
    const base_config: Config = { ...config, overrides: { ...config.overrides, derive_clock_windows: false } };
    const slacked = withBeltPickupSlack(windows, slack, period);
    const with_slack = runAsBuiltCheck(base_config, slacked, period, logger);
    if (with_slack.check.holds) {
        return { helps: true, verified: { windows: slacked, run: with_slack } };
    }
    const without_slack = runAsBuiltCheck(base_config, windows, period, logger).check;
    logger.log(`Belt pickup slack: clock-only actual with=${with_slack.check.actual_output_items} without=${without_slack.actual_output_items} expected=${expected_output}`);
    if (without_slack.holds) {
        return { helps: false, verified: null };
    }
    const helps = Math.abs(with_slack.check.actual_output_items - expected_output) <= Math.abs(without_slack.actual_output_items - expected_output);
    return { helps, verified: helps ? { windows: slacked, run: with_slack } : null };
}

/**
 * Rewrites the config so every inserter and drill is controlled the way the generated blueprint
 * controls it in game: entities with a decider window get a CLOCKED window shifted by the circuit latency,
 * everything else is left unwired (ALWAYS), except explicit NEVER overrides.
 */
function buildAsBuiltConfig(
    config: Config,
    decider_windows: Map<string, OpenRange[]>,
    period: number,
    /** Fuel clocks to run the fuel inserters on; without them the run makes its own from its plan */
    fuel_clocks?: ReadonlyMap<string, InserterClock>,
    /** In what order the clock's window deciders are built: as the blueprint has them by default */
    decider_order: DeciderOrder = "built",
): Config {
    const windows = new Map<string, EnableControlRange[]>();
    const entity_registry = createEntityRegistryFromConfig(config);
    // inserters outside the plan swing on clocks that do not come from the windows of the plan
    const inserter_clocks = unplannedInserterClocks(entity_registry, period, undefined, undefined, alwaysEnabledByConfig(config));
    const clocked = withInserterClocks(decider_windows, inserter_clocks, period);
    for (const [key, ranges] of clocked) {
        windows.set(key, shiftRangesForCircuitLatency(ranges, period));
    }
    // the order the blueprint builds the deciders in, which decides which of two windows that open together goes first
    const settled = new Map(Array.from(inserter_clocks, ([key, clock]) => [key, (clock.own_clock ? fuel_clocks?.get(key) : undefined) ?? clock] as const));
    const built = deciderBuildOrder(clocked, entity_registry, settled);
    const decider_build_order = decider_order === "reversed" ? reversedDeciderOrder(built) : built;

    const asBuiltControl = (entity_key: string, current: EnableControlOverrideConfig | undefined): EnableControlOverrideConfig => {
        // a fuel inserter is on a clock of its own, which the run makes for it from the plan like the blueprint does
        if (inserter_clocks.get(entity_key)?.own_clock) {
            const fuel_clock = fuel_clocks?.get(entity_key);
            return fuel_clock === undefined ? { mode: "AUTO" } : {
                mode: "CLOCKED",
                ranges: [{ start: fuel_clock.window.start_inclusive, end: fuel_clock.window.end_inclusive }],
                period_duration_ticks: fuel_clock.modulus,
                decider_build_order: decider_build_order.get(entity_key),
            };
        }
        const ranges = windows.get(entity_key);
        if (ranges && ranges.length > 0) {
            // moved by the latency: the clock's start leaves as many ticks dark (a fuel clock of its own, above, is moved
            // by none, so nothing of its start is dark)
            return { mode: "CLOCKED", ranges, period_duration_ticks: period, decider_build_order: decider_build_order.get(entity_key),
                latency_ticks: CIRCUIT_LATENCY_TICKS };
        }
        return current?.mode === "NEVER" ? current : { mode: "ALWAYS" };
    };

    return {
        ...config,
        inserters: config.inserters.map((inserter, index) => ({
            ...inserter,
            overrides: {
                ...inserter.overrides,
                enable_control: asBuiltControl(EntityId.forInserter(inserter.id ?? index + 1).id, inserter.overrides?.enable_control),
            },
        })),
        drills: config.drills === undefined ? undefined : {
            ...config.drills,
            configs: config.drills.configs.map(drill => ({
                ...drill,
                overrides: {
                    ...drill.overrides,
                    enable_control: asBuiltControl(EntityId.forDrill(drill.id).id, drill.overrides?.enable_control),
                },
            })),
        },
    };
}

/**
 * Tries a clock from every start of CLOCK_STARTS (see `startDependenceOf`). Null when the runs cannot be made on it,
 * which is logged. The config is the one the clock was planned on.
 */
export function startDependenceVerdictOf(
    planned_on: Config,
    result: BlueprintGenerationResult,
    cold_holds: boolean,
    logger: Logger,
    report?: (detail: string) => void,
): StartDependence | null {
    const config = { ...planned_on, overrides: { ...planned_on.overrides, terminal_swing_count: result.used_terminal_swing_count } };
    const quiet: Logger = { log: () => { }, warn: () => { }, error: logger.error.bind(logger), debug: () => { } };
    try {
        report?.("Trying other starts");
        return startDependenceOf(config, result.clock_windows, result.simulation_duration.ticks, result.stability_check.expected_output_items, cold_holds, quiet);
    } catch (error) {
        logger.log(`Start dependence could not be tried: ${error instanceof Error ? error.message : error}`);
        return null;
    }
}

/** What the backpressure loss trials of a clock found, or why they could not be run on it */
export type BackpressureLossAssessment = Pick<ClockAssessment, "backpressure_loss" | "backpressure_loss_not_tried">;

/**
 * Tries a clock that holds its expected output for backpressure loss. When the trials cannot be run on it, which is
 * logged, the verdict is null and `backpressure_loss_not_tried` is the reason (see `clockVerdictOf`).
 */
export function backpressureLossVerdictOf(
    planned_on: Config,
    result: BlueprintGenerationResult,
    logger: Logger,
    report?: (detail: string) => void,
): BackpressureLossAssessment {
    // a clock is tried once in a generation, whichever alternative asks: the trials take seconds, and the one that picks the
    // windows of a clock and the one that assesses it are of the same clock
    const memo = currentRunMemo();
    let key: string | undefined;
    try {
        key = memo === undefined ? undefined : backpressureLossKey(planned_on, result);
    } catch {
        // a clock whose key cannot be made is tried as before, and fails in the trial if it cannot be tried
    }
    return memo === undefined || key === undefined ? triedBackpressureLoss(planned_on, result, logger, report)
        : memo.backpressureLoss(key, () => triedBackpressureLoss(planned_on, result, logger, report));
}

function triedBackpressureLoss(
    planned_on: Config,
    result: BlueprintGenerationResult,
    logger: Logger,
    report?: (detail: string) => void,
): BackpressureLossAssessment {
    // the config the clock was planned on has its output swings per cycle
    const config = { ...planned_on, overrides: { ...planned_on.overrides, terminal_swing_count: result.used_terminal_swing_count } };
    const quiet: Logger = { log: () => { }, warn: () => { }, error: logger.error.bind(logger), debug: () => { } };
    try {
        return { backpressure_loss: verdictOf(backpressureLossOf(config, result.clock_windows, result.simulation_duration.ticks,
            result.stability_check.expected_output_items, quiet, {}, (_loss, index, total) => report?.(`Trying backpressure loss ${index + 1}/${total}`))) };
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        logger.log(`Backpressure loss could not be tried: ${reason}`);
        return { backpressure_loss: null, backpressure_loss_not_tried: reason };
    }
}

/**
 * The windows of a clock whose period is not a whole number of ticks, as its blueprint runs them when it counts the
 * period rounded down to `period_ticks`: a window that opens after the last tick is gone, one that ends after it ends
 * there.
 */
export function windowsRoundedTo(clock_windows: SerializableClockWindows, period_ticks: number): SerializableClockWindows {
    const last = period_ticks - 1;
    return Object.fromEntries(Object.entries(clock_windows).map(([entity_id, ranges]) => [entity_id, ranges
        .filter(range => range.start <= last)
        .map(range => ({ start: Math.floor(range.start), end: Math.min(Math.floor(range.end), last) }))]));
}

/** What a clock rounded down to whole ticks was found to do on its own period (see `roundedClockTrial`) */
export interface RoundedClockTrial {
    /** The clock as it runs: its windows rounded, its clock-only check (`stability_check.as_built`) of its own period */
    result: BlueprintGenerationResult;
    holds: boolean;
    loss: BackpressureLossAssessment;
    start_dependence: StartDependence | null;
}

/**
 * Tries the clock of a period that is not whole as its blueprint runs it, rounded down to `period_ticks`: on its own
 * period the clock-only check (its start phases, moving lane phases and long run), and, when it holds, the
 * backpressure loss trials and, when the config asks, the other starts, as for a clock of whole ticks. The output it is
 * to move a period is the plan's, in fewer ticks. The config is the one the clock was planned on.
 */
export function roundedClockTrial(
    planned_on: Config,
    result: BlueprintGenerationResult,
    period_ticks: number,
    logger: Logger,
    report?: (detail: string) => void,
): RoundedClockTrial {
    assert(Number.isInteger(period_ticks), `A rounded clock has a whole number of ticks, not ${period_ticks}`);
    const clock_windows = windowsRoundedTo(result.clock_windows, period_ticks);
    const config = { ...planned_on, overrides: { ...planned_on.overrides, derive_clock_windows: false, terminal_swing_count: result.used_terminal_swing_count } };
    const windows = new Map(Object.entries(clock_windows).map(([entity_id, ranges]) =>
        [entity_id, ranges.map(range => OpenRange.from(range.start, range.end))] as const));
    const as_built = runAsBuiltCheck(config, windows, period_ticks, quietLogger(logger), AS_BUILT_START_PHASES,
        (n, total) => report?.(`Checking the clock rounded to ${period_ticks} ticks, clock start ${n}/${total}`));
    const rounded: BlueprintGenerationResult = {
        ...result,
        clock_windows,
        simulation_duration: Duration.ofTicks(period_ticks),
        stability_check: { ...result.stability_check, holds: as_built.check.holds, as_built: as_built.check },
    };
    const holds = as_built.check.holds;
    logger.log(`Clock rounded to ${period_ticks} ticks: as-built=${as_built.check.actual_output_items}/${result.stability_check.expected_output_items} holds=${holds}`);
    const loss = holds ? backpressureLossVerdictOf(planned_on, rounded, logger, report) : { backpressure_loss: null };
    const start_dependence = planned_on.overrides?.check_start_dependence === true
        ? startDependenceVerdictOf(planned_on, rounded, holds, logger, report) : null;
    // the result keeps the period the plan has: the rounded clock is the same export, counting it rounded down
    return { result: { ...rounded, simulation_duration: result.simulation_duration }, holds, loss, start_dependence };
}

/**
 * What a clock that failed its first check moves a period, for listing it. The first check measures one period after
 * a warm-up, and a build that does not repeat with its clock moves different amounts in the periods that follow (cell
 * 02 of stupidfathobbit: 480 to 608 items, 608 in the period measured, 546 on average, which is what the game makes), so
 * a clock that fails it is listed by the mean items a period over the judged part of its long run, as one that fails
 * later is (`longRunOfFreeRunningBuild`). The check itself, and the clocks the generator picks by it, are not changed.
 * A period too long for a long run keeps the one period the check measured, and says so.
 */
export function withSettledOutput(
    planned_on: Config,
    result: BlueprintGenerationResult,
    period: number,
    logger: Logger,
): BlueprintGenerationResult {
    const { as_built } = result.stability_check;
    if (as_built === undefined || as_built.first_check_failed !== true) {
        return result;
    }
    const one_period = { ...as_built, output_basis: "one period" as const };
    const reported = (check: AsBuiltStabilityCheck): BlueprintGenerationResult =>
        ({ ...result, stability_check: { ...result.stability_check, as_built: check } });
    try {
        const config = { ...planned_on, overrides: { ...planned_on.overrides, derive_clock_windows: false, terminal_swing_count: result.used_terminal_swing_count } };
        const windows = withChestDrillWindows(config, new Map(Object.entries(result.clock_windows).map(([entity_id, ranges]) =>
            [entity_id, ranges.map(range => OpenRange.from(range.start, range.end))] as const)), period);
        const long_run = longRunOfFreeRunningBuild(config, windows, period, result.stability_check.expected_output_items, quietLogger(logger));
        return reported(long_run === null ? one_period
            : { ...as_built, actual_output_items: long_run.output_items_per_period, output_basis: "long-run mean" });
    } catch (error) {
        logger.log(`The long run of a clock that fails its first check could not be made, so it is listed by the one period measured: ${error instanceof Error ? error.message : String(error)}`);
        return reported(one_period);
    }
}

/**
 * The config a clock is verified on: the one it was planned on with its output swings per cycle and without the derivation
 * of windows, built as the clock is (`buildAsBuiltConfig`). All physical config, including supply, geometry, seeds, entity
 * order and overrides, stays in it.
 */
function verificationConfigOf(config: Config, result: BlueprintGenerationResult): Config {
    const windows = new Map(Object.entries(result.clock_windows).map(([id, ranges]) =>
        [id, ranges.map(range => OpenRange.from(range.start, range.end))] as const));
    const verification_config = buildAsBuiltConfig({ ...config, overrides: { ...config.overrides,
        derive_clock_windows: false, terminal_swing_count: result.used_terminal_swing_count } }, windows, result.simulation_duration.ticks);
    const fully_controlled = verification_config.inserters.every(inserter => inserter.overrides?.enable_control?.mode !== "AUTO")
        && (verification_config.drills?.configs.every(drill => drill.overrides?.enable_control?.mode !== "AUTO") ?? true);
    // At a forced whole swing count, fractional mode changes only the AUTO swing distribution. Clocked/always/never
    // controls do not use that distribution. Keep the flag when any own-clock fuel inserter still needs AUTO.
    verification_config.overrides!.use_fractional_swings = fully_controlled && Number.isInteger(result.used_terminal_swing_count)
        ? false : config.overrides?.use_fractional_swings === true;
    return verification_config;
}

/**
 * Identity of a candidate's verification, not its planning strategy or export object order.
 * Recovery forces the actual output swing count and turns off window derivation. All physical config, including
 * supply, geometry, seeds, entity order and overrides, stays in the key, along with the observed clock-only check.
 */
export function clockVerificationSignature(config: Config, result: BlueprintGenerationResult): string {
    return canonicalVerificationJson({ config: verificationConfigOf(config, result), period: result.simulation_duration.ticks, windows: result.clock_windows,
        belt_kind: result.belt?.kind ?? null, belt_pickup_slack_left_out: result.belt_pickup_slack_left_out,
        expected_output: result.stability_check.expected_output_items,
        base_cycle_ticks: result.crafting_cycle_plan.total_duration.ticks,
        transfer_plan: result.serializable_transfer_plan,
        inserter_clocks: result.unplanned_inserter_clocks,
        check: result.stability_check.as_built ?? result.stability_check });
}

/**
 * What the trials of a loss are a function of: the config the clock is verified on, its windows and period, and the items it
 * is expected to move a period. The trials run on nothing else, so two clocks with this key have the same verdict. The cycles
 * of the clock (`overrides.lcm`) are left out where they set nothing: they set the period of a run that is not given one, which
 * a whole period is, and the clocks of the inserters outside the plan, which a build without any has none of.
 */
export function backpressureLossKey(planned_on: Config, result: BlueprintGenerationResult): string {
    const period = result.simulation_duration.ticks;
    const verification_config = verificationConfigOf(planned_on, result);
    const cycles_set_nothing = Number.isInteger(period)
        && unplannedInserterClocks(createEntityRegistryFromConfig(verification_config), period, new Map(), new Map(), alwaysEnabledByConfig(verification_config)).size === 0;
    const config = cycles_set_nothing ? { ...verification_config, overrides: { ...verification_config.overrides, lcm: undefined } } : verification_config;
    return canonicalVerificationJson({ config, period, windows: result.clock_windows, expected_output: result.stability_check.expected_output_items });
}
