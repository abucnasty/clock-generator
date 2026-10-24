import assert from "../../common/assert";
import type { NotMadeClock } from "../why-not-stable";
import { Config } from "../../config";
import { EnableControlOverrideConfig } from "../../config/schema";
import { assertInserterCoverage } from "../../config/inserter-coverage-validator";
import { validateCopies } from "../../config/copies-validator";
import { assertLaneCapacity } from "../../config/lane-capacity-validator";
import { DebugPluginFactory } from "../sequence/debug/debug-plugin-factory";
import { DebugSettingsProvider, MutableDebugSettingsProvider } from "../sequence/debug/debug-settings-provider";
import { InserterClock, byProductOnlyInserters, clockWindowsOverPeriod, fuelOnlyInserters, isByProductOnlyInserter, alwaysEnabledInserters, unplannedInserterClocks } from "../sequence/unplanned-inserter-clock";
import { cloneSimulationContextWithInterceptors, createEntityRegistryFromConfig, MovingPickupPhases, SimulationContext } from "../sequence/simulation-context";
import { Duration, OpenRange } from "../../data-types";
import { Entity, EntityId, handSizeFor, Inserter, Machine, ReadableEntityRegistry } from "../../entities";
import { TargetProductionRate } from "../target-production-rate";
import { EntityState, InserterState, MachineState } from "../../state";
import Fraction, { fraction } from "../../data-types/fraction";
import { ClockSchedule, createSignalPerInserterBlueprint, mergedClockTicks, SignalPerInserterBlueprint, SubtickClock } from "../blueprint";
import { FactorioBlueprint } from "../../blueprints/blueprint";
import { RelativeTickProvider, ResettableRegistry, TickProvider } from "../../control-logic";
import { ModePlugin } from "../../control-logic/mode";
import { MachineStateMachine } from "../../control-logic/machine/machine-state-machine";
import { buildOutputInsertersOf, EntityTransferCountMap, SerializableTransferPlan } from "../sequence/cycle/swing-counts";
import { InventoryTransferHistory } from "../sequence/inventory-transfer-history";
import { InventoryTransfer } from "../sequence/inventory-transfer";
import { InserterInventoryHistoryPlugin } from "../../control-logic/inserter/plugins/inserter-inventory-transfer-plugin";
import { DrillInventoryTransferPlugin } from "../../control-logic/drill/plugins/drill-inventory-transfer-plugin";
import { EnableControlFactory } from "../sequence/interceptors/inserter-enable-control-factory";
import { ConfigurableEnableControlFactory, EntityEnableControlOverrideMap } from "../sequence/interceptors/configurable-enable-control-factory";
import { CraftingCyclePlan } from "../sequence/cycle/crafting-cycle";
import { PrepareStep } from "../runner/steps/prepare-step";
import { DEFAULT_LOOP_SEED_ITEMS, seedLoopingRecipes } from "../runner/cold-start";
import { DEFAULT_TAKER_ORDER, TakerOrder } from "../../control-logic/inserter/competing-takers";
import { DeciderOrder } from "../decider-order";
import { WarmupStep } from "../runner/steps/warmup-step";
import { FullOutputChest, fullOutputChestsOf } from "../full-output-chests";
import { ExportShortfall, exportShortfallsOfPeriod, exportedItemsOf } from "../export-delivery";
import { simulationStateKey } from "../runner/steady-state";
import { SimulateStep } from "../runner/steps/simulate-step";
import { RunnerStepType } from "../runner/steps/runner-step";
import { Logger, defaultLogger } from "../../common/logger";
import { FuelLevelRecorder, FuelLevelSeries, FuelPlan, fuelPlan } from "../fuel-view";
import { StockRecorder, StockRecording } from "../machine-stock";
import { TimelineRecorder, TimelineRecording, TimelineRecordingOptions } from "../timeline-recording";
import { BackpressureLossOptions, LossOutcome, runLossTrials } from "../backpressure-loss";
import { SerializableTransferHistory, serializeTransferHistory } from "../sequence/transfer-history-serializer";
import { StateTransitionHistory } from "../sequence/state-transition-history";
import { MachineFactsEntry } from "../insights";
import { SerializableStateTransitionHistory, serializeStateTransitionHistory } from "../sequence/state-transition-serializer";
import { InserterStateTransitionTrackerPlugin } from "../../control-logic/inserter/plugins/inserter-state-transition-tracker-plugin";
import { MachineStateTransitionTrackerPlugin } from "../../control-logic/machine/plugins/machine-state-transition-tracker-plugin";
import { DrillStateTransitionTrackerPlugin } from "../../control-logic/drill/plugins/drill-state-transition-tracker-plugin";
import { FactorioStatePlugin } from "../../control-logic/plugins/factorio-state-plugin";
import { factorioDrillState, factorioInserterState, factorioMachineState } from "../../state/factorio-entity-state";
import type { DerivedClockWindowsReport } from "../candidates/observed-windows";
import type { SearchReport } from "../candidates/search";
import { ClockBelt, SerializableClockWindows, beltPickupSlackTicks, fuelHandRoomTicks, subtickClockForPeriod, withBeltPickupSlack } from "../clock";
import { ChestDrillClock, chestDrillClockLine, chestDrillWindows } from "../chest-drill-windows";
import type { TurnGroup } from "../turn-groups";
import { AlwaysOnReason, AlwaysOnReasons, alwaysOnReasons } from "../always-on-reasons";
import { RunMemo, currentRunMemo } from "./run-memo";
import { AS_BUILT_START_PHASES, AsBuiltRun, AsBuiltStabilityCheck, FREE_RUNNING_CHECK_TICKS, beltPickupSlackTrial, runAsBuiltCheck, runClockOnBuild, trialWithLoopWindows } from "../trial";

/**
 * The most ticks one simulated run goes on for. A guard, not a limit on test time: a config that passes validation
 * but deadlocks something in the simulator, or that it cannot simulate at all, must not keep it running for ever.
 */
export const MAX_SIMULATION_TICKS = 500_000;

/**
 * Maximum allowed deviation (in items) between actual and expected output transfers
 * when determining whether a simulation is considered stable.
 *
 * A tolerance of 1 accounts for minor trimming edge cases (e.g., back-swing wake-list
 * adjustments at period boundaries) while remaining strict enough to reliably detect
 * real instability such as output running at 50% of the expected rate.
 */
export const LCM_STABILITY_TOLERANCE = 1;


export interface SerializableInserterClock {
    kind: InserterClock["kind"];
    /** Ticks between the starts of two windows; divides the clock period unless the inserter has a clock of its own */
    modulus: number;
    /** The window is on a clock of its own that counts `modulus` ticks (fuel), so it is not among the clock windows of the period */
    own_clock: boolean;
    /** The window within the first `modulus` ticks, as inclusive ticks */
    window: { start: number; end: number };
}


function serializeInserterClocks(clocks: ReadonlyMap<string, InserterClock>): Record<string, SerializableInserterClock> | undefined {
    if (clocks.size === 0) {
        return undefined;
    }
    return Object.fromEntries(Array.from(clocks, ([id, clock]) => [id, {
        kind: clock.kind,
        modulus: clock.modulus,
        own_clock: clock.own_clock,
        window: { start: clock.window.start_inclusive, end: clock.window.end_inclusive },
    }]));
}

/** The exported clock run over several periods, to show how a burner machine uses its fuel */
export interface FuelConsumptionView {
    /** Periods of the clock the view covers; the clock itself stays one period */
    periods: number;
    duration_ticks: number;
    /** The inserters that fill a fuel slot */
    fuel_inserter_ids: string[];
    /** The fuel inserters' transfers into the fuel slots over the view; false when none swung even over its longest tried length */
    fuel_swings_recorded: boolean;
    /** The fuel each burner machine held over the view */
    fuel_levels: FuelLevelSeries[];
    /** A burner machine had no fuel at all at some tick of the view */
    ran_out_of_fuel: boolean;
    transfer_history: SerializableTransferHistory;
    state_transition_history: SerializableStateTransitionHistory;
}

/** What the build does when only the exported clock windows drive it, from the unshifted clock start */
export interface ClockOnlyRun {
    transfer_history: SerializableTransferHistory;
    state_transition_history: SerializableStateTransitionHistory;
}


export interface SimulationStabilityCheck {
    /** The run moved its expected output, within a hand of tolerance (and the clock-only check held, when one ran) */
    holds: boolean;
    /** Total items transferred by output inserters during the simulation period */
    actual_output_items: number;
    /** Expected items to be transferred by output inserters based on the crafting cycle plan */
    expected_output_items: number;
    /** The LCM value used in this simulation run */
    used_lcm: number;
    /**
     * Periods after which the simulated state repeats exactly. Only known for a run driven by clock windows alone
     * whose warmup reached the repeat. Above 1, the simulated period is one of several that differ.
     */
    repeat_periods?: number;
    /** Output items over repeat_periods periods, required to match the expected output too; set when repeat_periods is more than 1 */
    repeat_output_items?: number;
    /** Re-simulation driven only by the exported clock windows; absent when verify_as_built is disabled */
    as_built?: AsBuiltStabilityCheck;
    /** The chests the output goes into that nothing empties and that are full where the run ended; absent when none is */
    full_output_chests?: FullOutputChest[];
    /** The export belts that received less than their consumers take over the period judged; absent when none did */
    export_shortfalls?: ExportShortfall[];
}


export interface SwingAttemptResult {
    /** The terminal_swing_count value that was tried */
    terminal_swing_count: number;
    /** Whether this attempt produced stable output */
    holds: boolean;
    /** Actual items transferred by output inserters */
    actual_output_items: number;
    /** Expected items based on the crafting cycle plan */
    expected_output_items: number;
}


export interface SwingBackoffReport {
    /** Whether the backoff loop was triggered (false when first attempt was stable or backoff is disabled) */
    triggered: boolean;
    /** The terminal_swing_count used in the first attempt */
    initial_terminal_swing_count: number;
    /** The stability result of the very first simulation attempt */
    initial_attempt: SwingAttemptResult;
    /** The terminal_swing_count that produced stable output, or null if none was found */
    stable_terminal_swing_count: number | null;
    /** Results for each swing count tried after the initial attempt */
    attempts: SwingAttemptResult[];
}


export interface BlueprintGenerationResult {
    blueprint: FactorioBlueprint;
    /** What the combinators of the blueprint do, as data: what the recording harness wires and cuts a recording by */
    schedule: ClockSchedule;
    /** Decider windows exported in the blueprint, per entity id (before circuit latency) */
    clock_windows: SerializableClockWindows;
    /** Ticks of belt pickup slack added to each belt-fed inserter's windows; empty when none was applied */
    belt_pickup_slack_ticks: Record<string, number>;
    /**
     * The windows of a belt-fed inserter go without the slack that would have lengthened them. False when the config
     * says the input belts are backed up (`overrides.backed_up_belts`): then a clock is meant to go without it.
     */
    belt_pickup_slack_left_out: boolean;
    /**
     * Ticks added to each window of an inserter that takes fuel off a belt as well as an ingredient, so that a hand of
     * fuel fits ahead of the hands the window is planned for (see fuelHandRoomTicks); empty when the clock has none.
     */
    fuel_hand_room_ticks: Record<string, number>;
    /** The belt the clock is made for; null when no inserter with windows picks up from a belt */
    belt: ClockBelt | null;
    /** For a fractional period: the same windows on a subtick clock that runs the exact period instead of rounding it */
    subtick?: { clock: SubtickClock; blueprint: FactorioBlueprint; schedule: ClockSchedule };
    /** The same windows with repeating parts checked against the clock modulo a divisor of the period; absent when that saves nothing */
    modulo_blueprint?: FactorioBlueprint;
    modulo_schedule?: ClockSchedule;
    crafting_cycle_plan: CraftingCyclePlan;
    simulation_duration: Duration;
    transfer_history: InventoryTransferHistory;
    /** Serializable transfer history for UI visualization */
    serializable_transfer_history: SerializableTransferHistory;
    /** Serializable state transition history for UI visualization */
    serializable_state_transition_history: SerializableStateTransitionHistory;
    /** Insertion limits, crafting time and output per craft of every machine */
    machine_facts: MachineFactsEntry[];
    /**
     * What the search of the candidate's transform tried and picked (see candidates/search.ts): the moved crafting
     * cycle of shifted swings with the range that works around it, the moved output swing of uneven output swings, the
     * padding of observed windows, the timing of full-hand output. Absent for a planned clock.
     */
    search?: SearchReport;
    /**
     * The clock-only check's unshifted run, when it is a different simulation than the histories above
     * (planned windows come from a run where inserters also wait on inventory). Absent when no clock-only
     * check ran or the histories above already are that run (observed windows).
     */
    clock_only_run?: ClockOnlyRun;
    /**
     * The clocks of the inserters outside the plan (fuel inserters, and inserters taking a by-product away), by inserter id:
     * the window repeats every `modulus` ticks of the clock. Absent when there are none.
     */
    unplanned_inserter_clocks?: Record<string, SerializableInserterClock>;
    /** What the burner machines use and the fuel clocks exported to refill them; absent when no inserter only fills a fuel slot */
    fuel_plan?: FuelPlan;
    /**
     * The exported clock run for several periods, when a machine burns fuel: a fuel inserter swings once in a few
     * periods, so one period seldom shows it inserting. Extended only to show the fuel being consumed; the clock
     * and its checks stay one period.
     */
    fuel_consumption_view?: FuelConsumptionView;
    /** The LCM value used in this simulation run */
    used_lcm: number;
    /** The effective terminal swing count (output swings per base cycle) used in this simulation run */
    used_terminal_swing_count: number;
    /** Result of post-simulation output stability check */
    stability_check: SimulationStabilityCheck;
    /** Report of output swing backoff attempts, present on all results returned by generateClockWithSwingBackoff */
    swing_backoff_report?: SwingBackoffReport;
    /** Serializable representation of planned transfer counts per inserter/drill, for UI display */
    serializable_transfer_plan: SerializableTransferPlan;
    /** The computed LCM before any manual override from config.overrides.lcm */
    computed_lcm: number;
    /** For observed windows (`observedWindowsClock`, and `config.overrides.derive_clock_windows`) */
    derived_clock_windows?: DerivedClockWindowsReport;
    /**
     * Present when the exported clock has windows for the inserters that take out of a loop of machines, which the plan
     * leaves always enabled (see `loopInserterWindows`): their ids, and how many windows they had without. These windows
     * only reduce idle checks, so a ranking of clocks counts the inserters' windows as without them.
     */
    loop_windows?: { inserter_ids: string[]; window_count_without_loop_windows: number };
    /**
     * Each drill that drops into a chest: the windows the clock gives it, from the windows of the inserters that take
     * from the chest (see chestDrillWindows), or why it stays always enabled. Absent when the build has none.
     */
    chest_drills?: ChestDrillClock[];
    /**
     * Why each inserter and drill the clock leaves always on has no wake window, by entity id; absent when the clock
     * leaves none on. An entity that is on with no reason here is one the planner does not say why of.
     */
    always_on_reasons?: AlwaysOnReasons;
    /** The windows are the grouped hands rule's (see groupedHandsClock), and whether its inserters share windows; absent for any other clock */
    grouped_hands?: { shared_windows: boolean };
}

/**
 * Configuration for which steps should have debugging enabled.
 * By default, all steps have debugging disabled.
 */
export type DebugSteps = {
    [K in RunnerStepType]?: boolean;
};

/**
 * Options for blueprint generation.
 */
export interface GenerateClockOptions {
    /** Debug settings provider (defaults to disabled) */
    debug?: MutableDebugSettingsProvider;
    /** Configuration for which steps should have debugging enabled */
    debug_steps?: DebugSteps;
    /** Logger for output messages (defaults to console) */
    logger?: Logger;
    /** Re-simulate with only the exported clock windows and require that to be stable too (default false) */
    verify_as_built?: boolean;
    /** Belt pickup slack on belt-fed windows: "auto" keeps it unless a clock-only check gets worse (default "auto") */
    belt_pickup_slack?: "auto" | "always" | "never";
    /**
     * Lengthen the windows of an inserter that takes fuel off a belt as well as an ingredient by the fill of a hand of
     * fuel (see fuelHandRoomTicks), where the clock goes without belt pickup slack. Asked for when a clock for belts
     * that do not move does not hold the expected output without it (see withFuelHandRoomWhereNeeded).
     */
    fuel_hand_room?: boolean;
    /** Also run the exported clock for several periods to show the fuel being consumed (default true; internal check runs never do) */
    fuel_consumption_view?: boolean;
    /**
     * Record the state the game would show for every entity over the run, for its timelines (default true). A check
     * run whose histories nobody reads leaves it out: working the state out for every entity every tick takes time.
     */
    factorio_states?: boolean;
    /** Also build the modulo-clock blueprint (default true; internal check runs never export it) */
    modulo_blueprint?: boolean;
    /** Called as generateClockAlternatives moves through its alternatives and their sub-steps */
    on_progress?: (progress: GenerationProgress) => void;
    /** Called with a short description of the current sub-step (clock-only checks, observed window derivation) */
    on_progress_detail?: (detail: string) => void;
    /** Called with each clock alternative that could not be made, and the generator's reason */
    on_not_made?: (clock: NotMadeClock) => void;
    /**
     * Make the clock with windows shared by the inserters that take into their machines at the same moment (see
     * groupedHandsClock), or not at all: it needs `verify_as_built`, and throws where no shared windows hold.
     */
    shared_windows?: boolean;
    /**
     * False leaves the inserters that take out of a loop always enabled, as every clock did before they were given
     * windows where the clock holds with them (see `trialWithLoopWindows`): the clock is made so again where the one with
     * them does not get back from a loss.
     */
    loop_windows?: boolean;
}

/** What a machine holds when a run starts: see GenerateClockOptions.start_stock */
export interface MachineStartStock {
    /** Ingredients and products by item name; an item that is not named keeps what filling the machine left */
    items: Record<string, number>;
    /** The crafting bar, 0 to 1: the part of a craft that is done (default: as filling the machine left it) */
    crafting_progress?: number;
    /** The productivity bar, with what it holds over 1 and has not paid out yet (default: as filling the machine left it) */
    bonus_progress?: number;
}


export interface GenerationProgress {
    /** Label of the alternative being generated */
    step: string;
    /** What that alternative is currently doing, when it reports sub-steps */
    detail?: string;
    /** Alternatives finished so far */
    completed: number;
    /** Total alternatives, once known */
    total: number | null;
}

/**
 * How a build is run: the start it is given, how long it runs, and what is recorded. Shared by the planning run and
 * the trial of a clock (`runBuild`).
 */
export interface RunOptions {
    /** Debug settings provider (defaults to disabled) */
    debug?: MutableDebugSettingsProvider;
    /** Configuration for which steps should have debugging enabled */
    debug_steps?: DebugSteps;
    /** Logger for output messages (defaults to console) */
    logger?: Logger;
    /**
     * Start as the staged scaffold of the game does: the belts are full (they always are), and the machines, the
     * buffers and the hands are empty when the clock starts at its tick 0, with no free run before it. A build that
     * makes its own ingredient is given `overrides.loop_seed_items` of it, once. For a run on clock windows (default
     * false: the planning run is not on a clock, and starts from the build filled until its output is blocked).
     */
    cold_start?: boolean;
    /** In what order inserters that compete for one machine's product are updated where the turn rule cannot decide (default descending config ids) */
    competing_takers_order?: TakerOrder;
    /**
     * In what order the check of a clock has its window deciders built (default "built", as its blueprint has them),
     * which decides what an inserter does whose window opens with the window of the inserter that takes its machine's
     * products (see `deciderBuildOrder`). Read by the runs of a clock's windows (`runClockOnBuild`) only.
     */
    decider_order?: DeciderOrder;
    /** Start warmup with the output machines still output blocked, so the clock has to drain the surplus */
    keep_output_buffers?: boolean;
    /**
     * What machines hold when the clock starts, by entity id ("machine:4"), in place of what filling them left; every
     * inserter then starts with an empty hand. For starting a run in a state read off a recording of the game, to
     * see what the simulator makes of it (see simulateClockOnly).
     */
    start_stock?: Record<string, MachineStartStock>;
    /** Initial lane phases for a simulation trial; transient stock state, separate from saved config geometry. */
    moving_pickup_phases?: MovingPickupPhases;
    /**
     * After the run, cut one supply of the build and give it back, several times over, and count what the build makes
     * once it is back (see backpressure-loss.ts). For a run on clock windows alone; nothing is cut in any other run.
     */
    backpressure_loss?: BackpressureLossOptions;
    /** Warmup length in simulation periods (default 10) */
    warmup_periods?: number;
    /**
     * The period of the run, when it is not the one the plan gives: a clock of whole ticks run on a plan of a period
     * that is not whole, such as the clock of a fractional period rounded down (the output it is to move a period is
     * still the plan's). Its output is counted and its state compared by this period.
     */
    period_ticks?: number;
    /**
     * Simulate and record this many periods instead of one (default 1). The histories then cover the longer run;
     * the output is judged over one period, so it only means something at 1.
     */
    simulate_periods?: number;
    /** Record the fuel each burner machine holds over the run (default false) */
    fuel_levels?: boolean;
    /** Record what every machine and inserter holds after each tick of the run (default false) */
    machine_stock?: boolean;
    /**
     * Watch the recorded run for the simulation state repeating at a bin boundary, and stop it early when it does:
     * a build on fixed clocks repeats forever from a repeated state (see runner/steady-state.ts), so the bins
     * recorded to there say everything the full run would. The repeat is reported in `state_repeat`. Only read when
     * `simulate_periods` is more than 1, and only on a build whose every control is a fixed clock (see
     * `provenRepeatBin`); any other run is never cut short.
     */
    detect_repeat?: boolean;
    /** Detailed UI recording, requested separately from clock generation. */
    timeline_recording?: TimelineRecordingOptions;
    /**
     * Record the state the game would show for every entity over the run, for its timelines (default true). A check
     * run whose histories nobody reads leaves it out: working the state out for every entity every tick takes time.
     */
    factorio_states?: boolean;
}

/** Everything one run of a build yields, for the planning run to read its windows off and for a trial to judge */
export interface BuildRun extends PlannedCraftingCycle, TransferPlan {
    simulation_context: SimulationContext;
    /** The build as it runs: every inserter and drill on its enable control */
    new_simulation_context: SimulationContext;
    output_inserter_ids: Set<string>;
    swing_counts: EntityTransferCountMap;
    crafting_shares: Map<string, number>;
    always_enabled_by_config: Set<string>;
    /** The clocks of the inserters outside the plan (fuel and by-product), as the plan made them */
    inserter_clocks: Map<string, InserterClock>;
    /** The period of the clock */
    duration: Duration;
    /** What was recorded: `simulate_periods` periods, or less when `detect_repeat` ended the run at a repeat */
    recorded_duration: Duration;
    /** The ticks the run was given: the warm-up and the recorded periods (a run that ended at a repeat took fewer) */
    ticks_simulated: number;
    /** The repeat that ended the recorded run early, when `detect_repeat` found one */
    state_repeat?: StateRepeat;
    /** The transfers of the recorded run, as the windows of the plan are read off them */
    final_history: InventoryTransferHistory;
    state_transition_history: StateTransitionHistory;
    fuel_levels: FuelLevelSeries[] | undefined;
    machine_stock: StockRecording | undefined;
    timeline_recording?: TimelineRecording;
    /** What the run moved against what the plan expects */
    stability_check: SimulationStabilityCheck;
    total_expected_output: number;
    used_terminal_swing_count: number;
    /** What the build made after each trial of the loss, when one was asked for */
    backpressure_loss: LossOutcome | undefined;
}

/**
 * Runs a build: the machines are filled until their output is blocked (the prepare step), the crafting cycle is
 * planned on what they made, the output machines are emptied (or, for a cold start, the build is made anew with
 * nothing in it), the build is warmed up and then run for the period of the plan with every transfer and state
 * recorded, its output is counted against the plan's, and, when asked, the backpressure losses are tried from where
 * it ended. Every inserter runs as its enable control says: the plan's
 * controls in a planning run, the clock windows alone in a trial (see `runClockOnBuild`).
 *
 * A long run that the generation in progress has made before, with this config and these options, is not made again
 * (see `RunMemo`).
 */
export function runBuild(config: Config, options: RunOptions): BuildRun {
    const memo = currentRunMemo();
    return memo !== undefined && RunMemo.accepts(options) ? memo.run(config, options, () => simulateBuild(config, options)) : simulateBuild(config, options);
}

function simulateBuild(config: Config, options: RunOptions): BuildRun {
    const debug = options.debug ?? DebugSettingsProvider.mutable();
    const debug_steps = options.debug_steps ?? {};
    const logger = options.logger ?? defaultLogger;

    const planned_build = recordedBuildOf(config, options, debug, logger);
    const { simulation_context } = planned_build;
    prepareBuild(planned_build, debug, debug_steps, logger);

    const planned_cycle = planCraftingCycle(config, simulation_context, logger);
    const { crafting_cycle_plan, all_output_inserters } = planned_cycle;
    setUpTheStart(simulation_context, planned_cycle.output_machine_state_machines, options, logger);

    const swing_counts = crafting_cycle_plan.entity_transfer_map;
    const transfer_plan = planTransfers(config, crafting_cycle_plan, simulation_context, logger);
    // a staged scaffold starts with nothing in its machines: the plan stands, the build is made anew and seeded
    const build = options.cold_start ? coldBuildOf(config, options, debug, logger) : planned_build;
    const { state_transition_history } = build;
    const controlled = withEnableControls(config, build, crafting_cycle_plan, transfer_plan.recipe_lcm, logger);
    const { duration, warmup_period } = runPeriodsOf(crafting_cycle_plan, transfer_plan.recipe_lcm, options, logger);

    const repeat_periods = warmUp(config, controlled, duration, warmup_period, debug, debug_steps, logger);
    const repeat_bin = options.detect_repeat === true && (options.simulate_periods ?? 1) > 1 ? provenRepeatBin(config, duration.ticks) : null;
    const simulated = simulate(build, controlled, all_output_inserters, duration, options, debug, debug_steps, logger, repeat_bin);
    const final_history = finalHistoryOf(build, crafting_cycle_plan, all_output_inserters, duration, logger);
    const output = checkOutput(build, controlled, planned_cycle, transfer_plan.recipe_lcm, duration, simulated, final_history, repeat_periods, logger);
    const backpressure_loss = backpressureLossOf(config, build, controlled, simulated, options, logger);

    return {
        simulation_context: build.simulation_context,
        new_simulation_context: controlled.new_simulation_context,
        target_production_rate: planned_cycle.target_production_rate,
        output_machine_state_machines: planned_cycle.output_machine_state_machines,
        output_inserters: planned_cycle.output_inserters,
        all_output_inserters,
        output_inserter_ids: output.output_inserter_ids,
        crafting_cycle_plan,
        swing_counts,
        recipe_lcm: transfer_plan.recipe_lcm,
        computed_lcm: transfer_plan.computed_lcm,
        serializable_transfer_plan: transfer_plan.serializable_transfer_plan,
        crafting_shares: controlled.crafting_shares,
        always_enabled_by_config: controlled.always_enabled_by_config,
        inserter_clocks: controlled.inserter_clocks,
        duration,
        recorded_duration: simulated.recorded_duration,
        ticks_simulated: warmup_period.ticks + simulated.recorded_duration.ticks,
        state_repeat: simulated.state_repeat,
        final_history,
        state_transition_history,
        fuel_levels: simulated.fuel_levels,
        machine_stock: simulated.machine_stock,
        timeline_recording: simulated.timeline_recording,
        stability_check: output.stability_check,
        total_expected_output: output.total_expected_output,
        used_terminal_swing_count: output.used_terminal_swing_count,
        backpressure_loss,
    };
}

/**
 * A build with what records its run. The recorded ticks count from `relative_tick.start`, which a step that starts
 * the count again moves on.
 */
interface RecordedBuild {
    simulation_context: SimulationContext;
    relative_tick: { start: number };
    relative_tick_provider: TickProvider;
    inventory_transfer_history: InventoryTransferHistory;
    state_transition_history: StateTransitionHistory;
    /** The plugins that only feed the two histories */
    history_plugins: ReadonlySet<ModePlugin<any>>;
}

/** Every plugin on the state machines of a simulation */
function pluginsOf(context: SimulationContext): ModePlugin<any>[] {
    return [...context.inserters, ...context.machines, ...context.drills].flatMap((it): ModePlugin<any>[] => it.getPlugins());
}

/** The simulation of a config, with the debug, transfer and state plugins on every entity; nothing is recorded yet */
function recordedBuildOf(config: Config, options: RunOptions, debug: MutableDebugSettingsProvider, logger: Logger): RecordedBuild {
    // Validate inserter coverage before building the entity graph.
    // Throws InserterCoverageError if any machine ingredient or output lacks an inserter.
    assertInserterCoverage(config);
    // Throws CopiesError if the config holds several identical units where it should describe one and set copies.
    validateCopies(config);

    // Initialize simulation context
    const simulation_context = SimulationContext.fromConfig(config);
    simulation_context.competing_takers_order = options.competing_takers_order ?? DEFAULT_TAKER_ORDER;
    if (options.moving_pickup_phases) simulation_context.initializeMovingPickupPhases(options.moving_pickup_phases);

    simulation_context.machines
        .map(it => it.machine_state.machine)
        .forEach(machine => Machine.printMachineFacts(machine, logger));

    const relative_tick_provider = new RelativeTickProvider(simulation_context.tick_provider);
    const relative_tick = relative_tick_provider;

    // Configure plugins. Debugging is only switched on for the steps debug_steps names (see withDebugFor): without
    // any, the debug plugins would log nothing and only cost time every tick.
    if (Object.values(options.debug_steps ?? {}).some(Boolean)) {
        configureDebugPlugins(simulation_context, relative_tick_provider, debug);
    }
    const plugins_before_histories = new Set(pluginsOf(simulation_context));
    const inventory_transfer_history = configureInventoryTransferPlugins(simulation_context, relative_tick_provider);
    const state_transition_history = configureStateTransitionPlugins(simulation_context, relative_tick_provider, options.factorio_states ?? true);
    const history_plugins = new Set(pluginsOf(simulation_context).filter(plugin => !plugins_before_histories.has(plugin)));
    inventory_transfer_history.recording = false;
    state_transition_history.recording = false;

    logger.log(`Created simulation context with ${simulation_context.machines.length} machines and ${simulation_context.inserters.length} inserters.`);

    return { simulation_context, relative_tick, relative_tick_provider, inventory_transfer_history, state_transition_history, history_plugins };
}

/**
 * The same build with nothing in it, as a staged scaffold is when its clock starts: no ingredient, product or fuel in a
 * machine, every bar and hand empty, and the chests and belts that feed it the supplies they always are. A recipe that
 * makes its own ingredient is given `overrides.loop_seed_items` of it once (see `seedLoopingRecipes`).
 */
function coldBuildOf(config: Config, options: RunOptions, debug: MutableDebugSettingsProvider, logger: Logger): RecordedBuild {
    const build = recordedBuildOf(config, options, debug, logger);
    seedLoopingRecipes(build.simulation_context, config.overrides?.loop_seed_items ?? DEFAULT_LOOP_SEED_ITEMS);
    return build;
}

/** Runs a step with debugging on when `debug_steps` asks for it for that step, and turns it off after */
function withDebugFor<T>(debug: MutableDebugSettingsProvider, debug_steps: DebugSteps, step: RunnerStepType, run: () => T): T {
    if (debug_steps[step]) {
        debug.enable();
    } else {
        debug.disable();
    }
    const result = run();
    debug.disable();
    return result;
}

/** Step 1: runs the build until every machine is output blocked; the recorded ticks count from there */
function prepareBuild(build: RecordedBuild, debug: MutableDebugSettingsProvider, debug_steps: DebugSteps, logger: Logger): void {
    const { simulation_context, inventory_transfer_history } = build;
    logger.log("Pre loading all machines until output blocked...");
    logger.log("Executing Prepare Step");
    withDebugFor(debug, debug_steps, RunnerStepType.PREPARE, () => {
        const prepare_step = new PrepareStep(simulation_context);
        prepare_step.execute();

        inventory_transfer_history.clear();
        build.relative_tick.start = simulation_context.tick_provider.getCurrentTick();
    });
}

/** Empties the output machines (unless kept) and puts in what the machines hold at the start, when one is given */
function setUpTheStart(
    simulation_context: SimulationContext,
    output_machine_state_machines: MachineStateMachine[],
    options: RunOptions,
    logger: Logger,
): void {
    // Clear final output machine buffers to prevent OUTPUT_FULL during simulation start
    // This is especially important for fractional swing scenarios where the machine
    // produces slightly more than what gets cleared per sub-cycle
    logger.log("Clearing final output machine buffers before warmup...");
    output_machine_state_machines.filter(() => !options.keep_output_buffers).forEach(machine_sm => {
        const machine_state = machine_sm.machine_state;
        const output_item = machine_state.machine.output.item_name;
        const current_qty = machine_state.inventoryState.getQuantity(output_item);
        if (current_qty > 0) {
            logger.log(`  Clearing ${current_qty} ${output_item} from ${machine_state.machine.entity_id}`);
            machine_state.inventoryState.setQuantity(output_item, 0);
        }
    });

    if (options.start_stock) {
        for (const { machine_state } of simulation_context.machines) {
            const start = options.start_stock[machine_state.machine.entity_id.id];
            if (start === undefined) {
                continue;
            }
            for (const [item_name, quantity] of Object.entries(start.items)) {
                MachineState.ingredientInventory(machine_state, item_name).setQuantity(item_name, quantity);
            }
            machine_state.craftingProgress.progress = start.crafting_progress ?? machine_state.craftingProgress.progress;
            machine_state.bonusProgress.progress = start.bonus_progress ?? machine_state.bonusProgress.progress;
            machine_state.pendingOutput = 0;
        }
        for (const { inserter_state } of simulation_context.inserters) {
            if (inserter_state.held_item !== null) {
                inserter_state.inventoryState.removeQuantity(inserter_state.held_item.item_name, inserter_state.held_item.quantity);
                inserter_state.held_item = null;
            }
        }
    }

    logger.log("All machines are output blocked.");
    simulation_context.machines.forEach(it => {
        MachineState.print(it.machine_state, logger);
    });
}

/** The transfer plan of the crafting cycle (see `transferPlanOf`), with its swing counts and distributions logged */
function planTransfers(config: Config, crafting_cycle_plan: CraftingCyclePlan, simulation_context: SimulationContext, logger: Logger): TransferPlan {
    EntityTransferCountMap.print(crafting_cycle_plan.entity_transfer_map, logger);
    const transfer_plan = transferPlanOf(config, crafting_cycle_plan, simulation_context);
    logger.log(`Simulation context ingredient LCM: ${transfer_plan.recipe_lcm}`);

    logger.log("\n--- Swing Distributions ---");
    if (crafting_cycle_plan.swing_distribution) {
        for (const [entityId, dist] of crafting_cycle_plan.swing_distribution.entries()) {
            logger.log(`Entity "${entityId}":`);
            logger.log(`  Total swings: ${dist.total_swings}`);
            logger.log(`  Swings per sub-cycle: [${dist.swings_per_subcycle.join(', ')}]`);
        }
    } else {
        logger.log("No swing distribution");
    }
    return transfer_plan;
}

/** The build with every inserter and drill on its enable control, and the clocks of the inserters outside the plan */
interface ControlledBuild {
    new_simulation_context: SimulationContext;
    /** Resets every enable control as a step starts */
    resettable_registry: ResettableRegistry;
    crafting_shares: Map<string, number>;
    always_enabled_by_config: Set<string>;
    inserter_clocks: Map<string, InserterClock>;
}

/**
 * Puts every inserter and drill on its enable control: the config's override where it has one, the one the plan
 * makes for it otherwise.
 */
function withEnableControls(
    config: Config,
    build: RecordedBuild,
    crafting_cycle_plan: CraftingCyclePlan,
    recipe_lcm: number,
    logger: Logger,
): ControlledBuild {
    const { simulation_context, relative_tick_provider } = build;

    // Create resettable registry for centralized reset management
    const resettable_registry = new ResettableRegistry();

    // Build enable control override map from config
    const enable_control_override_map = buildEnableControlOverrideMap(config);

    // Create configurable enable control factory for user overrides
    const configurable_enable_control_factory = new ConfigurableEnableControlFactory(
        enable_control_override_map,
        relative_tick_provider,
        crafting_cycle_plan,
        resettable_registry,
        simulation_context.state_registry
    );

    // Fuel is not part of the plan, so the fuel inserters swing on clocks of their own that repeat within the period
    const crafting_shares = plannedCraftingShares(simulation_context.entity_registry, crafting_cycle_plan);
    // The fuel clocks of the planning run are made from the crafting share of the plan. The exported ones are made
    // from what a run of the exported clock burns, once its windows are known: see settledFuelClocks.
    const always_enabled_by_config = alwaysEnabledByConfig(config);
    const inserter_clocks = unplannedInserterClocks(
        simulation_context.entity_registry,
        CraftingCyclePlan.ticksOfCycles(crafting_cycle_plan, recipe_lcm),
        crafting_shares,
        undefined,
        always_enabled_by_config,
    );

    // Create automatic enable control factory
    const enable_control_factory = new EnableControlFactory(
        simulation_context.state_registry,
        crafting_cycle_plan,
        relative_tick_provider,
        resettable_registry,
        logger,
        inserter_clocks,
    );

    // Clone simulation context with interceptors
    // Route to configurable factory if override mode is not AUTO, otherwise use automatic factory
    const new_simulation_context = cloneSimulationContextWithInterceptors(simulation_context, {
        drill: (drill_state) => {
            if (configurable_enable_control_factory.hasOverride(drill_state.entity_id)) {
                const override_mode = configurable_enable_control_factory.getOverrideOrThrow(drill_state.entity_id).mode;
                logger.log(`Using configurable enable control override for drill ${drill_state.entity_id.id} with mode ${override_mode}`);
                return configurable_enable_control_factory.createForEntityId(drill_state.entity_id);
            }
            return enable_control_factory.createForEntityId(drill_state.entity_id);
        },
        inserter: (inserter_state) => {
            if (configurable_enable_control_factory.hasOverride(inserter_state.entity_id)) {
                const override_mode = configurable_enable_control_factory.getOverrideOrThrow(inserter_state.entity_id).mode;
                logger.log(`Using configurable enable control override for inserter ${inserter_state.entity_id.id} with mode ${override_mode}`);
                return configurable_enable_control_factory.createForEntityId(inserter_state.entity_id, inserter_state.inserter);
            }
            return enable_control_factory.createForEntityId(inserter_state.entity_id);
        }
    });

    return { new_simulation_context, resettable_registry, crafting_shares, always_enabled_by_config, inserter_clocks };
}

/** How long a build runs: the period of the clock, and the warmup before it */
interface RunPeriods {
    duration: Duration;
    warmup_period: Duration;
}

/** The period of the plan and the warmup, shortened where a long period would take it past MAX_SIMULATION_TICKS */
function runPeriodsOf(crafting_cycle_plan: CraftingCyclePlan, recipe_lcm: number, options: RunOptions, logger: Logger): RunPeriods {
    const duration: Duration = Duration.ofTicks(options.period_ticks ?? options.timeline_recording?.period_ticks ?? CraftingCyclePlan.ticksOfCycles(crafting_cycle_plan, recipe_lcm));
    assert(Number.isFinite(duration.ticks) && duration.ticks > 0 && duration.ticks < MAX_SIMULATION_TICKS, `Clock period of ${duration.ticks} ticks exceeds maximum allowed ${MAX_SIMULATION_TICKS} ticks`);
    const requested_warmup_periods = options.warmup_periods ?? 10;
    // long periods (large ingredient LCMs) get fewer warmup periods to stay under the tick budget
    const warmup_periods = Math.min(requested_warmup_periods, Math.floor((MAX_SIMULATION_TICKS - 1) / duration.ticks));
    if (warmup_periods < requested_warmup_periods) {
        logger.log(`Warm up shortened to ${warmup_periods} periods to stay under ${MAX_SIMULATION_TICKS} ticks`);
    }
    const warmup_period: Duration = Duration.ofTicks(duration.ticks * warmup_periods);

    logger.log(`Base Cycle Ticks: ${crafting_cycle_plan.total_duration.ticks}`);
    logger.log(`Warm up period: ${warmup_period.ticks} ticks`);
    logger.log(`Simulation period: ${duration.ticks} ticks`);
    return { duration, warmup_period };
}

/**
 * Step 2: warms the build up. Returns the periods its state repeats over, when the warmup reached a repeating state;
 * a build that is not clocked throughout is not checked for one.
 */
function warmUp(
    config: Config,
    controlled: ControlledBuild,
    duration: Duration,
    warmup_period: Duration,
    debug: MutableDebugSettingsProvider,
    debug_steps: DebugSteps,
    logger: Logger,
): number | undefined {
    const { new_simulation_context, resettable_registry } = controlled;
    logger.log("Warming up simulation...");
    logger.log("Executing Warmup Step");
    // the clocks start here, on a cold build at its tick 0
    resettable_registry.resetAll(true);
    return withDebugFor(debug, debug_steps, RunnerStepType.WARM_UP, () => {
        const warmup_step = new WarmupStep(new_simulation_context, warmup_period,
            isPurelyClocked(config, duration.ticks)
                ? { period_ticks: duration.ticks, key: () => simulationStateKey(new_simulation_context) }
                : undefined);
        warmup_step.execute();
        if (warmup_step.ticks_run < warmup_period.ticks) {
            logger.log(`Warm up reached a repeating state after ${warmup_step.ticks_run} ticks`);
        }
        return warmup_step.repeat_periods;
    });
}

/**
 * A cold controlled build of a config for a trial that reads nothing but entity states: the staged scaffold's start
 * (nothing in the machines, the loop seeds given once), every inserter and drill on its enable control, and the
 * history plugins stripped, since nothing of such a run is recorded. The crafting cycle plan and its LCM come from a
 * run of the same build (rotating clock windows changes neither), so the prepare and planning steps are not run
 * again. The enable controls are reset before the build is handed over; its clock starts at tick 0.
 */
export function coldControlledTrialBuild(
    config: Config,
    crafting_cycle_plan: CraftingCyclePlan,
    recipe_lcm: number,
    options: Pick<RunOptions, "competing_takers_order" | "moving_pickup_phases">,
    logger: Logger,
): SimulationContext {
    const build = coldBuildOf(config, options, DebugSettingsProvider.mutable(), logger);
    const controlled = withEnableControls(config, build, crafting_cycle_plan, recipe_lcm, logger);
    const context = controlled.new_simulation_context;
    for (const state_machine of [...context.inserters, ...context.machines, ...context.drills]) {
        state_machine.removePlugins(build.history_plugins);
    }
    controlled.resettable_registry.resetAll(true);
    return context;
}

/**
 * The simulation state at a bin boundary of the recorded run came up at an earlier boundary. The build is on fixed
 * clocks and every clock stands at the same place at each boundary, so the run repeats the bins between the two
 * boundaries forever: what they hold is a proof of what the build does for good, not a sample of it.
 */
export interface StateRepeat {
    /** Whole ticks in a bin: the period, the whole-tick repeat of a fractional one, or their merge with own clocks */
    bin_ticks: number;
    /** Clock periods in a bin */
    periods_per_bin: number;
    /** The boundary whose state came up again, in bins from the start of the recorded run */
    from_bin: number;
    /** Bins from `from_bin` to where its state came up again: the run repeats these bins forever */
    cycle_bins: number;
}

/** What the recorded run yields beyond the histories of the build */
interface SimulatedRun {
    /** What was recorded: `simulate_periods` periods, or less when `detect_repeat` ended the run at a repeat */
    recorded_duration: Duration;
    /** The repeat that ended the run early, when `detect_repeat` found one */
    state_repeat?: StateRepeat;
    /** The states of the inserters that take the target item out of the build, as it runs */
    output_inserter_states: InserterState[];
    /** What those inserters had dropped before the recorded run */
    dropped_before_run: number;
    fuel_levels: FuelLevelSeries[] | undefined;
    machine_stock: StockRecording | undefined;
    timeline_recording?: TimelineRecording;
}

/** Step 3: runs the build for the periods asked for, with its transfers and states recorded */
function simulate(
    build: RecordedBuild,
    controlled: ControlledBuild,
    all_output_inserters: InserterState[],
    duration: Duration,
    options: RunOptions,
    debug: MutableDebugSettingsProvider,
    debug_steps: DebugSteps,
    logger: Logger,
    /** Bin at whose boundaries a repeated state repeats forever; the run stops early at a repeat (see detect_repeat) */
    repeat_bin: { ticks: number; periods: number } | null = null,
): SimulatedRun {
    const { simulation_context, inventory_transfer_history, state_transition_history } = build;
    const { new_simulation_context, resettable_registry } = controlled;
    logger.log(`Starting simulation for ${duration.ticks} ticks`);
    logger.log("Executing Simulate Step");
    inventory_transfer_history.clear();
    state_transition_history.clear();
    inventory_transfer_history.recording = true;
    state_transition_history.recording = true;
    const ticks_before_run = simulation_context.tick_provider.getCurrentTick() - build.relative_tick.start;
    inventory_transfer_history.ticks_before_run = ticks_before_run;
    build.relative_tick.start = simulation_context.tick_provider.getCurrentTick();
    // with no warm-up the clocks start with the recorded run; after one they have run since the warm-up started them
    resettable_registry.resetAll(ticks_before_run === 0);

    const simulate_periods = options.simulate_periods ?? 1;
    const recorded_duration = Duration.ofTicks(duration.ticks * simulate_periods);
    const fuel_level_recorder = options.fuel_levels
        ? new FuelLevelRecorder(new_simulation_context.machines.map(it => it.machine_state))
        : undefined;
    // What the output inserters drop in the recorded run is counted as they drop it. Their transfers are no measure
    // of it: a hand is recorded when the inserter is back, so one dropped in the last ticks of the run is missing.
    const output_inserter_states = new_simulation_context.inserters
        .map(it => it.inserter_state)
        .filter(state => all_output_inserters.some(os => os.inserter.entity_id.id === state.entity_id.id));
    const dropped_before_run = output_inserter_states.reduce((sum, state) => sum + state.items_dropped, 0);
    const stock_recorder = options.machine_stock
        ? new StockRecorder(new_simulation_context.machines.map(it => it.machine_state), new_simulation_context.inserters.map(it => ({ state: it.inserter_state, sink: it.sink_state })))
        : undefined;
    const timeline_recorder = options.timeline_recording
        ? new TimelineRecorder(new_simulation_context, options.timeline_recording)
        : undefined;
    let state_repeat: StateRepeat | undefined;
    let stop_early: (() => boolean) | undefined;
    if (repeat_bin !== null && repeat_bin.ticks < recorded_duration.ticks) {
        const boundary_by_key = new Map<string, number>();
        const first_tick = new_simulation_context.tick_provider.getCurrentTick();
        boundary_by_key.set(simulationStateKey(new_simulation_context), 0);
        stop_early = () => {
            const ticks = new_simulation_context.tick_provider.getCurrentTick() - first_tick;
            if (ticks % repeat_bin.ticks !== 0) {
                return false;
            }
            const boundary = ticks / repeat_bin.ticks;
            const key = simulationStateKey(new_simulation_context);
            const earlier = boundary_by_key.get(key);
            if (earlier !== undefined) {
                state_repeat = { bin_ticks: repeat_bin.ticks, periods_per_bin: repeat_bin.periods, from_bin: earlier, cycle_bins: boundary - earlier };
                return true;
            }
            boundary_by_key.set(key, boundary);
            return false;
        };
    }
    const simulate_step = new SimulateStep(new_simulation_context, recorded_duration,
        (fuel_level_recorder || stock_recorder || timeline_recorder) && (() => { fuel_level_recorder?.record(); stock_recorder?.record(); timeline_recorder?.record(); }),
        stop_early);
    withDebugFor(debug, debug_steps, RunnerStepType.SIMULATE, () => simulate_step.execute());

    const actual_duration = simulate_step.ticks_run < recorded_duration.ticks ? Duration.ofTicks(simulate_step.ticks_run) : recorded_duration;
    if (state_repeat !== undefined) {
        logger.log(`Simulation repeats: the state at bin ${state_repeat.from_bin + state_repeat.cycle_bins} equals bin ${state_repeat.from_bin} (${state_repeat.bin_ticks} ticks a bin), so the run repeats those ${state_repeat.cycle_bins} bins forever`);
    }
    logger.log(`Simulation complete`);

    return {
        recorded_duration: actual_duration,
        state_repeat,
        output_inserter_states,
        dropped_before_run,
        fuel_levels: fuel_level_recorder?.series(),
        machine_stock: stock_recorder?.recording(),
        timeline_recording: timeline_recorder?.recording("clock", actual_duration.ticks,
            inventory_transfer_history.ticks_before_run, new_simulation_context.target_production_rate.copies),
    };
}

/** The transfers of the recorded run, as the windows of the plan are read off them */
function finalHistoryOf(
    build: RecordedBuild,
    crafting_cycle_plan: CraftingCyclePlan,
    all_output_inserters: InserterState[],
    duration: Duration,
    logger: Logger,
): InventoryTransferHistory {
    const { simulation_context, inventory_transfer_history } = build;
    // Process transfer history
    const merged_ranges = InventoryTransferHistory.mergeOverlappingRanges(inventory_transfer_history);
    const offset_history = InventoryTransferHistory.correctNegativeOffsets(merged_ranges);
    const trimmed_history = InventoryTransferHistory.trimEndsToAvoidBackSwingWakeLists(
        offset_history,
        simulation_context.entity_registry,
        crafting_cycle_plan.entity_transfer_map,
        duration.ticks,
    );
    const final_history = windowsOfThePlanWhereInsertersRunFree(
        clipBeltFillerWindows(
            trimmed_history,
            simulation_context.entity_registry,
            new Set(all_output_inserters.map(os => os.inserter.entity_id.id)),
        ),
        simulation_context.entity_registry,
        crafting_cycle_plan,
        duration.ticks,
    );

    logger.log("\n--- Transfer History ---");
    InventoryTransferHistory.print(final_history, logger);
    return final_history;
}

/** What the recorded run made, against what the plan expects */
interface OutputCheck {
    output_inserter_ids: Set<string>;
    stability_check: SimulationStabilityCheck;
    total_expected_output: number;
    used_terminal_swing_count: number;
}

/**
 * Counts what the recorded run made against what the plan expects, the lanes it exports against what their consumers
 * take, and, when the warmup found the state repeating over several periods, the output over all of them.
 */
function checkOutput(
    build: RecordedBuild,
    controlled: ControlledBuild,
    planned_cycle: PlannedCraftingCycle,
    recipe_lcm: number,
    duration: Duration,
    simulated: SimulatedRun,
    final_history: InventoryTransferHistory,
    repeat_periods: number | undefined,
    logger: Logger,
): OutputCheck {
    const { simulation_context, inventory_transfer_history, state_transition_history } = build;
    const { output_inserters, all_output_inserters, crafting_cycle_plan } = planned_cycle;
    const { output_inserter_states, dropped_before_run } = simulated;
    const swing_counts = crafting_cycle_plan.entity_transfer_map;

    // Compute output stability: compare actual items transferred by output inserters
    // against the expected amount derived from the crafting cycle plan.
    const output_inserter_ids = new Set(all_output_inserters.map(os => os.inserter.entity_id.id));
    const total_actual_output = output_inserter_states.reduce((sum, state) => sum + state.items_dropped, 0) - dropped_before_run;
    let total_expected_output_float = 0;
    for (const [entity_id, etc] of swing_counts.entries()) {
        if (output_inserter_ids.has(entity_id.id)) {
            total_expected_output_float += etc.total_transfer_count.toDecimal() * etc.stack_size * recipe_lcm;
        }
    }
    const total_expected_output = Math.round(total_expected_output_float);
    // The output swings of one output machine a cycle, over all the inserters that take from it
    const first_output_machine_id = output_inserters[0].inserter.source.entity_id.id;
    let swings_of_first_output_machine = 0;
    for (const [entity_id, etc] of swing_counts.entries()) {
        if (output_inserter_ids.has(entity_id.id) && Entity.isInserter(etc.entity) && etc.entity.source.entity_id.id === first_output_machine_id) {
            swings_of_first_output_machine += etc.total_transfer_count.toDecimal();
        }
    }
    const used_terminal_swing_count = Math.max(1, Math.round(swings_of_first_output_machine));

    const export_shortfalls = exportedLanesShortOfConsumption(simulation_context.entity_registry, final_history, output_inserter_ids, duration.ticks);
    for (const lane of export_shortfalls) {
        logger.log(`Stability check: belt ${lane.belt_id} ${lane.item} exported ${Number(lane.delivered_per_second.toFixed(2))} a second, consumers take ${lane.expected_per_second}`);
    }

    const full_output_chests = fullOutputChestsOf(controlled.new_simulation_context, output_inserter_states);

    // the simulated period can hit the expected output while the periods it alternates with fall short
    let repeat_output_items: number | undefined;
    if (repeat_periods !== undefined && repeat_periods > 1 && duration.ticks * repeat_periods < MAX_SIMULATION_TICKS) {
        state_transition_history.recording = false;
        new SimulateStep(controlled.new_simulation_context, Duration.ofTicks(duration.ticks * (repeat_periods - 1))).execute();
        repeat_output_items = 0;
        for (const [entity_id, transfers] of inventory_transfer_history.entries()) {
            if (output_inserter_ids.has(entity_id.id)) {
                repeat_output_items += transfers.reduce((s, t) => s + t.amount, 0);
            }
        }
        logger.log(`Stability check: state repeats every ${repeat_periods} periods, output over them=${repeat_output_items}`);
    }
    const repeats_at_expected_output = repeat_periods === undefined || repeat_output_items === undefined
        || Math.abs(repeat_output_items - total_expected_output_float * repeat_periods) <= LCM_STABILITY_TOLERANCE * repeat_periods;

    const stability_check: SimulationStabilityCheck = {
        holds: Math.abs(total_actual_output - total_expected_output) <= LCM_STABILITY_TOLERANCE && export_shortfalls.length === 0
            && repeats_at_expected_output,
        actual_output_items: total_actual_output,
        expected_output_items: total_expected_output,
        used_lcm: recipe_lcm,
        repeat_periods,
        repeat_output_items,
        ...(full_output_chests.length > 0 && { full_output_chests }),
        ...(export_shortfalls.length > 0 && { export_shortfalls }),
    };
    logger.log(`Stability check: actual=${total_actual_output} expected=${total_expected_output} stable=${stability_check.holds} (tolerance=${LCM_STABILITY_TOLERANCE})`);

    return { output_inserter_ids, stability_check, total_expected_output, used_terminal_swing_count };
}

/**
 * With the backpressure_loss option: the trials of the loss, from where the recorded run ended (see
 * backpressure-loss.ts). Nothing of them goes into the run's histories.
 */
function backpressureLossOf(
    config: Config,
    build: RecordedBuild,
    controlled: ControlledBuild,
    simulated: SimulatedRun,
    options: RunOptions,
    logger: Logger,
): LossOutcome | undefined {
    if (!options.backpressure_loss) {
        return undefined;
    }
    // the run above is over: the trials go on from where it ended, and nothing of them goes into its histories
    build.inventory_transfer_history.recording = false;
    build.state_transition_history.recording = false;
    // so the plugins that feed them have nothing to do: a trial ticks a few hundred thousand times
    const trial_context = controlled.new_simulation_context;
    for (const state_machine of [...trial_context.inserters, ...trial_context.machines, ...trial_context.drills]) {
        state_machine.removePlugins(build.history_plugins);
    }
    const loss_period = options.backpressure_loss.period_ticks;
    const repeat = subtickClockForPeriod(loss_period);
    const bin = Number.isInteger(loss_period) ? { ticks: loss_period, periods: 1 }
        : repeat === null ? null : { ticks: repeat.period_ticks, periods: repeat.scale };
    assert(bin !== null, `A clock of ${Number(loss_period.toFixed(3))} ticks does not repeat in whole ticks, so its output cannot be counted by the period`);
    const own_clock_ticks = Array.from(controlled.inserter_clocks.values()).filter(clock => clock.own_clock).map(clock => clock.modulus);
    // boundaries a whole proven bin apart repeat for good; in bins of the period that is every `stride`-th boundary
    const proven_bin = provenRepeatBin(config, loss_period);
    const proof_stride = proven_bin !== null && Number.isInteger(proven_bin.ticks / bin.ticks) ? proven_bin.ticks / bin.ticks : null;
    // the belts with a consumption rate have to keep receiving it, as the output keeps coming
    const inserter_states = new Map(trial_context.inserters.map(it => [it.inserter_state.entity_id.id, it.inserter_state] as const));
    const watched_exports = exportedItemsOf(trial_context.entity_registry, new Set(simulated.output_inserter_states.map(state => state.entity_id.id)))
        .map(exported => ({ exported, fillers: exported.filler_ids.flatMap(id => inserter_states.get(id) ?? []) }));
    const backpressure_loss = runLossTrials(trial_context, simulated.output_inserter_states, options.backpressure_loss, bin,
        Math.max(bin.ticks, ...own_clock_ticks), proof_stride, watched_exports);
    logger.log(`Backpressure loss (${options.backpressure_loss.loss.kind}): recovers=${backpressure_loss.recovers} over ${backpressure_loss.trials.length} trials`);
    return backpressure_loss;
}

/**
 * What a trial of a clock yields: the clock-only run of a build, as its blueprint runs it, with what it moved and
 * what was recorded of it. It plans nothing of its own and exports nothing.
 */
export interface TrialRun {
    /** On-demand timeline detail; absent from normal generation runs. */
    timeline_recording?: TimelineRecording;
    /** What the run moved against what the plan expects */
    stability_check: SimulationStabilityCheck;
    simulation_duration: Duration;
    transfer_history: InventoryTransferHistory;
    serializable_transfer_history: SerializableTransferHistory;
    serializable_state_transition_history: SerializableStateTransitionHistory;
    /** Insertion limits, crafting time and output per craft of every machine */
    machine_facts: MachineFactsEntry[];
    /** With the fuel_levels option: the fuel each burner machine held over the run */
    fuel_levels?: FuelLevelSeries[];
    /** With the machine_stock option: what every machine and inserter held after each tick of the run */
    machine_stock?: StockRecording;
    /** With the backpressure_loss option: what the build made after each trial of the loss */
    backpressure_loss?: LossOutcome;
    /** With the detect_repeat option: the repeat that ended the recorded run early, when one was found */
    state_repeat?: StateRepeat;
}

export function trialRunOf(run: BuildRun): TrialRun {
    return {
        timeline_recording: run.timeline_recording,
        state_repeat: run.state_repeat,
        stability_check: run.stability_check,
        simulation_duration: run.duration,
        transfer_history: run.final_history,
        serializable_transfer_history: serializeTransferHistory(run.final_history, run.simulation_context.entity_registry, run.recorded_duration.ticks),
        serializable_state_transition_history: serializeStateTransitionHistory(run.state_transition_history, run.simulation_context.entity_registry, run.recorded_duration.ticks),
        machine_facts: run.simulation_context.machines.map(it => ({
            entity_id: it.machine_state.machine.entity_id.id,
            facts: Machine.getMachineFacts(it.machine_state.machine),
        })),
        fuel_levels: run.fuel_levels,
        machine_stock: run.machine_stock,
        backpressure_loss: run.backpressure_loss,
    };
}

/** The options of GenerateClockOptions the planning run itself reads */
type PlanRunOptions = Pick<GenerateClockOptions, "debug" | "debug_steps" | "logger" | "factorio_states">;

/** The planning run of a build, with what a clock and its export read off it */
export interface PlanRun {
    config: Config;
    logger: Logger;
    run: BuildRun;
    /** The windows read off the planning run, before any room is added to them (see `clockOfPlan`) */
    unslacked_windows: Map<string, OpenRange[]>;
    /**
     * The items each inserter or drill moves, by entity id: they keep the inserters outside the plan (a fuel or by-product
     * inserter) with identical windows from being deduplicated into one combinator when they carry different items.
     */
    item_names: Map<string, string>;
    /** The EntityId of every entity, the history's own where it has one: the blueprint looks up swing counts by EntityId identity */
    entity_ids: Map<string, EntityId>;
}

/**
 * Plans a clock for a configuration: the build is run with each inserter waiting on its machine's inventory (see
 * `runBuild`), and each inserter's windows are the ticks it moved items. Nothing is checked and nothing is exported
 * here: the clock of the plan is `clockOfPlan`, its check and export `checkedClock`.
 */
export function planRun(config: Config, options: PlanRunOptions = {}): PlanRun {
    const logger = options.logger ?? defaultLogger;
    const run = runBuild(config, { logger, debug: options.debug, debug_steps: options.debug_steps, factorio_states: options.factorio_states });
    // Throws LaneCapacityError if one unit asks a belt lane for more than it carries; after the run, so the planner's
    // own refusal of the target comes first
    assertLaneCapacity(config);
    const { simulation_context, final_history, always_enabled_by_config } = run;
    const unslacked_windows = windowsFromHistory(final_history, simulation_context.entity_registry, always_enabled_by_config);
    const entity_ids = new Map(simulation_context.entity_registry.getAll().map(entity => [entity.entity_id.id, entity.entity_id]));
    for (const entity_id of final_history.getAllTransfers().keys()) {
        // the blueprint looks up swing counts by EntityId identity, so prefer the history's own keys
        entity_ids.set(entity_id.id, entity_id);
    }
    // item names keep inserters outside the plan with identical windows from being deduplicated into one combinator
    const item_names = new Map(Array.from(final_history.entries(), ([entity_id, transfers]) =>
        [entity_id.id, Array.from(new Set(transfers.map(t => t.item_name))).sort().join(",")] as const
    ));
    // an inserter with a clock of its own takes the items it carries from the inserter: its transfers are not always in
    // the history, and its own name would keep inserters with the same windows from being merged into one combinator
    for (const inserter of [
        ...fuelOnlyInserters(simulation_context.entity_registry),
        ...byProductOnlyInserters(simulation_context.entity_registry),
    ]) {
        item_names.set(inserter.entity_id.id, Array.from(inserter.filtered_items).sort().join(","));
    }
    return { config, logger, run, unslacked_windows, item_names, entity_ids };
}

/** The clock of a plan: the plan's windows with the room they get, and the belt that makes it for */
interface PlannedClock {
    windows: Map<string, OpenRange[]>;
    /** The belt the clock is made for; null when no inserter with windows picks up from a belt */
    belt: ClockBelt | null;
    /** The belt pickup slack of every belt-fed inserter, for windows made anew from a run of the build (observed windows); empty when the clock goes without */
    belt_pickup_slack: Map<string, number>;
    /** Ticks of belt pickup slack added to each belt-fed inserter's windows; empty when none was applied */
    applied_belt_pickup_slack: Record<string, number>;
    belt_pickup_slack_left_out: boolean;
    /** Ticks added to each window of an inserter that takes fuel off a belt as well as an ingredient (see fuelHandRoomTicks) */
    fuel_hand_room: Map<string, number>;
    /** The clock-only check the slack decision already ran on exactly `windows`, which checkedClock reuses */
    as_built_run: AsBuiltRun | null;
    /** The groups that take turns in the windows, which the blueprint lays its combinators out by; absent where the windows are not in groups */
    turns?: TurnGroup[];
}

/**
 * The windows of the plan with the room a clock gets: belt pickup slack as the option asks ("auto" keeps it unless a
 * clock-only check gets worse, which costs trials; never on backed-up belts), or room for a hand of fuel where
 * asked for. The belt the clock is made for is read off that.
 */
export function clockOfPlan(plan: PlanRun, options: Pick<GenerateClockOptions, "belt_pickup_slack" | "fuel_hand_room"> = {}): PlannedClock {
    const { config, logger, unslacked_windows, run: { simulation_context, duration, total_expected_output } } = plan;
    const full_belt_pickup_slack = beltPickupSlackTicks(simulation_context.entity_registry);
    // on backed-up belts a clock is made without the slack, whatever the alternative asks for
    const backed_up_belts = config.overrides?.backed_up_belts === true;
    const belt_pickup_slack_mode = backed_up_belts ? "never" : options.belt_pickup_slack ?? "auto";
    const slack_trial = belt_pickup_slack_mode === "auto"
        ? beltPickupSlackTrial(config, unslacked_windows, full_belt_pickup_slack, duration.ticks, total_expected_output, logger)
        : null;
    const use_belt_pickup_slack = belt_pickup_slack_mode === "always" || (slack_trial !== null && slack_trial.helps);
    const belt_pickup_slack = use_belt_pickup_slack ? full_belt_pickup_slack : new Map<string, number>();
    // the slack only lengthens a window there is, and only in a period of whole ticks (see withBeltPickupSlack)
    const belt_fed_with_windows = Array.from(unslacked_windows)
        .filter(([key, ranges]) => ranges.length > 0 && (full_belt_pickup_slack.get(key) ?? 0) > 0)
        .map(([key]) => key);
    const applied_belt_pickup_slack = Object.fromEntries(Number.isInteger(duration.ticks)
        ? belt_fed_with_windows.filter(key => belt_pickup_slack.has(key)).map(key => [key, belt_pickup_slack.get(key)!])
        : []);
    // the slack is as long as the room for a hand of fuel, so a clock with the slack has the room
    const fuel_hand_room = options.fuel_hand_room && !use_belt_pickup_slack && Number.isInteger(duration.ticks)
        ? new Map(Array.from(fuelHandRoomTicks(simulation_context.entity_registry)).filter(([key]) => (unslacked_windows.get(key)?.length ?? 0) > 0))
        : new Map<string, number>();
    const belt_pickup_slack_left_out = !backed_up_belts && !use_belt_pickup_slack && Number.isInteger(duration.ticks)
        && belt_fed_with_windows.length > 0;
    const slack_ticks = Array.from(new Set(Object.values(applied_belt_pickup_slack))).sort((a, b) => a - b);
    const belt: ClockBelt | null = belt_fed_with_windows.length === 0 ? null
        : slack_ticks.length > 0 ? { kind: "moving", slack_ticks } : { kind: "backed_up" };
    // the slack decision already checked the slacked windows: hand its run over, with the exact map it ran on
    // (with the slack in use the fuel hand room is empty, so these are the windows the clock gets)
    const verified = use_belt_pickup_slack ? slack_trial?.verified ?? null : null;
    const windows = verified !== null ? verified.windows
        : withBeltPickupSlack(unslacked_windows, new Map([...fuel_hand_room, ...belt_pickup_slack]), duration.ticks);
    return { windows, belt, belt_pickup_slack, applied_belt_pickup_slack, belt_pickup_slack_left_out, fuel_hand_room, as_built_run: verified?.run ?? null };
}

/** What a clock's export carries beyond the plan and its windows */
interface ClockExportExtras {
    /**
     * The run whose histories the result carries, when it is not the planning run: observed windows are what the
     * inserters did in a trial of the clock, so that trial is the run shown
     */
    histories?: TrialRun;
    clock_only_run?: ClockOnlyRun;
    loop_windows?: BlueprintGenerationResult["loop_windows"];
    search?: SearchReport;
    derived_clock_windows?: DerivedClockWindowsReport;
    /** Item names for the blueprint in place of the plan's: identical windows and items share one combinator */
    item_names?: ReadonlyMap<string, string>;
    /** In place of the clock's: observed windows are what the inserters did, fuel hands included, so they have none */
    fuel_hand_room_ticks?: Record<string, number>;
    /** The inserters the strategy that made the windows left without one, with its reason */
    left_open?: ReadonlyMap<string, AlwaysOnReason>;
}

/**
 * Exports a clock: its blueprints (plain, modulo and subtick where they apply), its fuel clocks and the view of the
 * fuel being consumed, with the plan, the histories and the checks of the result. The fuel clocks are settled before
 * the blueprint, which exports them.
 */
export function exportClock(
    plan: PlanRun,
    clock: PlannedClock,
    windows: Map<string, OpenRange[]>,
    options: Pick<GenerateClockOptions, "fuel_consumption_view" | "modulo_blueprint"> = {},
    extras: ClockExportExtras = {},
): BlueprintGenerationResult {
    const { entity_ids } = plan;
    const {
        simulation_context, target_production_rate, crafting_cycle_plan, recipe_lcm, computed_lcm, serializable_transfer_plan,
        duration, recorded_duration, final_history, state_transition_history, stability_check, used_terminal_swing_count,
    } = plan.run;
    // the windows of the drills into chests, from their takers' as the clock-only check made them (see runAsBuiltCheck)
    const chest_drill_clock = chestDrillWindows(plan.config, windows, duration.ticks);
    windows = chest_drill_clock.windows;
    for (const drill of chest_drill_clock.drills) {
        plan.logger.log(chestDrillClockLine(drill));
    }
    const item_names = new Map(plan.item_names);
    for (const [key, name] of extras.item_names ?? []) {
        item_names.set(key, name);
    }
    const subtick_clock = subtickClockForPeriod(duration.ticks);

    // before the blueprint, which exports the fuel clocks this settles on
    const { inserter_clocks, fuel_plan, fuel_consumption_view } = settledFuelClocks(plan, windows, options);

    const clock_windows = withInserterClocks(windows, inserter_clocks, duration.ticks);
    const always_on_reasons = alwaysOnReasons(
        simulation_context.entity_registry,
        id => clock_windows.has(id) || inserter_clocks.get(id)?.own_clock === true,
        {
            enable_rule: plan.run.always_enabled_by_config,
            left_open: extras.left_open ?? new Map(),
            chest_drills: chest_drill_clock.drills,
            swung: new Set(Array.from(final_history.entries()).filter(([, transfers]) => transfers.length > 0).map(([entity_id]) => entity_id.id)),
        },
    );

    const blueprintForWindows = (all_windows: Map<string, OpenRange[]>, subtick_clock?: SubtickClock, use_modulo = false): SignalPerInserterBlueprint => {
        const clocked = withInserterClocks(all_windows, inserter_clocks, duration.ticks);
        return createSignalPerInserterBlueprint(
            target_production_rate.machine_production_rate.item,
            crafting_cycle_plan,
            duration,
            recipe_lcm,
            InventoryTransferHistory.removeDuplicateEntities(new InventoryTransferHistory(new Map(
                Array.from(clocked.entries()).map(([key, ranges]) => [
                    entity_ids.get(key)!,
                    // the entities of the plan share a combinator whatever they carry; one outside it, by the items it carries
                    ranges.map(tick_range => ({ item_name: inserter_clocks.has(key) ? item_names.get(key) ?? key : "", tick_range, amount: 0 })),
                ])
            ))),
            simulation_context.entity_registry,
            subtick_clock,
            use_modulo,
            inserter_clocks,
            clock.turns,
        );
    };
    const moduloBlueprintFor = (all_windows: Map<string, OpenRange[]>) => {
        if (options.modulo_blueprint === false) {
            return undefined;
        }
        const exported = blueprintForWindows(all_windows, undefined, true);
        // only worth offering when a window repeats within the period: a fuel clock alone is a modulo of the clock too
        return exported.modulo ? exported : undefined;
    };
    const subtickClockFor = (all_windows: Map<string, OpenRange[]>) => {
        if (!subtick_clock) {
            return undefined;
        }
        const { blueprint, schedule } = blueprintForWindows(all_windows, subtick_clock);
        return { clock: subtick_clock, blueprint, schedule };
    };

    const { blueprint, schedule } = blueprintForWindows(windows);
    const modulo = moduloBlueprintFor(windows);
    const histories: Pick<TrialRun, "simulation_duration" | "transfer_history" | "serializable_transfer_history" | "serializable_state_transition_history" | "machine_facts"> =
        extras.histories ?? {
            simulation_duration: duration,
            transfer_history: final_history,
            serializable_transfer_history: serializeTransferHistory(final_history, simulation_context.entity_registry, recorded_duration.ticks),
            serializable_state_transition_history: serializeStateTransitionHistory(state_transition_history, simulation_context.entity_registry, recorded_duration.ticks),
            machine_facts: simulation_context.machines.map(it => ({
                entity_id: it.machine_state.machine.entity_id.id,
                facts: Machine.getMachineFacts(it.machine_state.machine),
            })),
        };
    return {
        ...histories,
        blueprint,
        schedule,
        modulo_blueprint: modulo?.blueprint,
        modulo_schedule: modulo?.schedule,
        subtick: subtickClockFor(windows),
        clock_windows: serializeClockWindows(clock_windows),
        belt_pickup_slack_ticks: clock.applied_belt_pickup_slack,
        belt_pickup_slack_left_out: clock.belt_pickup_slack_left_out,
        fuel_hand_room_ticks: extras.fuel_hand_room_ticks ?? Object.fromEntries(clock.fuel_hand_room),
        belt: clock.belt,
        crafting_cycle_plan,
        loop_windows: extras.loop_windows,
        search: extras.search,
        clock_only_run: extras.clock_only_run,
        fuel_consumption_view,
        unplanned_inserter_clocks: serializeInserterClocks(inserter_clocks),
        fuel_plan,
        used_lcm: recipe_lcm,
        used_terminal_swing_count,
        stability_check,
        serializable_transfer_plan,
        computed_lcm,
        derived_clock_windows: extras.derived_clock_windows,
        ...(chest_drill_clock.drills.length > 0 ? { chest_drills: chest_drill_clock.drills } : {}),
        ...(Object.keys(always_on_reasons).length > 0 ? { always_on_reasons } : {}),
    };
}

/** The fuel clocks an exported clock settles on, with the plan of the fuel they keep up and the view of it being consumed */
interface SettledFuelClocks {
    inserter_clocks: Map<string, InserterClock>;
    fuel_plan: FuelPlan | undefined;
    fuel_consumption_view: FuelConsumptionView | undefined;
}

/**
 * Runs the exported clock for several periods, makes the fuel clocks from what the machines burned in it, and runs
 * it again with those. A machine burns in bursts, more in a stretch that starts as it begins to craft than its
 * crafting share says, and how often it stops depends on the windows: the run has both. The fuel clocks of the
 * plan stay when there is no run, or when a machine ran out of fuel with the measured ones.
 */
function settledFuelClocks(
    plan: PlanRun,
    windows: Map<string, OpenRange[]>,
    options: Pick<GenerateClockOptions, "fuel_consumption_view">,
): SettledFuelClocks {
    const { config, logger } = plan;
    const { simulation_context, crafting_shares, always_enabled_by_config, duration, inserter_clocks } = plan.run;
    const fuel_plan = fuelPlan(simulation_context.entity_registry, inserter_clocks, crafting_shares, duration.ticks);
    const keptFromThePlan = (fuel_consumption_view: FuelConsumptionView | undefined): SettledFuelClocks =>
        ({ inserter_clocks, fuel_plan, fuel_consumption_view });

    // the view is for fuel: a clock for an inserter taking a by-product off a machine does not need a longer run
    const has_fuel_inserter = Array.from(inserter_clocks.values()).some(it => it.kind === "fuel");
    if (!has_fuel_inserter || options.fuel_consumption_view === false) {
        return keptFromThePlan(undefined);
    }
    const planned_view = fuelConsumptionView(config, windows, inserter_clocks, duration.ticks, logger, false);
    if (planned_view === undefined || planned_view.ran_out_of_fuel) {
        return keptFromThePlan(planned_view);
    }
    const limit_lasted = new Map(planned_view.fuel_levels.flatMap(levels => levels.limit_lasts_ticks === null
        ? []
        : [[levels.machine_id, levels.limit_lasts_ticks] as const]));
    const measured_intervals = limit_lasted;
    let measured_clocks: Map<string, InserterClock>;
    try {
        measured_clocks = unplannedInserterClocks(simulation_context.entity_registry, duration.ticks, crafting_shares, measured_intervals, always_enabled_by_config);
    } catch (error) {
        logger.log(`Fuel clocks: kept from the plan, the measured ones cannot be made (${error instanceof Error ? error.message : error})`);
        return keptFromThePlan(planned_view);
    }
    const same = Array.from(measured_clocks, ([id, it]) => {
        const planned = inserter_clocks.get(id);
        return planned !== undefined && planned.modulus === it.modulus
            && planned.window.start_inclusive === it.window.start_inclusive && planned.window.end_inclusive === it.window.end_inclusive;
    }).every(Boolean);
    if (same) {
        return {
            inserter_clocks,
            fuel_plan: fuelPlan(simulation_context.entity_registry, inserter_clocks, crafting_shares, duration.ticks, limit_lasted),
            fuel_consumption_view: planned_view,
        };
    }
    // Long enough for the fuel clocks to meet the clock of the period every way they do, twice over: the fuel a
    // machine is down to depends on where its fuel windows fall in what it does
    const measured_fuel_ticks = Array.from(measured_clocks.values()).filter(it => it.kind === "fuel").map(it => it.modulus);
    const merged_ticks = mergedClockTicks(duration.ticks, measured_fuel_ticks);
    const measured_view = fuelConsumptionView(config, windows, measured_clocks, duration.ticks, logger, true,
        merged_ticks === null ? 0 : 2 * merged_ticks);
    if (measured_view === undefined || measured_view.ran_out_of_fuel) {
        logger.log("Fuel clocks: kept from the plan, a machine ran out of fuel with the measured ones");
        return keptFromThePlan(planned_view);
    }
    logger.log(`Fuel clocks: made from the measured burn (${Array.from(measured_clocks.values()).filter(it => it.kind === "fuel").map(it => `${it.inserter_id} every ${it.modulus}`).join(", ")})`);
    return {
        inserter_clocks: measured_clocks,
        fuel_plan: fuelPlan(simulation_context.entity_registry, measured_clocks, crafting_shares, duration.ticks, limit_lasted),
        fuel_consumption_view: measured_view,
    };
}

/** The clock-only run of a trial, as the result carries it */
export function clockOnlyRunOf(run: TrialRun): ClockOnlyRun {
    return {
        transfer_history: run.serializable_transfer_history,
        state_transition_history: run.serializable_state_transition_history,
    };
}

/**
 * The tail every clock made from a plan goes through: with `verify_as_built`, the clock-only check of the windows
 * (the build driven by them alone, from several start phases and over a long run) and, where it holds, the windows
 * of the inserters that take out of a loop of machines (unless `loop_windows` is false); then the export. The
 * plan's `stability_check` takes the check's verdict.
 *
 * The windows of the loop are tried wherever the clock-only check holds, whether the planning run held or not: the
 * planning run of a build with a loop lets the loop run free, and on agricultural science makes 432 of the 400 a period
 * of every clock, whose verdict follows the clock-only check alone (see `holds` in alternatives.ts).
 */
export function checkedClock(
    plan: PlanRun,
    clock: PlannedClock,
    windows: Map<string, OpenRange[]>,
    options: GenerateClockOptions = {},
    extras: Pick<ClockExportExtras, "search" | "left_open"> & {
        /** A search's confirmation that passed on exactly `windows`, whose early stages the check here takes over */
        verified?: { windows: Map<string, OpenRange[]>; run: AsBuiltRun };
    } = {},
): BlueprintGenerationResult {
    const { config, logger, run: { stability_check, total_expected_output, duration } } = plan;
    let clock_only_run: ClockOnlyRun | undefined;
    let loop_windows: BlueprintGenerationResult["loop_windows"];
    let item_names: ReadonlyMap<string, string> | undefined;
    if (options.verify_as_built ?? false) {
        // the identical check may have run for the slack decision on exactly these windows (see clockOfPlan)
        const as_built_run = clock.as_built_run !== null && windows === clock.windows ? clock.as_built_run
            : runAsBuiltCheck(config, windows, duration.ticks, logger, AS_BUILT_START_PHASES,
                (n, total) => options.on_progress_detail?.(`Checking clock-only output, clock start ${n}/${total}`),
                FREE_RUNNING_CHECK_TICKS,
                // a confirmed search pick ran the same unshifted run, pickup phase starts and long run on these windows
                extras.verified !== undefined && extras.verified.windows === windows
                    ? { run: extras.verified.run, long_run_ticks: FREE_RUNNING_CHECK_TICKS } : undefined);
        let kept_run = as_built_run;
        if (as_built_run.check.holds && options.loop_windows !== false) {
            const looped = trialWithLoopWindows(config, windows, duration.ticks, as_built_run, AS_BUILT_START_PHASES, logger, options.on_progress_detail);
            if (looped !== null) {
                kept_run = looped;
                windows = looped.windows;
                loop_windows = looped.loop_windows;
                item_names = looped.item_names;
            }
        }
        stability_check.as_built = kept_run.check;
        clock_only_run = clockOnlyRunOf(kept_run.result);
        stability_check.holds = stability_check.holds && stability_check.as_built.holds;
        logger.log(`As-built check (clock windows only, ${stability_check.as_built.start_phases_checked} start phases): actual=${stability_check.as_built.actual_output_items} expected=${total_expected_output} stable=${stability_check.as_built.holds}`);
    }
    return exportClock(plan, clock, windows, options, { clock_only_run, loop_windows, item_names, search: extras.search, left_open: extras.left_open });
}

/** The crafting cycle of a build, with the machines that make the target item and the inserters that take it out */
interface PlannedCraftingCycle {
    target_production_rate: TargetProductionRate;
    output_machine_state_machines: MachineStateMachine[];
    /** One output inserter per output machine, which the swings of a cycle are counted by */
    output_inserters: InserterState[];
    /** Every inserter that takes the target item out of the build */
    all_output_inserters: InserterState[];
    crafting_cycle_plan: CraftingCyclePlan;
}

/**
 * The crafting cycle the clock is planned around, for a build whose machines have been run until output blocked
 * (the prepare step): what was crafted by then sets how many hands the output inserters take per cycle.
 * Throws when the build cannot reach the target rate or an output machine has no inserter taking from it.
 */
export function planCraftingCycle(config: Config, simulation_context: SimulationContext, logger: Logger): PlannedCraftingCycle {
    const target_production_rate = TargetProductionRate.fromConfig(config.target_output);

    // Find all output machines (machines that produce the target output item)
    const output_machine_state_machines = simulation_context.machines.filter(
        it => it.machine_state.machine.output.item_name === target_production_rate.machine_production_rate.item
    );
    assert(
        output_machine_state_machines.length > 0,
        `No machine with output item ${target_production_rate.machine_production_rate.item} found`
    );

    // validate target production rate can be met
    const total_output_capacity_per_second = output_machine_state_machines
        .map(it => it.machine_state.machine.output.production_rate.amount_per_second)
        .reduce((a, b) => a.add(b), fraction(0))
        .multiply(fraction(config.target_output.copies));
    assert(total_output_capacity_per_second.toDecimal() >= target_production_rate.total_production_rate.amount_per_second.toDecimal(),
       "The current configuration cannot meet the target production rate. " +
       `Total output capacity is ${total_output_capacity_per_second.toDecimal()} items/second, ` +
       `but target production rate is ${target_production_rate.total_production_rate.amount_per_second.toDecimal()} items/second.`
    )

    // Every inserter that takes the target item out of the build, or out of the container its machine puts it into; a
    // machine can have several
    const inserter_states = simulation_context.state_registry.getAllStates().filter(EntityState.isInserter);
    const output_ids_by_machine = new Map(output_machine_state_machines.map(machine_state_machine => [machine_state_machine.machine_state.entity_id.id,
        new Set(buildOutputInsertersOf(machine_state_machine.machine_state.machine, simulation_context.entity_registry).map(it => it.entity_id.id))] as const));
    // machines that put the product into one container share its takers: each is counted once
    const all_output_inserters = Array.from(new Set(Array.from(output_ids_by_machine.values()).flatMap(ids => inserter_states.filter(it => ids.has(it.entity_id.id)))));
    // One of them per output machine, which the swings of a cycle are counted by
    const output_inserters = output_machine_state_machines.map(machine_state_machine => {
        const ids = output_ids_by_machine.get(machine_state_machine.machine_state.entity_id.id)!;
        const inserter = all_output_inserters.find(it => ids.has(it.entity_id.id));
        assert(
            inserter !== undefined,
            `No inserter with source machine ${machine_state_machine.machine_state.entity_id} found`
        );
        return inserter;
    });

    const crafting_cycle_plan = computeCraftingCyclePlan(
        target_production_rate,
        output_machine_state_machines.map(it => it.machine_state),
        simulation_context.entity_registry,
        output_inserters.map(it => it.inserter),
        config,
        logger
    );

    return { target_production_rate, output_machine_state_machines, output_inserters, all_output_inserters, crafting_cycle_plan };
}

/** The cycles the clock needs to make every hand whole, and the plan of the hands */
interface TransferPlan {
    /** The cycles the swing counts need to be whole */
    computed_lcm: number;
    /** The cycles of the clock: the config's override of computed_lcm, where it has one */
    recipe_lcm: number;
    serializable_transfer_plan: SerializableTransferPlan;
}

/** The hands every inserter and drill moves per crafting cycle, and the cycles the clock needs to make them whole */
export function transferPlanOf(config: Config, crafting_cycle_plan: CraftingCyclePlan, simulation_context: SimulationContext): TransferPlan {
    const swing_counts = crafting_cycle_plan.entity_transfer_map;
    assertBeltFillersPlanned(simulation_context.entity_registry, swing_counts);

    const ignored_ingredients = config.overrides?.ignored_lcm_ingredients;
    const computed_lcm = EntityTransferCountMap.lcm(swing_counts, ignored_ingredients);
    return {
        computed_lcm,
        recipe_lcm: config.overrides?.lcm ?? computed_lcm,
        serializable_transfer_plan: EntityTransferCountMap.serialize(swing_counts, ignored_ingredients),
    };
}

/**
 * An inserter clocked onto a belt has to stay enabled until its hand is full and dropped, but not until it is back:
 * a window still on when it returns lets it swing again onto the endless belt.
 */
function clipBeltFillerWindows(
    history: InventoryTransferHistory,
    entity_registry: ReadableEntityRegistry,
    output_inserter_ids: Set<string>,
): InventoryTransferHistory {
    return new InventoryTransferHistory(new Map(Array.from(history.entries(), ([entity_id, transfers]) => {
        const entity = entity_registry.getEntityByIdOrThrow(entity_id);
        if (!Entity.isInserter(entity) || output_inserter_ids.has(entity_id.id)
            || !EntityId.isMachine(entity.source.entity_id) || !EntityId.isBelt(entity.sink.entity_id)) {
            return [entity_id, transfers] as const;
        }
        const return_swing_ticks = entity.animation.rotation.ticks + 1;
        const min_window_ticks = entity.animation.pickup.ticks + 2;
        return [entity_id, transfers.map(transfer => ({
            ...transfer,
            tick_range: OpenRange.fromStartAndDuration(
                transfer.tick_range.start_inclusive,
                Math.min(
                    transfer.tick_range.duration().ticks,
                    Math.max(min_window_ticks, transfer.tick_range.duration().ticks - return_swing_ticks),
                ),
            ),
        }))] as const;
    })));
}

/**
 * Hands an inserter taking from a machine can start in one window: its window runs from `start` to
 * `start + swing * (hands - 1) + 1` inclusive, so `swing * (hands - 1) + 2` ticks (10 for a swing of 8), and that many
 * hands can start back to back.
 */
const HANDS_PER_MACHINE_WINDOW = 2;

/**
 * How many more hands than the machine needs the windows of an inserter taking from a machine allow. A hand the sink
 * has no room for is not taken, so a window can come up empty, and an egg biochamber refuses nutrients while its
 * output holds 14 or more eggs. Measured in the game on 2026-10-09 on the agricultural science build, which needs
 * 30.652 hands an inserter in 480 ticks on every clock: 40 hands let the egg biochambers run out of nutrients on the
 * 1- and 2-swing clocks, 44 never did. 44 / 30.652 is 1.435; the constant is applied to the hands the machine needs,
 * ingredients and fuel together, and not to the plan's, whose fuel is rounded up by a different amount on each clock.
 *
 * The simulator cannot tell a sufficient surplus from an insufficient one: its as-built check and long run pass 1.30,
 * which starved the 1- and 2-swing clocks of agricultural science in the game on 2026-10-09. The value rests on game
 * recordings of that one build.
 *
 * TODO: this is a fitted number. Derive it per build, or make it a setting the user controls (not done yet).
 */
const MACHINE_HANDS_SURPLUS = 1.43;

/** Ticks an output window stays on after its last planned pickup can start, well short of the next one */
const OUTPUT_WINDOW_LAST_PICKUP_TICKS = 4;

/**
 * In a build with inserters left always enabled, what the planning run did does not repeat: when its swings were
 * taken depends on when the free running inserters happened to deliver. Windows taken from that run are a little
 * off in every period, and in game a build fell behind by a hand every few periods, or made a hand too many. So the
 * inserters at the two ends of such a build, which are the ones the clock still holds, get the windows of the plan
 * and not of the run:
 *
 * - the output inserter: one window at the start of every cycle, on until its last planned pickup can start. It
 *   swings every `animation.total` ticks, and a pickup it cannot start it does not make up for later, so the build
 *   makes at most its target, and the target while the machines keep up. A window as long as the swings took in the
 *   run, waits for the machine included, fits one swing more when the machine has product to spare.
 * - an inserter between machines that is not left always enabled (nutrients from a machine outside the loop): its
 *   needed hands a period, fuel included, times `MACHINE_HANDS_SURPLUS`, as windows of two hands spread evenly.
 * - an inserter taking from a belt: its planned hands, fuel included and rounded up. Into the output machine they
 *   come in one window a cycle that opens with the output window; into any other machine as windows of one hand
 *   spread evenly over the period. A hand its machine has no room for is not taken.
 */
function windowsOfThePlanWhereInsertersRunFree(
    history: InventoryTransferHistory,
    entity_registry: ReadableEntityRegistry,
    crafting_cycle_plan: CraftingCyclePlan,
    period_ticks: number,
): InventoryTransferHistory {
    const always_enabled = new Set(alwaysEnabledInserters(entity_registry).map(it => it.entity_id.id));
    if (always_enabled.size === 0) {
        return history;
    }
    const target_item = crafting_cycle_plan.production_rate.machine_production_rate.item;
    const cycle_ticks = crafting_cycle_plan.total_duration.ticks;
    const result = new Map<EntityId, InventoryTransfer[]>(history.entries());
    const keyFor = (entity_id: EntityId) => Array.from(result.keys()).find(it => it.id === entity_id.id) ?? entity_id;

    for (const planned of crafting_cycle_plan.entity_transfer_map.values()) {
        const inserter = planned.entity;
        if (!Entity.isInserter(inserter)) {
            continue;
        }
        const source = entity_registry.getEntityByIdOrThrow(inserter.source.entity_id);
        const item_name = planned.item_transfers[0].item_name;

        if (Entity.isMachine(source) && source.output.item_name === target_item && !EntityId.isMachine(inserter.sink.entity_id)) {
            if (planned.total_transfer_count.getDenominator !== 1) {
                continue;
            }
            const swings = planned.total_transfer_count.getNumerator;
            const window_ticks = inserter.animation.total.ticks * (swings - 1) + OUTPUT_WINDOW_LAST_PICKUP_TICKS;
            const windows: InventoryTransfer[] = [];
            for (let cycle = 0; Math.floor(cycle * cycle_ticks) + window_ticks < period_ticks; cycle++) {
                const start = Math.floor(cycle * cycle_ticks);
                windows.push({ item_name: target_item, tick_range: OpenRange.from(start, start + window_ticks), amount: swings * planned.stack_size });
            }
            result.set(keyFor(inserter.entity_id), windows);
        } else if (Entity.isMachine(source) && EntityId.isMachine(inserter.sink.entity_id) && !always_enabled.has(inserter.entity_id.id)) {
            // Windows long enough to start two hands back to back, spread evenly over the period, in number for the
            // surplus the sink's refusals need: a hand the machine has no room for is not taken, so what matters is that
            // there are never too few. The window count is not a count of hands: each window is given the amount it is
            // expected to carry, which is what the transfer table shows.
            const needed_hands = (planned.needed_transfer_count ?? planned.total_transfer_count).toDecimal() * period_ticks / cycle_ticks;
            const window_count = Math.max(1, Math.ceil(needed_hands * MACHINE_HANDS_SURPLUS / HANDS_PER_MACHINE_WINDOW - 1e-9));
            const window_ticks = Math.min(
                inserter.animation.total.ticks * (HANDS_PER_MACHINE_WINDOW - 1) + 1,
                Math.max(1, Math.floor(period_ticks / window_count) - 1),
            );
            const expected_amount = Math.max(1, Math.round(needed_hands * planned.stack_size / window_count));
            const windows: InventoryTransfer[] = [];
            for (let window = 0; window < window_count; window++) {
                const start = Math.floor(window * period_ticks / window_count);
                windows.push({ item_name, tick_range: OpenRange.from(start, Math.min(start + window_ticks, Math.floor(period_ticks) - 1)), amount: expected_amount });
            }
            result.set(keyFor(inserter.entity_id), windows);
        } else if (Entity.isBelt(source) && EntityId.isMachine(inserter.sink.entity_id)) {
            const sink = entity_registry.getEntityByIdOrThrow(inserter.sink.entity_id);
            const lane_stack_size = source.lanes.find(lane => lane.ingredient_name === item_name)?.stack_size ?? planned.stack_size;
            const pickup_ticks = Math.ceil(planned.stack_size / lane_stack_size);
            // On from the first item picked up until the hand is dropped, as the windows of a run are, and as long
            // again as a pickup takes, twice: in game a pickup starts a few ticks into its window, and behind another
            // inserter on the same belt it took 8 ticks and not 3 to fill the hand, while the gap that one left went by.
            // A window that closed on a partly filled hand left it for the next window, and the machine without fuel.
            const hand_ticks = pickup_ticks + inserter.animation.rotation.ticks + inserter.animation.drop.ticks + 2 * pickup_ticks;
            const swing_ticks = pickup_ticks + 2 * inserter.animation.rotation.ticks + inserter.animation.drop.ticks;
            const windows: InventoryTransfer[] = [];
            if (Entity.isMachine(sink) && sink.output.item_name === target_item) {
                // The output machine takes nothing while its output is full, which it is until the output inserter
                // swings: its hands come in one window that opens with the output window of every cycle.
                const hands = Math.ceil(planned.total_transfer_count.toDecimal() - 1e-9);
                const window_ticks = Math.min(swing_ticks * (hands - 1) + hand_ticks, Math.floor(cycle_ticks) - 1);
                for (let cycle = 0; Math.floor(cycle * cycle_ticks) + window_ticks < period_ticks; cycle++) {
                    const start = Math.floor(cycle * cycle_ticks);
                    windows.push({ item_name, tick_range: OpenRange.from(start, start + window_ticks), amount: hands * planned.stack_size });
                }
            } else {
                const hands = Math.ceil(planned.total_transfer_count.toDecimal() * period_ticks / cycle_ticks - 1e-9);
                for (let hand = 0; hand < hands; hand++) {
                    const start = Math.floor(hand * period_ticks / hands);
                    windows.push({ item_name, tick_range: OpenRange.from(start, Math.min(start + hand_ticks, Math.floor(period_ticks) - 1)), amount: planned.stack_size });
                }
            }
            result.set(keyFor(inserter.entity_id), windows);
        }
    }
    return new InventoryTransferHistory(result);
}

/** An inserter filling a belt nothing in the config empties has no rate to plan for */
function assertBeltFillersPlanned(entity_registry: ReadableEntityRegistry, swing_counts: EntityTransferCountMap): void {
    for (const inserter of entity_registry.getAll().filter(Entity.isInserter)) {
        if (!EntityId.isBelt(inserter.sink.entity_id) || swing_counts.has(inserter.entity_id)) {
            continue;
        }
        if (isByProductOnlyInserter(entity_registry, inserter)) {
            continue;
        }
        const items = Array.from(inserter.filtered_items).join(", ");
        throw new Error(
            `Inserter ${inserter.entity_id.number} puts ${items} onto belt ${inserter.sink.entity_id.number}, `
            + `but nothing in the config takes it off. Make it an export belt with a consumption rate (items/s) on that lane.`
        );
    }
}

/**
 * Belt lanes with a consumption rate must be filled at that rate (outside consumers would run dry otherwise).
 * Returns the belts that fell short over the period, by item (see exportedItemsOf).
 */
function exportedLanesShortOfConsumption(
    entity_registry: ReadableEntityRegistry,
    history: InventoryTransferHistory,
    output_inserter_ids: Set<string>,
    period_ticks: number,
): ExportShortfall[] {
    const moved = new Map<string, number>();
    for (const [entity_id, transfers] of history.entries()) {
        for (const transfer of transfers) {
            const key = `${entity_id.id}|${transfer.item_name}`;
            moved.set(key, (moved.get(key) ?? 0) + transfer.amount);
        }
    }
    return exportShortfallsOfPeriod(exportedItemsOf(entity_registry, output_inserter_ids),
        (inserter_id, item) => moved.get(`${inserter_id}|${item}`) ?? 0, period_ticks, LCM_STABILITY_TOLERANCE);
}

/**
 * Every inserter and drill runs on a fixed clock of a whole-tick period (or always/never), as in a clock-only
 * check, so the simulation is deterministic with that period and a repeated state repeats forever.
 */
function isPurelyClocked(config: Config, period: number): boolean {
    return Number.isInteger(period) && isClockedThroughout(config, period);
}

/** Every inserter and drill is always or never enabled, or on windows of a clock of this period, whole ticks or not */
function isClockedThroughout(config: Config, period: number): boolean {
    const fixed = (control: EnableControlOverrideConfig | undefined) => control !== undefined && (
        control.mode === "ALWAYS" || control.mode === "NEVER"
        || (control.mode === "CLOCKED" && control.period_duration_ticks === period)
    );
    return config.inserters.every(inserter => fixed(inserter.overrides?.enable_control))
        && (config.drills?.configs ?? []).every(drill => fixed(drill.overrides?.enable_control));
}

/**
 * The bin at whose boundaries equal simulation states repeat forever: every control of the build is a fixed clock
 * (always, never, or windows of a stated period), so the next tick is a function of the entity states and of where
 * each clock stands, and at boundaries of this bin every clock stands where it stood at the last one. The bin is the
 * period for a build clocked throughout on whole ticks, the whole-tick repeat of a fractional period, and their
 * merge with the moduli of the clocks inserters have of their own (fuel), as one combinator would count them
 * (see mergedClockTicks). Null when some control decides from more than the tick (AUTO), or no whole-tick
 * repeat exists: a repeated state then proves nothing.
 */
export function provenRepeatBin(config: Config, period: number): { ticks: number; periods: number } | null {
    const moduli = new Set<number>();
    const fixed = (control: EnableControlOverrideConfig | undefined): boolean => {
        if (control === undefined) {
            return false;
        }
        if (control.mode === "ALWAYS" || control.mode === "NEVER") {
            return true;
        }
        if (control.mode !== "CLOCKED" || control.period_duration_ticks === undefined) {
            return false;
        }
        moduli.add(control.period_duration_ticks);
        return true;
    };
    if (!config.inserters.every(inserter => fixed(inserter.overrides?.enable_control))
        || !(config.drills?.configs ?? []).every(drill => fixed(drill.overrides?.enable_control))) {
        return null;
    }
    const repeat = subtickClockForPeriod(period);
    const base = Number.isInteger(period) ? { ticks: period, periods: 1 }
        : repeat === null ? null : { ticks: repeat.period_ticks, periods: repeat.scale };
    if (base === null) {
        return null;
    }
    const own_moduli = Array.from(moduli).filter(modulus => modulus !== period);
    if (own_moduli.length === 0) {
        return base;
    }
    const merged = mergedClockTicks(base.ticks, own_moduli);
    if (merged === null || merged >= MAX_SIMULATION_TICKS) {
        return null;
    }
    return { ticks: merged, periods: (merged / base.ticks) * base.periods };
}

/** Longest the fuel consumption view runs, in simulated ticks */
const MAX_FUEL_VIEW_TICKS = 100_000;

/** Full hands of fuel the slowest burning machine gets through over the fuel consumption view */
const FUEL_VIEW_HANDS = 4;

/**
 * Runs the exported clock for several periods so a fuel inserter shows inserting. One period seldom does: a hand of
 * fuel lasts a machine longer than that, and the fuel slot's limit skips the window until it has burned down. The run
 * starts at four times the longest a full hand lasts, enough for each machine to be refilled a few times, and doubles
 * while no fuel inserter swung.
 */
function fuelConsumptionView(
    config: Config,
    windows: Map<string, OpenRange[]>,
    inserter_clocks: ReadonlyMap<string, InserterClock>,
    period: number,
    logger: Logger,
    /** Run the fuel inserters on `inserter_clocks`, and not on the fuel clocks the run would make from its own plan */
    on_these_fuel_clocks: boolean,
    /** Run at least this long, as far as the longest run allows */
    min_ticks: number = 0,
): FuelConsumptionView | undefined {
    const registry = createEntityRegistryFromConfig(config);
    const fuel_inserters = fuelOnlyInserters(registry);
    const hand_lasts = Math.max(...fuel_inserters.map(inserter => {
        const machine = registry.getEntityByIdOrThrow(inserter.sink.entity_id);
        if (!Entity.isMachine(machine) || !machine.fuel_slot || !machine.fuel_consumption) {
            return 0;
        }
        return handSizeFor(inserter, machine.fuel_slot.fuel.item_name) / machine.fuel_consumption.rate_per_tick;
    }), 0);
    const max_periods = Math.floor(MAX_FUEL_VIEW_TICKS / period);
    if (max_periods < 1) {
        return undefined;
    }

    const fuel_inserter_ids = fuel_inserters.map(inserter => inserter.entity_id.id);
    let periods = Math.min(Math.max(2, Math.ceil(FUEL_VIEW_HANDS * hand_lasts / period), Math.ceil(min_ticks / period)), max_periods);
    while (true) {
        // the windows are run as they are: observing them again would return that run instead, without the fuel levels
        const run = runClockOnBuild(
            { ...config, overrides: { ...config.overrides, derive_clock_windows: false } }, windows, period, logger,
            { simulate_periods: periods, fuel_levels: true },
            on_these_fuel_clocks ? inserter_clocks : undefined,
        );
        const swung = run.serializable_transfer_history.entities
            .some(entity => fuel_inserter_ids.includes(entity.entity_id) && entity.transfers.length > 0);
        if (swung || periods >= max_periods) {
            logger.log(`Fuel consumption view: ${periods} periods, fuel inserters ${swung ? "swing" : "did not swing"}`);
            return {
                periods,
                duration_ticks: periods * period,
                fuel_inserter_ids,
                fuel_swings_recorded: swung,
                fuel_levels: run.fuel_levels ?? [],
                ran_out_of_fuel: (run.fuel_levels ?? []).some(levels => levels.empty_ticks > 0),
                transfer_history: run.serializable_transfer_history,
                state_transition_history: run.serializable_state_transition_history,
            };
        }
        periods = Math.min(periods * 2, max_periods);
    }
}

/**
 * The part of the time each machine crafts in the plan, by machine id: what its planned inserters take of its main
 * product in a cycle, over what it makes in a cycle when it never stops. A machine nothing planned takes from is left
 * out.
 */
function plannedCraftingShares(entity_registry: ReadableEntityRegistry, crafting_cycle_plan: CraftingCyclePlan): Map<string, number> {
    const taken_per_cycle = new Map<string, number>();
    for (const [, transfer_count] of crafting_cycle_plan.entity_transfer_map.entries()) {
        const inserter = transfer_count.entity;
        if (!Entity.isInserter(inserter)) {
            continue;
        }
        const source = entity_registry.getEntityById(inserter.source.entity_id);
        if (source === null || !Entity.isMachine(source)) {
            continue;
        }
        const item_name = source.output.item_name;
        const hands = transfer_count.item_transfers.find(it => it.item_name === item_name)?.transfer_count.toDecimal() ?? 0;
        taken_per_cycle.set(source.entity_id.id, (taken_per_cycle.get(source.entity_id.id) ?? 0) + hands * handSizeFor(inserter, item_name));
    }

    const shares = new Map<string, number>();
    for (const machine of entity_registry.getAll().filter(Entity.isMachine)) {
        const taken = taken_per_cycle.get(machine.entity_id.id);
        const made_per_cycle = machine.output.production_rate.amount_per_tick.toDecimal() * crafting_cycle_plan.total_duration.ticks;
        if (taken !== undefined && taken > 0 && made_per_cycle > 0) {
            shares.set(machine.entity_id.id, Math.min(1, taken / made_per_cycle));
        }
    }
    return shares;
}

/**
 * The windows of a clock with the inserters outside the plan that repeat on the clock of the period. An inserter on a
 * clock of its own (fuel) has no windows on it.
 */
export function withInserterClocks(
    windows: Map<string, OpenRange[]>,
    inserter_clocks: ReadonlyMap<string, InserterClock>,
    period: number,
): Map<string, OpenRange[]> {
    if (inserter_clocks.size === 0) {
        return windows;
    }
    const result = new Map(windows);
    for (const [inserter_id, clock] of inserter_clocks) {
        if (clock.own_clock) {
            result.delete(inserter_id);
        } else {
            result.set(inserter_id, clockWindowsOverPeriod(clock, period));
        }
    }
    return result;
}

/**
 * The inserters and drills the config sets to always enabled. They get no clock windows, so no combinator in the
 * blueprint, and the checks of a clock run them always enabled.
 */
export function alwaysEnabledByConfig(config: Config): Set<string> {
    return new Set(Array.from(buildEnableControlOverrideMap(config))
        .filter(([, override]) => override.mode === "ALWAYS")
        .map(([entity_id]) => entity_id));
}

/**
 * The windows the planned transfers ran in. Inserters that are left always enabled get none, nor does what the config
 * sets to always enabled.
 */
export function windowsFromHistory(
    history: InventoryTransferHistory,
    entity_registry: ReadableEntityRegistry,
    always_enabled_by_config: ReadonlySet<string>,
): Map<string, OpenRange[]> {
    const always_enabled = new Set(alwaysEnabledInserters(entity_registry).map(it => it.entity_id.id));
    // the belt window ends stand as given where they were not recorded transfer ends, or where they feed fuel:
    // on a build with always-enabled inserters the belt windows are synthesized to stay open through late pickups
    // (windowsOfThePlanWhereInsertersRunFree); a mixed fuel-and-ingredient window's end holds the room a hand of
    // fuel needs ahead of the planned hands (fuelHandRoomTicks); and a dedicated fuel inserter's recorded ranges
    // set the cadence its own fuel clock is derived from, which the trim would stretch (a machine then runs dry)
    const keep_belt_ends = always_enabled.size > 0 ? null : new Set([
        ...Array.from(fuelHandRoomTicks(entity_registry)).filter(([, ticks]) => ticks > 0).map(([id]) => id),
        ...fuelOnlyInserters(entity_registry).map(inserter => inserter.entity_id.id),
    ]);
    const windows = new Map<string, OpenRange[]>();
    for (const [entity_id, transfers] of history.entries()) {
        if (!always_enabled.has(entity_id.id) && !always_enabled_by_config.has(entity_id.id)) {
            const ranges = OpenRange.reduceRanges(transfers.map(t => t.tick_range));
            windows.set(entity_id.id, keep_belt_ends === null || keep_belt_ends.has(entity_id.id)
                ? ranges
                : beltFedWindowEndsBeforeTheReturnSwing(ranges, entity_registry, entity_id));
        }
    }
    return windows;
}

/**
 * A belt-fed inserter's recorded ranges end where its last drop of the window lands, and its per-item ranges
 * interleave into the window, so the end cannot be trimmed per transfer as a machine-fed inserter's is (see
 * trimEndsToAvoidBackSwingWakeLists). Each window is pulled back one rotation instead: left open through the
 * return swing of its last drop, the returned hand grabs again in the window's last tick — on a backed-up belt
 * every time, one belt stack a period, which came out as an extra full hand every 4th period and one extra output
 * hand every 16th on the over-hood builds (in-game confirmed; see tests/game/builds/README.md).
 */
function beltFedWindowEndsBeforeTheReturnSwing(
    ranges: OpenRange[],
    entity_registry: ReadableEntityRegistry,
    entity_id: EntityId,
): OpenRange[] {
    const entity = entity_registry.getEntityById(entity_id);
    if (entity === null || !Entity.isInserter(entity)) {
        return ranges;
    }
    const source = entity_registry.getEntityById(entity.source.entity_id);
    if (source === null || !Entity.isBelt(source)) {
        return ranges;
    }
    const rotation = entity.animation.rotation.ticks;
    return ranges.map(range => OpenRange.from(range.start_inclusive,
        Math.max(range.start_inclusive, range.end_inclusive - rotation)));
}

function serializeClockWindows(windows: Map<string, OpenRange[]>): SerializableClockWindows {
    return Object.fromEntries(Array.from(windows, ([key, ranges]) =>
        [key, ranges.map(r => ({ start: r.start_inclusive, end: r.end_inclusive }))]
    ));
}

/**
 * The crafts of each machine, by id, in the prepare step of the build with its belts backed up; null where the prepare
 * step that was run counts them: the belts are backed up already, no inserter takes from a belt, the config sets the
 * output swings, or the plan takes fractional swings, whose swings per cycle are the build's own count, not a cap.
 *
 * Whole output swings per cycle are at most what a machine makes from the hands it gets before its output blocks, and
 * the swing backoff only lowers them. On moving belts the prepare step's machines start empty and get their first
 * hands as fast as the belt brings them: on the express moving half-tile pickups the electromagnetic plant gets one
 * hand of each ingredient before its output blocks where backed-up belts give it two, so the plan had 2 output swings,
 * a period of part ticks that no moving clock can be made for, and never reached 3, where observed windows hold.
 */
function craftsWithBeltsBackedUp(config: Config): Map<string, number> | null {
    if (config.overrides?.backed_up_belts === true || config.overrides?.terminal_swing_count !== undefined
        || config.overrides?.use_fractional_swings === true || !config.inserters.some(inserter => inserter.source.type === "belt")) {
        return null;
    }
    const simulation_context = SimulationContext.fromConfig({ ...config, overrides: { ...config.overrides, backed_up_belts: true } });
    new PrepareStep(simulation_context).execute();
    return new Map(simulation_context.machines.map(({ machine_state }) => [machine_state.machine.entity_id.id, machine_state.craftCount]));
}

/**
 * Helper function to compute the crafting cycle plan.
 * This function assumes all machines have finished crafting while not having any items pulled out of their inventories.
 * Where the belts move, whole swings are counted with them backed up (see craftsWithBeltsBackedUp).
 * 
 * For multiple output machines, the max swings possible is computed as the minimum across all machines
 * to ensure all machines can complete the required swings.
 */
function computeCraftingCyclePlan(
    target_production_rate: TargetProductionRate,
    output_machine_states: MachineState[],
    entity_registry: ReadableEntityRegistry,
    output_inserters: Inserter[],
    config: Config,
    logger: Logger
): CraftingCyclePlan {
    assert(
        output_machine_states.length > 0,
        "At least one output machine is required"
    );
    assert(
        output_machine_states.length === output_inserters.length,
        `Mismatch between output machines (${output_machine_states.length}) and output inserters (${output_inserters.length})`
    );

    const output_item_name = output_machine_states[0].machine.output.item_name;
    const crafts_with_belts_backed_up = craftsWithBeltsBackedUp(config);
    
    // Compute max swings possible for each output machine and use the minimum
    let max_swings_possible: Fraction | null = null;
    
    for (let i = 0; i < output_machine_states.length; i++) {
        const machine_state = output_machine_states[i];
        const inserter = output_inserters[i];
        const output_machine = machine_state.machine;
        const crafts = crafts_with_belts_backed_up?.get(output_machine.entity_id.id) ?? machine_state.craftCount;
        const output_crafted = crafts * output_machine.output.amount_per_craft.toDecimal();
        logger.log(`Output machine ${output_machine.entity_id.id} crafted ${output_crafted} ${output_item_name}`
            + (crafts_with_belts_backed_up === null ? "" : " with its belts backed up"));
        
        const machine_max_swings = fraction(output_crafted).divide(handSizeFor(inserter, output_item_name));
        
        if (max_swings_possible === null || machine_max_swings.toDecimal() < max_swings_possible.toDecimal()) {
            max_swings_possible = machine_max_swings;
        }
    }

    if (config.overrides?.terminal_swing_count !== undefined) {
        max_swings_possible = fraction(config.overrides.terminal_swing_count);
        logger.log(`Overriding max swings possible to ${max_swings_possible} due to config override`);
    }

    return CraftingCyclePlan.create(
        target_production_rate,
        entity_registry,
        max_swings_possible!,
        config.overrides ?? {}
    );
}

/**
 * Builds a map of entity ID string to EnableControlOverrideConfig from the configuration.
 * 
 * Inserters use 1-based array index as entity ID with format "inserter:N".
 * Drills use their explicit `id` field with format "drill:N".
 */
function buildEnableControlOverrideMap(config: Config): EntityEnableControlOverrideMap {
    const map: EntityEnableControlOverrideMap = new Map();

    // Process inserter overrides (1-based array index as entity ID)
    config.inserters.forEach((inserter_config, index) => {
        const entity_id = EntityId.forInserter(inserter_config.id ?? index + 1).id;
        const enable_control_override = inserter_config.overrides?.enable_control;
        if (enable_control_override !== undefined) {
            map.set(entity_id, enable_control_override);
        }
    });

    // Process drill overrides (explicit id field). A drill into a chest without one is always enabled in the planning
    // run; its windows are made from its takers' afterwards (see chestDrillWindows)
    if (config.drills !== undefined) {
        config.drills.configs.forEach((drill_config) => {
            const entity_id = EntityId.forDrill(drill_config.id).id;
            const enable_control_override = drill_config.overrides?.enable_control;
            if (enable_control_override !== undefined) {
                map.set(entity_id, enable_control_override);
            }
        });
    }

    return map;
}

// ============================================================================
// Plugin Configuration Functions
// ============================================================================

/**
 * Configures debug plugins for all entities in the simulation context.
 */
function configureDebugPlugins(
    simulation_context: SimulationContext,
    relative_tick_provider: TickProvider,
    debug: MutableDebugSettingsProvider
): void {
    const debug_plugin_factory = new DebugPluginFactory(
        relative_tick_provider,
        debug
    );
    simulation_context.addDebuggerPlugins(debug_plugin_factory);
}

/**
 * Configures inventory transfer tracking plugins for inserters and drills.
 * Returns the InventoryTransferHistory that will collect transfer events.
 */
function configureInventoryTransferPlugins(
    simulation_context: SimulationContext,
    relative_tick_provider: TickProvider
): InventoryTransferHistory {
    const inventory_transfer_history = new InventoryTransferHistory();

    // Add inserter inventory transfer plugins
    simulation_context.inserters.forEach(it => {
        it.addPlugin(new InserterInventoryHistoryPlugin(
            relative_tick_provider,
            it.inserter_state,
            inventory_transfer_history
        ));
    });

    // Add drill inventory transfer plugins
    simulation_context.drills.forEach(it => {
        const sink_machine = simulation_context.entity_registry.getEntityByIdOrThrow(
            it.drill_state.drill.sink_id
        );
        // a drill into a chest has no transfers to record: its windows are made from its takers' (see chestDrillWindows)
        if (!Entity.isMachine(sink_machine)) {
            return;
        }
        it.addPlugin(new DrillInventoryTransferPlugin(
            it.drill_state.drill,
            sink_machine,
            relative_tick_provider,
            inventory_transfer_history
        ));
    });

    return inventory_transfer_history;
}

/**
 * Configures state transition tracking plugins for all entity types.
 * Returns the StateTransitionHistory that will collect transition events.
 */
function configureStateTransitionPlugins(
    simulation_context: SimulationContext,
    relative_tick_provider: TickProvider,
    factorio_states: boolean,
): StateTransitionHistory {
    const state_transition_history = new StateTransitionHistory();
    const inserter_transition_callback = state_transition_history.createInserterCallback();
    const machine_transition_callback = state_transition_history.createMachineCallback();
    const drill_transition_callback = state_transition_history.createDrillCallback();

    // Add inserter state transition plugins
    simulation_context.inserters.forEach(it => {
        it.addPlugin(new InserterStateTransitionTrackerPlugin(
            it.inserter_state.entity_id,
            relative_tick_provider,
            inserter_transition_callback
        ));
        if (factorio_states) {
            it.addPlugin(new FactorioStatePlugin(
                it.inserter_state.entity_id,
                relative_tick_provider,
                () => factorioInserterState(it.inserter_state, it.sink_state),
                state_transition_history.createFactorioStateCallback("inserter"),
            ));
        }
    });

    // Add machine state transition plugins
    simulation_context.machines.forEach(it => {
        it.addPlugin(new MachineStateTransitionTrackerPlugin(
            it.machine_state.entity_id,
            relative_tick_provider,
            machine_transition_callback
        ));
        if (factorio_states) {
            it.addPlugin(new FactorioStatePlugin(
                it.machine_state.entity_id,
                relative_tick_provider,
                () => factorioMachineState(it.machine_state),
                state_transition_history.createFactorioStateCallback("machine"),
            ));
        }
    });

    // Add drill state transition plugins
    simulation_context.drills.forEach(it => {
        it.addPlugin(new DrillStateTransitionTrackerPlugin(
            it.drill_state.entity_id,
            relative_tick_provider,
            drill_transition_callback
        ));
        if (factorio_states) {
            it.addPlugin(new FactorioStatePlugin(
                it.drill_state.entity_id,
                relative_tick_provider,
                () => factorioDrillState(it.drill_state),
                state_transition_history.createFactorioStateCallback("drill"),
            ));
        }
    });

    return state_transition_history;
}
