import assert from "../../common/assert";
import { Config } from "../../config";
import { EnableControlOverrideConfig } from "../../config/schema";
import { assertInserterCoverage } from "../../config/inserter-coverage-validator";
import { DebugPluginFactory } from "../sequence/debug/debug-plugin-factory";
import { DebugSettingsProvider, MutableDebugSettingsProvider } from "../sequence/debug/debug-settings-provider";
import { InserterClock, byProductOnlyInserters, clockWindowsOverPeriod, fuelOnlyInserters, isByProductOnlyInserter, alwaysEnabledInserters, unplannedInserterClocks } from "../sequence/unplanned-inserter-clock";
import { cloneSimulationContextWithInterceptors, createEntityRegistryFromConfig, SimulationContext } from "../sequence/simulation-context";
import { Duration, OpenRange } from "../../data-types";
import { assertIsMachine, Entity, EntityId, handSizeFor, Inserter, Machine, ReadableEntityRegistry } from "../../entities";
import { TargetProductionRate } from "../target-production-rate";
import { EntityState, MachineState } from "../../state";
import Fraction, { fraction } from "fractionability";
import { createSignalPerInserterBlueprint, mergedClockTicks, SubtickClock } from "../blueprint";
import { FactorioBlueprint } from "../../blueprints/blueprint";
import { ResettableRegistry, TickProvider } from "../../control-logic";
import { EntityTransferCountMap, outputInsertersOf, SerializableTransferPlan } from "../sequence/cycle/swing-counts";
import { InventoryTransferHistory } from "../sequence/inventory-transfer-history";
import { InventoryTransfer } from "../sequence/inventory-transfer";
import { InserterInventoryHistoryPlugin } from "../../control-logic/inserter/plugins/inserter-inventory-transfer-plugin";
import { DrillInventoryTransferPlugin } from "../../control-logic/drill/plugins/drill-inventory-transfer-plugin";
import { EnableControlFactory } from "../sequence/interceptors/inserter-enable-control-factory";
import { ConfigurableEnableControlFactory, EntityEnableControlOverrideMap } from "../sequence/interceptors/configurable-enable-control-factory";
import { CraftingCyclePlan } from "../sequence/cycle/crafting-cycle";
import { PrepareStep } from "../runner/steps/prepare-step";
import { WarmupStep } from "../runner/steps/warmup-step";
import { simulationStateKey } from "../runner/steady-state";
import { SimulateStep } from "../runner/steps/simulate-step";
import { RunnerStepType } from "../runner/steps/runner-step";
import { Logger, defaultLogger } from "../../common/logger";
import { FuelLevelRecorder, FuelLevelSeries, FuelPlan, fuelPlan } from "../fuel-view";
import { StockRecorder, StockRecording } from "../machine-stock";
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
import { fullHandOutputWindows, fullHandTransferWindows } from "../candidates/full-hand";
import { DerivedClockWindowsReport, deriveClockWindows } from "../candidates/observed-windows";
import { windowsOfInsertersFeedingTheOutputMachine } from "../candidates/output-feeders";
import { ShiftedSwings, shiftedCycleWindows } from "../candidates/shifted-swings";
import { deriveUnevenOutputClockWindows } from "../candidates/uneven-output";
import { ClockBelt, SerializableClockWindows, beltPickupSlackTicks, fuelHandRoomTicks, subtickClockForPeriod, withBeltPickupSlack } from "../clock";
import { AS_BUILT_START_PHASES, AsBuiltStabilityCheck, FULL_CHECK_START_PHASES, OUTPUT_FEEDER_CHECK_TICKS, beltPickupSlackHelps, runAsBuiltCheck, runClockOnBuild } from "../trial";

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
    /** Decider windows exported in the blueprint, per entity id (before circuit latency) */
    clock_windows: SerializableClockWindows;
    /** Ticks of belt pickup slack added to each belt-fed inserter's windows; empty when none was applied */
    belt_pickup_slack_ticks: Record<string, number>;
    /**
     * The windows of a belt-fed inserter go without the slack that would have lengthened them. False when the config
     * says the belts do not move (`overrides.non_moving_belts`): then a clock is meant to go without it.
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
    subtick?: { clock: SubtickClock; blueprint: FactorioBlueprint };
    /** The same windows with repeating parts checked against the clock modulo a divisor of the period; absent when that saves nothing */
    modulo_blueprint?: FactorioBlueprint;
    crafting_cycle_plan: CraftingCyclePlan;
    simulation_duration: Duration;
    transfer_history: InventoryTransferHistory;
    /** Serializable transfer history for UI visualization */
    serializable_transfer_history: SerializableTransferHistory;
    /** Serializable state transition history for UI visualization */
    serializable_state_transition_history: SerializableStateTransitionHistory;
    /** Insertion limits, crafting time and output per craft of every machine */
    machine_facts: MachineFactsEntry[];
    /** With the shifted_cycle option: the swings that were moved, where else they could go and what limits that */
    shifted_cycle?: ShiftedSwings;
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
    /** Present when config.overrides.derive_clock_windows is set */
    derived_clock_windows?: DerivedClockWindowsReport;
    /**
     * Present when the exported clock has windows for the inserters that feed the machine the output is taken from
     * (see `windowsOfInsertersFeedingTheOutputMachine`): their ids, and how many windows they had without. These
     * windows only reduce idle checks, so a ranking of clocks counts the inserters' windows as without them.
     */
    output_feeders?: { inserter_ids: string[]; window_count_without_feeder_windows: number };
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
    /**
     * Windows to build the clock with in place of the planned ones, by entity id, as they are: nothing is added to
     * them. For a clock that the generator did not make, such as one tightened by hand (see clockFromWindows).
     */
    given_windows?: SerializableClockWindows;
    /** Belt pickup slack on belt-fed windows: "auto" keeps it unless a clock-only check gets worse (default "auto") */
    belt_pickup_slack?: "auto" | "always" | "never";
    /**
     * Lengthen the windows of an inserter that takes fuel off a belt as well as an ingredient by the fill of a hand of
     * fuel (see fuelHandRoomTicks), where the clock goes without belt pickup slack. Asked for when a clock for belts
     * that do not move does not hold the expected output without it (see withFuelHandRoomWhereNeeded).
     */
    fuel_hand_room?: boolean;
    /**
     * With derive_clock_windows: "prefer_planned" keeps planned windows that pass the as-built check (default), "always"
     * derives anyway, "uneven_output" derives with one output swing moved off its planned start
     */
    derive_mode?: "prefer_planned" | "always" | "uneven_output";
    /** Replace the output inserters' windows with evenly spaced single swings timed to find a full hand ready */
    full_hand_output?: boolean;
    /** Move one crafting cycle's windows together to another place in the clock period, when the period spans several cycles */
    shifted_cycle?: boolean;
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
    /** Start warmup with the output machines still output blocked, so the clock has to drain the surplus */
    keep_output_buffers?: boolean;
    /**
     * What machines hold when the clock starts, by entity id ("machine:4"), in place of what filling them left; every
     * inserter then starts with an empty hand. For starting a run in a state read off a recording of the game, to
     * see what the simulator makes of it (see simulateClockOnly).
     */
    start_stock?: Record<string, MachineStartStock>;
    /**
     * After the run, cut one supply of the build and give it back, several times over, and count what the build makes
     * once it is back (see backpressure-loss.ts). For a run on clock windows alone; nothing is cut in any other run.
     */
    backpressure_loss?: BackpressureLossOptions;
    /** Warmup length in simulation periods (default 10) */
    warmup_periods?: number;
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
     * Record the state the game would show for every entity over the run, for its timelines (default true). A check
     * run whose histories nobody reads leaves it out: working the state out for every entity every tick takes time.
     */
    factorio_states?: boolean;
}

/** Everything one run of a build yields, for the planning run to read its windows off and for a trial to judge */
export type BuildRun = ReturnType<typeof runBuild>;

/**
 * Runs a build: the machines are filled until their output is blocked (the prepare step), the crafting cycle is
 * planned on what they made, the output machines are emptied, the build is warmed up and then run for the period of
 * the plan with every transfer and state recorded, its output is counted against the plan's, and, when asked, the
 * backpressure losses are tried from where it ended. Every inserter runs as its enable control says: the plan's
 * controls in a planning run, the clock windows alone in a trial (see `runClockOnBuild`).
 */
export function runBuild(config: Config, options: RunOptions) {
    const debug = options.debug ?? DebugSettingsProvider.mutable();
    const debug_steps = options.debug_steps ?? {};
    const logger = options.logger ?? defaultLogger;
    
    // Validate inserter coverage before building the entity graph.
    // Throws InserterCoverageError if any machine ingredient or output lacks an inserter.
    assertInserterCoverage(config);

    // Initialize simulation context
    const simulation_context = SimulationContext.fromConfig(config);
    
    simulation_context.machines
        .map(it => it.machine_state.machine)
        .forEach(machine => Machine.printMachineFacts(machine, logger));

    let relative_tick = 0;

    const relative_tick_provider = TickProvider.offset({
        base: simulation_context.tick_provider,
        offset: () => -1 * relative_tick
    });

    // Configure plugins
    configureDebugPlugins(simulation_context, relative_tick_provider, debug);
    const inventory_transfer_history = configureInventoryTransferPlugins(simulation_context, relative_tick_provider);
    const state_transition_history = configureStateTransitionPlugins(simulation_context, relative_tick_provider, options.factorio_states ?? true);
    inventory_transfer_history.recording = false;
    state_transition_history.recording = false;

    logger.log(`Created simulation context with ${simulation_context.machines.length} machines and ${simulation_context.inserters.length} inserters.`);

    // Step 1: Prepare - wait until all machines are output blocked
    logger.log("Pre loading all machines until output blocked...");
    logger.log("Executing Prepare Step");
    if (debug_steps[RunnerStepType.PREPARE]) {
        debug.enable();
    } else {
        debug.disable();
    }
    
    const prepare_step = new PrepareStep(simulation_context);
    prepare_step.execute();
    
    inventory_transfer_history.clear();
    relative_tick = simulation_context.tick_provider.getCurrentTick();
    debug.disable();

    const { target_production_rate, output_machine_state_machines, output_inserters, all_output_inserters, crafting_cycle_plan } =
        planCraftingCycle(config, simulation_context, logger);

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

    const swing_counts = crafting_cycle_plan.entity_transfer_map;
    EntityTransferCountMap.print(swing_counts, logger);
    const { computed_lcm, recipe_lcm, serializable_transfer_plan } = transferPlanOf(config, crafting_cycle_plan, simulation_context);
    logger.log(`Simulation context ingredient LCM: ${recipe_lcm}`);

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
    // from what a run of the exported clock burns, once its windows are known: see fuelClocksAndViewFor.
    const always_enabled_by_config = alwaysEnabledByConfig(config);
    let inserter_clocks = unplannedInserterClocks(
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

    const duration: Duration = Duration.ofTicks(CraftingCyclePlan.ticksOfCycles(crafting_cycle_plan, recipe_lcm));
    assert(duration.ticks < MAX_SIMULATION_TICKS, `Clock period of ${duration.ticks} ticks exceeds maximum allowed ${MAX_SIMULATION_TICKS} ticks`);
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

    // Step 2: Warm up
    logger.log("Warming up simulation...");
    logger.log("Executing Warmup Step");
    resettable_registry.resetAll();
    if (debug_steps[RunnerStepType.WARM_UP]) {
        debug.enable();
    } else {
        debug.disable();
    }
    
    const warmup_step = new WarmupStep(new_simulation_context, warmup_period,
        isPurelyClocked(config, duration.ticks)
            ? { period_ticks: duration.ticks, key: () => simulationStateKey(new_simulation_context) }
            : undefined);
    warmup_step.execute();
    if (warmup_step.ticks_run < warmup_period.ticks) {
        logger.log(`Warm up reached a repeating state after ${warmup_step.ticks_run} ticks`);
    }
    
    debug.disable();

    // Step 3: Simulate
    logger.log(`Starting simulation for ${duration.ticks} ticks`);
    logger.log("Executing Simulate Step");
    inventory_transfer_history.clear();
    state_transition_history.clear();
    inventory_transfer_history.recording = true;
    state_transition_history.recording = true;
    inventory_transfer_history.ticks_before_run = simulation_context.tick_provider.getCurrentTick() - relative_tick;
    relative_tick = simulation_context.tick_provider.getCurrentTick();
    resettable_registry.resetAll();
    
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
    const simulate_step = new SimulateStep(new_simulation_context, recorded_duration,
        (fuel_level_recorder || stock_recorder) && (() => { fuel_level_recorder?.record(); stock_recorder?.record(); }));
    if (debug_steps[RunnerStepType.SIMULATE]) {
        debug.enable();
    } else {
        debug.disable();
    }
    simulate_step.execute();
    debug.disable();
    
    logger.log(`Simulation complete`);

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

    const exported_short = exportedLanesShortOfConsumption(simulation_context.entity_registry, final_history, output_inserter_ids, duration.ticks);
    for (const lane of exported_short) {
        logger.log(`Stability check: belt ${lane.belt_id} ${lane.item_name} exported ${lane.actual}, consumers take ${lane.expected}`);
    }

    // the simulated period can hit the expected output while the periods it alternates with fall short
    const repeat_periods = warmup_step.repeat_periods;
    let repeat_output_items: number | undefined;
    if (repeat_periods !== undefined && repeat_periods > 1 && duration.ticks * repeat_periods < MAX_SIMULATION_TICKS) {
        state_transition_history.recording = false;
        new SimulateStep(new_simulation_context, Duration.ofTicks(duration.ticks * (repeat_periods - 1))).execute();
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
        holds: Math.abs(total_actual_output - total_expected_output) <= LCM_STABILITY_TOLERANCE && exported_short.length === 0
            && repeats_at_expected_output,
        actual_output_items: total_actual_output,
        expected_output_items: total_expected_output,
        used_lcm: recipe_lcm,
        repeat_periods,
        repeat_output_items,
    };
    logger.log(`Stability check: actual=${total_actual_output} expected=${total_expected_output} stable=${stability_check.holds} (tolerance=${LCM_STABILITY_TOLERANCE})`);

    let backpressure_loss: LossOutcome | undefined;
    if (options.backpressure_loss) {
        // the run above is over: the trials go on from where it ended, and nothing of them goes into its histories
        inventory_transfer_history.recording = false;
        state_transition_history.recording = false;
        const loss_period = options.backpressure_loss.period_ticks;
        const repeat = subtickClockForPeriod(loss_period);
        const bin = Number.isInteger(loss_period) ? { ticks: loss_period, periods: 1 }
            : repeat === null ? null : { ticks: repeat.period_ticks, periods: repeat.scale };
        assert(bin !== null, `A clock of ${loss_period} ticks does not repeat in whole ticks, so its output cannot be counted by the period`);
        const own_clock_ticks = Array.from(inserter_clocks.values()).filter(clock => clock.own_clock).map(clock => clock.modulus);
        backpressure_loss = runLossTrials(new_simulation_context, output_inserter_states, options.backpressure_loss, bin,
            Math.max(bin.ticks, ...own_clock_ticks), isClockedThroughout(config, loss_period));
        logger.log(`Backpressure loss (${options.backpressure_loss.loss.kind}): recovers=${backpressure_loss.recovers} over ${backpressure_loss.trials.length} trials`);
    }


    return {
        simulation_context,
        new_simulation_context,
        target_production_rate,
        output_machine_state_machines,
        output_inserters,
        all_output_inserters,
        output_inserter_ids,
        crafting_cycle_plan,
        swing_counts,
        recipe_lcm,
        computed_lcm,
        serializable_transfer_plan,
        crafting_shares,
        always_enabled_by_config,
        /** The clocks of the inserters outside the plan (fuel and by-product), as the plan made them */
        inserter_clocks,
        /** The period of the clock */
        duration,
        /** What was recorded: `simulate_periods` periods */
        recorded_duration,
        /** The transfers of the recorded run, as the windows of the plan are read off them */
        final_history,
        state_transition_history,
        fuel_levels: fuel_level_recorder?.series(),
        machine_stock: stock_recorder?.recording(),
        /** What the run moved against what the plan expects */
        stability_check,
        total_expected_output,
        used_terminal_swing_count,
        /** What the build made after each trial of the loss, when one was asked for */
        backpressure_loss,
    };
}

/**
 * What a trial of a clock yields: the clock-only run of a build, as its blueprint runs it, with what it moved and
 * what was recorded of it. It plans nothing of its own and exports nothing.
 */
export interface TrialRun {
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
}

export function trialRunOf(run: BuildRun): TrialRun {
    return {
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

/**
 * Generates a blueprint from a configuration using the Runner pattern.
 * 
 * This function encapsulates the three-step process:
 * 1. Prepare: Wait until all machines are output blocked
 * 2. Warm up: Simulate the warm up period to ensure steady state
 * 3. Simulate: Run the final simulation and collect transfer history
 * 
 * @param config The configuration for the simulation
 * @param options Optional generation options (debug, debug_steps, logger)
 * @returns The generated blueprint and related metadata
 */
export function generateClockForConfig(
    config: Config,
    options: GenerateClockOptions = {}
): BlueprintGenerationResult {
    const logger = options.logger ?? defaultLogger;
    const run = runBuild(config, { logger, debug: options.debug, debug_steps: options.debug_steps, factorio_states: options.factorio_states });
    const {
        simulation_context, target_production_rate, output_machine_state_machines, output_inserters, all_output_inserters, output_inserter_ids,
        crafting_cycle_plan, swing_counts, recipe_lcm, computed_lcm, serializable_transfer_plan, crafting_shares, always_enabled_by_config,
        duration, recorded_duration, final_history, state_transition_history, stability_check, total_expected_output, used_terminal_swing_count,
    } = run;
    let inserter_clocks = run.inserter_clocks;

    const unslacked_windows = windowsFromHistory(final_history, simulation_context.entity_registry, always_enabled_by_config);
    const full_belt_pickup_slack = beltPickupSlackTicks(simulation_context.entity_registry);
    // on belts that do not move a clock is made without the slack, whatever the alternative asks for
    const non_moving_belts = config.overrides?.non_moving_belts === true;
    const belt_pickup_slack_mode = non_moving_belts ? "never" : options.belt_pickup_slack ?? "auto";
    const use_belt_pickup_slack = belt_pickup_slack_mode === "always" || (belt_pickup_slack_mode === "auto"
        && beltPickupSlackHelps(config, unslacked_windows, full_belt_pickup_slack, duration.ticks, total_expected_output, logger));
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
    const belt_pickup_slack_left_out = !non_moving_belts && !use_belt_pickup_slack && Number.isInteger(duration.ticks)
        && belt_fed_with_windows.length > 0;
    const slack_ticks = Array.from(new Set(Object.values(applied_belt_pickup_slack))).sort((a, b) => a - b);
    const belt: ClockBelt | null = belt_fed_with_windows.length === 0 ? null
        : slack_ticks.length > 0 ? { kind: "moving", slack_ticks } : { kind: "non_moving" };
    let planned_windows = options.given_windows === undefined
        ? withBeltPickupSlack(unslacked_windows, new Map([...fuel_hand_room, ...belt_pickup_slack]), duration.ticks)
        : new Map(Object.entries(options.given_windows).map(([entity_id, ranges]) => [entity_id, ranges.map(range => OpenRange.from(range.start, range.end))]));
    if (options.full_hand_output) {
        // waiting for a full hand past the output block would refuse input drops every cycle
        const full_hand_fits = output_inserters.every((os, index) =>
            handSizeFor(os.inserter, output_machine_state_machines[index].machine_state.machine.output.item_name)
                < output_machine_state_machines[index].machine_state.machine.output.outputBlock.quantity);
        const output_swings = new Map<string, number>();
        for (const [entity_id, etc] of swing_counts.entries()) {
            if (output_inserter_ids.has(entity_id.id)) {
                output_swings.set(entity_id.id, etc.total_transfer_count.toDecimal() * recipe_lcm);
            }
        }
        const full_hand = !full_hand_fits ? null : fullHandOutputWindows(
            { ...config, overrides: { ...config.overrides, derive_clock_windows: false } },
            planned_windows, output_swings,
            new Set(output_inserters.map(os => os.inserter.source.entity_id.id)),
            duration.ticks, logger, options.on_progress_detail
        );
        if (full_hand) {
            planned_windows = full_hand.windows;
        }
    }
    const entity_ids = new Map(simulation_context.entity_registry.getAll().map(entity => [entity.entity_id.id, entity.entity_id]));
    for (const entity_id of final_history.getAllTransfers().keys()) {
        // the blueprint looks up swing counts by EntityId identity, so prefer the history's own keys
        entity_ids.set(entity_id.id, entity_id);
    }
    // item names keep inserters with identical windows from being deduplicated into one combinator
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
    let shifted_cycle: ShiftedSwings | undefined;
    if (options.shifted_cycle) {
        const shifted = shiftedCycleWindows(
            { ...config, overrides: { ...config.overrides, derive_clock_windows: false } },
            planned_windows, crafting_cycle_plan.total_duration.ticks, duration.ticks, logger, options.on_progress_detail
        );
        if (shifted) {
            planned_windows = shifted.windows;
            shifted_cycle = {
                ...shifted.swings,
                moved: shifted.swings.moved.map(it => ({ ...it, item_names: (item_names.get(it.entity_id) ?? "").split(",").filter(Boolean) })),
            };
        }
    }
    const blueprintForWindows = (all_windows: Map<string, OpenRange[]>, subtick_clock?: SubtickClock, use_modulo = false): FactorioBlueprint => {
        const windows = withInserterClocks(all_windows, inserter_clocks, duration.ticks);
        return createSignalPerInserterBlueprint(
        target_production_rate.machine_production_rate.item,
        crafting_cycle_plan,
        duration,
        InventoryTransferHistory.removeDuplicateEntities(new InventoryTransferHistory(new Map(
            Array.from(windows.entries()).map(([key, ranges]) => [
                entity_ids.get(key)!,
                ranges.map(tick_range => ({ item_name: item_names.get(key) ?? key, tick_range, amount: 0 })),
            ])
        ))),
        simulation_context.entity_registry,
        subtick_clock,
        use_modulo,
        inserter_clocks,
    );
    };
    const moduloBlueprintFor = (windows: Map<string, OpenRange[]>) => {
        if (options.modulo_blueprint === false) {
            return undefined;
        }
        const blueprint = blueprintForWindows(windows, undefined, true);
        // only worth offering when a window repeats within the period: a fuel clock alone is a modulo of the clock too
        return blueprint.label?.includes("(modulo clock)") ? blueprint : undefined;
    };
    const subtick_clock = subtickClockForPeriod(duration.ticks);
    const subtickClockFor = (windows: Map<string, OpenRange[]>) => subtick_clock
        ? { clock: subtick_clock, blueprint: blueprintForWindows(windows, subtick_clock) }
        : undefined;

    let fuel_plan = fuelPlan(simulation_context.entity_registry, inserter_clocks, crafting_shares, duration.ticks);

    /**
     * Runs the exported clock for several periods, makes the fuel clocks from what the machines burned in it, and runs
     * it again with those. A machine burns in bursts, more in a stretch that starts as it begins to craft than its
     * crafting share says, and how often it stops depends on the windows: the run has both. The fuel clocks of the
     * plan stay when there is no run, or when a machine ran out of fuel with the measured ones.
     */
    const fuelClocksAndViewFor = (windows: Map<string, OpenRange[]>): FuelConsumptionView | undefined => {
        // the view is for fuel: a clock for an inserter taking a by-product off a machine does not need a longer run
        const has_fuel_inserter = Array.from(inserter_clocks.values()).some(clock => clock.kind === "fuel");
        if (!has_fuel_inserter || options.fuel_consumption_view === false) {
            return undefined;
        }
        const planned_view = fuelConsumptionView(config, windows, inserter_clocks, duration.ticks, logger, false);
        if (planned_view === undefined || planned_view.ran_out_of_fuel) {
            return planned_view;
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
            return planned_view;
        }
        const same = Array.from(measured_clocks, ([id, clock]) => {
            const planned = inserter_clocks.get(id);
            return planned !== undefined && planned.modulus === clock.modulus
                && planned.window.start_inclusive === clock.window.start_inclusive && planned.window.end_inclusive === clock.window.end_inclusive;
        }).every(Boolean);
        if (same) {
            fuel_plan = fuelPlan(simulation_context.entity_registry, inserter_clocks, crafting_shares, duration.ticks, limit_lasted);
            return planned_view;
        }
        // Long enough for the fuel clocks to meet the clock of the period every way they do, twice over: the fuel a
        // machine is down to depends on where its fuel windows fall in what it does
        const measured_fuel_ticks = Array.from(measured_clocks.values()).filter(clock => clock.kind === "fuel").map(clock => clock.modulus);
        const merged_ticks = mergedClockTicks(duration.ticks, measured_fuel_ticks);
        const measured_view = fuelConsumptionView(config, windows, measured_clocks, duration.ticks, logger, true,
            merged_ticks === null ? 0 : 2 * merged_ticks);
        if (measured_view === undefined || measured_view.ran_out_of_fuel) {
            logger.log("Fuel clocks: kept from the plan, a machine ran out of fuel with the measured ones");
            return planned_view;
        }
        logger.log(`Fuel clocks: made from the measured burn (${Array.from(measured_clocks.values()).filter(clock => clock.kind === "fuel").map(clock => `${clock.inserter_id} every ${clock.modulus}`).join(", ")})`);
        inserter_clocks = measured_clocks;
        fuel_plan = fuelPlan(simulation_context.entity_registry, inserter_clocks, crafting_shares, duration.ticks, limit_lasted);
        return measured_view;
    };

    let clock_only_run: ClockOnlyRun | undefined;
    let output_feeders: BlueprintGenerationResult["output_feeders"];
    const clockOnlyRunOf = (run: TrialRun): ClockOnlyRun => ({
        transfer_history: run.serializable_transfer_history,
        state_transition_history: run.serializable_state_transition_history,
    });

    /**
     * The feeders of the output machine are only an optimisation, kept when the build passes the same check with them
     * as it did without: the long run of the check just made gives the output of that machine, so no other run is
     * needed to make them. Returns the run of the check with them, after taking them up, or null (nothing changed).
     */
    function withOutputFeeders(
        check_config: Config,
        run: { check: AsBuiltStabilityCheck; stock?: StockRecording },
        start_phases: number,
    ): { result: TrialRun; check: AsBuiltStabilityCheck; stock?: StockRecording } | null {
        if (run.stock === undefined) {
            return null;
        }
        const feeders = windowsOfInsertersFeedingTheOutputMachine(check_config, planned_windows, duration.ticks, run.stock,
            new Set(all_output_inserters.map(os => os.inserter.source.entity_id.id)), logger);
        if (feeders.size === 0) {
            return null;
        }
        const fed_windows = new Map(planned_windows);
        for (const [inserter_id, feeder] of feeders) {
            fed_windows.set(inserter_id, feeder.windows);
        }
        const fed_run = runAsBuiltCheck(check_config, fed_windows, duration.ticks, logger, start_phases,
            (n, total) => options.on_progress_detail?.(`Checking output feeder windows, clock start ${n}/${total}`), OUTPUT_FEEDER_CHECK_TICKS);
        const passes_as_before = fed_run.check.holds && fed_run.check.failed_start_offset === undefined
            && fed_run.check.start_phases_checked === run.check.start_phases_checked;
        logger.log(`Output feeders: ${passes_as_before ? "kept" : "dropped, the as-built check with them does not pass as without"}`);
        if (!passes_as_before) {
            return null;
        }
        output_feeders = {
            inserter_ids: Array.from(feeders.keys()),
            window_count_without_feeder_windows: Array.from(feeders.keys()).reduce((sum, id) => sum + (planned_windows.get(id)?.length ?? 0), 0),
        };
        planned_windows = fed_windows;
        // identical windows and items share one combinator, as the nutrient inserters of the egg biochambers do
        for (const [inserter_id, feeder] of feeders) {
            item_names.set(inserter_id, feeder.item_name);
        }
        return fed_run;
    }

    if (config.overrides?.derive_clock_windows) {
        const planned_stable = stability_check.holds;
        const non_deriving_config: Config = { ...config, overrides: { ...config.overrides, derive_clock_windows: false } };
        const planned_run = runAsBuiltCheck(non_deriving_config, planned_windows, duration.ticks, logger, AS_BUILT_START_PHASES,
            (n, total) => options.on_progress_detail?.(`Checking planned windows, clock start ${n}/${total}`));
        let planned_check = planned_run.check;
        clock_only_run = clockOnlyRunOf(planned_run.result);
        if (planned_stable && planned_check.holds) {
            planned_check = runAsBuiltCheck(non_deriving_config, planned_windows, duration.ticks, logger, FULL_CHECK_START_PHASES,
                (n, total) => options.on_progress_detail?.(`Confirming planned windows, clock start ${n}/${total}`)).check;
        }
        logger.log(`Derived clock windows: planned windows as-built actual=${planned_check.actual_output_items} stable=${planned_check.holds} (${planned_check.start_phases_checked} start phases)`);
        // the feeders of the output machine are part of the planned windows, kept or dropped here as without derivation
        const plannedWithFeeders = () => {
            const fed = planned_stable && planned_check.holds
                ? withOutputFeeders(non_deriving_config, { check: planned_check, stock: planned_run.stock },
                    planned_check.start_phases_checked > AS_BUILT_START_PHASES ? FULL_CHECK_START_PHASES : AS_BUILT_START_PHASES)
                : null;
            if (fed) {
                planned_check = fed.check;
                clock_only_run = clockOnlyRunOf(fed.result);
            }
        };
        if (planned_stable && planned_check.holds && (options.derive_mode ?? "prefer_planned") === "prefer_planned") {
            // planned windows keep the plan's batched swings, which derived windows would break into per-craft swings
            plannedWithFeeders();
            stability_check.as_built = planned_check;
            return {
                ...buildResult(),
                derived_clock_windows: { succeeded: true, kept_planned_windows: true, end_padding_ticks: null },
            };
        }

        const uneven = options.derive_mode !== "uneven_output" ? null : deriveUnevenOutputClockWindows(
            config, final_history, output_inserter_ids, belt_pickup_slack, duration.ticks,
            Math.min(...output_machine_state_machines.map(it => it.machine_state.machine.crafting_rate.ticks_per_craft)),
            logger, options.on_progress_detail);
        // without a moved swing that works there is nothing to export; plain observed windows are their own alternative
        const derived = options.derive_mode === "uneven_output"
            ? uneven ?? { windows: null, end_padding_ticks: null, verification: null, as_built: null }
            : deriveClockWindows(config, final_history, output_inserter_ids, belt_pickup_slack, duration.ticks, logger, options.on_progress_detail);
        const report: DerivedClockWindowsReport = {
            succeeded: derived.windows !== null,
            kept_planned_windows: false,
            end_padding_ticks: derived.end_padding_ticks,
            moved_output_swing: uneven?.moved_output_swing ?? undefined,
        };
        stability_check.as_built = derived.as_built ?? undefined;
        stability_check.holds = stability_check.holds && derived.windows !== null;

        if (derived.windows !== null && derived.verification !== null) {
            const full_hand = fullHandTransferWindows(non_deriving_config, derived.windows, derived.verification,
                output_inserter_ids, simulation_context.entity_registry, duration.ticks, logger, options.on_progress_detail);
            const windows = full_hand?.windows ?? derived.windows;
            if (full_hand) {
                stability_check.as_built = full_hand.check;
                report.full_hand_inserters = full_hand.inserters;
            }
            // before the blueprint, which exports the fuel clocks this settles on
            const fuel_consumption_view = fuelClocksAndViewFor(windows);
            return {
                ...(full_hand?.result ?? derived.verification),
                blueprint: blueprintForWindows(windows),
                modulo_blueprint: moduloBlueprintFor(windows),
                subtick: subtickClockFor(windows),
                clock_windows: serializeClockWindows(withInserterClocks(windows, inserter_clocks, duration.ticks)),
                belt_pickup_slack_ticks: applied_belt_pickup_slack,
                belt_pickup_slack_left_out,
                // observed windows are what the inserters did, fuel hands included
                fuel_hand_room_ticks: {},
                belt,
                crafting_cycle_plan,
                fuel_consumption_view,
                unplanned_inserter_clocks: serializeInserterClocks(inserter_clocks),
                fuel_plan,
                used_lcm: recipe_lcm,
                used_terminal_swing_count,
                stability_check,
                serializable_transfer_plan,
                computed_lcm,
                derived_clock_windows: report,
            };
        }
        logger.log("Derived clock windows: no padding passed the as-built check; falling back to the planned windows.");
        plannedWithFeeders();
        stability_check.as_built = planned_check;
        stability_check.holds = planned_stable && planned_check.holds;
        return {
            ...buildResult(),
            derived_clock_windows: report,
        };
    }

    if (options.verify_as_built ?? false) {
        const as_built_run = runAsBuiltCheck(config, planned_windows, duration.ticks, logger, AS_BUILT_START_PHASES,
            (n, total) => options.on_progress_detail?.(`Checking clock-only output, clock start ${n}/${total}`));
        let kept_run = as_built_run;
        if (stability_check.holds && as_built_run.check.holds) {
            kept_run = withOutputFeeders(config, as_built_run, AS_BUILT_START_PHASES) ?? as_built_run;
        }
        stability_check.as_built = kept_run.check;
        clock_only_run = clockOnlyRunOf(kept_run.result);
        stability_check.holds = stability_check.holds && stability_check.as_built.holds;
        logger.log(`As-built check (clock windows only, ${stability_check.as_built.start_phases_checked} start phases): actual=${stability_check.as_built.actual_output_items} expected=${total_expected_output} stable=${stability_check.as_built.holds}`);
    }

    return buildResult();

    function buildResult(): BlueprintGenerationResult {
        // before the blueprint, which exports the fuel clocks this settles on
        const fuel_consumption_view = fuelClocksAndViewFor(planned_windows);
        const blueprint = blueprintForWindows(planned_windows);

        // Create serializable transfer history for UI visualization
        const serializable_transfer_history = serializeTransferHistory(
            final_history,
            simulation_context.entity_registry,
            recorded_duration.ticks
        );

        // Create serializable state transition history for UI visualization
        const serializable_state_transition_history = serializeStateTransitionHistory(
            state_transition_history,
            simulation_context.entity_registry,
            recorded_duration.ticks
        );

        return {
            blueprint,
            modulo_blueprint: moduloBlueprintFor(planned_windows),
            subtick: subtickClockFor(planned_windows),
            clock_windows: serializeClockWindows(withInserterClocks(planned_windows, inserter_clocks, duration.ticks)),
            belt_pickup_slack_ticks: applied_belt_pickup_slack,
            belt_pickup_slack_left_out,
            fuel_hand_room_ticks: Object.fromEntries(fuel_hand_room),
            belt,
            crafting_cycle_plan,
            simulation_duration: duration,
            output_feeders,
            transfer_history: final_history,
            serializable_transfer_history,
            serializable_state_transition_history,
            machine_facts: simulation_context.machines.map(it => ({
                entity_id: it.machine_state.machine.entity_id.id,
                facts: Machine.getMachineFacts(it.machine_state.machine),
            })),
            shifted_cycle,
            clock_only_run,
            fuel_consumption_view,
            unplanned_inserter_clocks: serializeInserterClocks(inserter_clocks),
            fuel_plan,
            used_lcm: recipe_lcm,
            used_terminal_swing_count,
            stability_check,
            serializable_transfer_plan,
            computed_lcm,
        };
    }
}

/**
 * The crafting cycle the clock is planned around, for a build whose machines have been run until output blocked
 * (the prepare step): what was crafted by then sets how many hands the output inserters take per cycle.
 * Throws when the build cannot reach the target rate or an output machine has no inserter taking from it.
 */
export function planCraftingCycle(config: Config, simulation_context: SimulationContext, logger: Logger) {
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

    // Every inserter that takes the target item out of the build; a machine can have several
    const inserter_states = simulation_context.state_registry.getAllStates().filter(EntityState.isInserter);
    const all_output_inserters = output_machine_state_machines.flatMap(machine_state_machine => {
        const ids = new Set(outputInsertersOf(machine_state_machine.machine_state.machine, simulation_context.entity_registry).map(it => it.entity_id.id));
        return inserter_states.filter(it => ids.has(it.entity_id.id));
    });
    // One of them per output machine, which the swings of a cycle are counted by
    const output_inserters = output_machine_state_machines.map(machine_state_machine => {
        const inserter = all_output_inserters.find(it => it.inserter.source.entity_id.id === machine_state_machine.machine_state.entity_id.id);
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

/** The hands every inserter and drill moves per crafting cycle, and the cycles the clock needs to make them whole */
export function transferPlanOf(config: Config, crafting_cycle_plan: CraftingCyclePlan, simulation_context: SimulationContext) {
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
export function windowsOfThePlanWhereInsertersRunFree(
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
            `Inserter ${inserter.entity_id.id.replace("inserter:", "")} puts ${items} onto belt ${inserter.sink.entity_id.id.replace("belt:", "")}, `
            + `but nothing in the config takes it off. Make it an export belt with a consumption rate (items/s) on that lane.`
        );
    }
}

/**
 * Belt lanes with a consumption rate must be filled at that rate (outside consumers would run dry otherwise).
 * Returns the lanes that fell short over the period.
 */
function exportedLanesShortOfConsumption(
    entity_registry: ReadableEntityRegistry,
    history: InventoryTransferHistory,
    output_inserter_ids: Set<string>,
    period_ticks: number,
): { belt_id: string, item_name: string, actual: number, expected: number }[] {
    const inserters = entity_registry.getAll().filter(Entity.isInserter);
    const moved = new Map<string, number>();
    for (const [entity_id, transfers] of history.entries()) {
        for (const transfer of transfers) {
            const key = `${entity_id.id}|${transfer.item_name}`;
            moved.set(key, (moved.get(key) ?? 0) + transfer.amount);
        }
    }
    const short = [];
    for (const belt of entity_registry.getAll().filter(Entity.isBelt)) {
        for (const lane of belt.lanes) {
            if (!lane.consumption_per_second) {
                continue;
            }
            const fillers = inserters.filter(it => it.sink.entity_id.id === belt.entity_id.id && it.filtered_items.has(lane.ingredient_name));
            if (fillers.length === 0 || fillers.some(it => output_inserter_ids.has(it.entity_id.id))) {
                continue;
            }
            const actual = fillers.reduce((sum, it) => sum + (moved.get(`${it.entity_id.id}|${lane.ingredient_name}`) ?? 0), 0);
            const expected = Math.round(lane.consumption_per_second * period_ticks / 60);
            if (expected - actual > LCM_STABILITY_TOLERANCE) {
                short.push({ belt_id: belt.entity_id.id, item_name: lane.ingredient_name, actual, expected });
            }
        }
    }
    return short;
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
    const windows = new Map<string, OpenRange[]>();
    for (const [entity_id, transfers] of history.entries()) {
        if (!always_enabled.has(entity_id.id) && !always_enabled_by_config.has(entity_id.id)) {
            windows.set(entity_id.id, OpenRange.reduceRanges(transfers.map(t => t.tick_range)));
        }
    }
    return windows;
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
 * @returns The generated blueprint result from the first stable swing count, with an attached
 *          backoff report. Falls back to the initial result if no stable swing count is found.
 */
export function generateClockWithSwingBackoff(
    config: Config,
    options: GenerateClockOptions = {}
): BlueprintGenerationResult {
    const logger = options.logger ?? defaultLogger;

    const initial_result = generateClockForConfig(config, options);
    const initial_swing_count = initial_result.used_terminal_swing_count;

    const swing_count_forced = config.overrides?.terminal_swing_count !== undefined;

    if (initial_result.stability_check.holds || swing_count_forced || initial_swing_count <= 1) {
        return {
            ...initial_result,
            swing_backoff_report: {
                triggered: false,
                initial_terminal_swing_count: initial_swing_count,
                initial_attempt: {
                    terminal_swing_count: initial_swing_count,
                    holds: initial_result.stability_check.holds,
                    actual_output_items: initial_result.stability_check.actual_output_items,
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
        const attempt_config: Config = {
            ...config,
            overrides: {
                ...config.overrides,
                terminal_swing_count: swings,
            },
        };

        const attempt_result = generateClockForConfig(attempt_config, options);

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


function serializeClockWindows(windows: Map<string, OpenRange[]>): SerializableClockWindows {
    return Object.fromEntries(Array.from(windows, ([key, ranges]) =>
        [key, ranges.map(r => ({ start: r.start_inclusive, end: r.end_inclusive }))]
    ));
}

/**
 * Helper function to compute the crafting cycle plan.
 * This function assumes all machines have finished crafting while not having any items pulled out of their inventories.
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
    
    // Compute max swings possible for each output machine and use the minimum
    let max_swings_possible: Fraction | null = null;
    
    for (let i = 0; i < output_machine_states.length; i++) {
        const machine_state = output_machine_states[i];
        const inserter = output_inserters[i];
        const output_machine = machine_state.machine;
        const output_crafted = machine_state.craftCount * output_machine.output.amount_per_craft.toDecimal();
        logger.log(`Output machine ${output_machine.entity_id.id} crafted ${output_crafted} ${output_item_name}`);
        
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
        const entity_id = `inserter:${inserter_config.id ?? index + 1}`;
        const enable_control_override = inserter_config.overrides?.enable_control;
        if (enable_control_override !== undefined) {
            map.set(entity_id, enable_control_override);
        }
    });

    // Process drill overrides (explicit id field)
    if (config.drills !== undefined) {
        config.drills.configs.forEach((drill_config) => {
            const entity_id = `drill:${drill_config.id}`; // Explicit id with type prefix
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
        assertIsMachine(sink_machine);
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
