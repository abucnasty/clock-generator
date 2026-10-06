import assert from "../common/assert";
import { Config } from '../config';
import { EnableControlOverrideConfig, EnableControlRange } from '../config/schema';
import { assertInserterCoverage } from '../config/inserter-coverage-validator';
import { DebugPluginFactory } from './sequence/debug/debug-plugin-factory';
import { DebugSettingsProvider, MutableDebugSettingsProvider } from './sequence/debug/debug-settings-provider';
import { FuelClock, fuelClocks, fuelOnlyInserters, fuelWindowsOverPeriod } from './sequence/fuel-clock';
import { cloneSimulationContextWithInterceptors, createEntityRegistryFromConfig, SimulationContext } from './sequence/simulation-context';
import { Duration, OpenRange } from '../data-types';
import { assertIsMachine, Entity, EntityId, handSizeFor, Inserter, Machine, ReadableEntityRegistry } from '../entities';
import { TargetProductionRate } from "./target-production-rate";
import { EntityState, InserterStatus, MachineState, MachineStatus } from "../state";
import Fraction, { fraction } from "fractionability";
import { createSignalPerInserterBlueprint, SubtickClock } from "./blueprint";
import { FactorioBlueprint, FactorioBlueprintFile, BlueprintBookBuilder } from "../blueprints/blueprint";
import { ResettableRegistry, TickProvider } from "../control-logic";
import { EntityTransferCountMap, SerializableTransferPlan } from "./sequence/cycle/swing-counts";
import { InventoryTransferHistory } from "./sequence/inventory-transfer-history";
import { InserterInventoryHistoryPlugin } from "../control-logic/inserter/plugins/inserter-inventory-transfer-plugin";
import { DrillInventoryTransferPlugin } from "../control-logic/drill/plugins/drill-inventory-transfer-plugin";
import { EnableControlFactory } from "./sequence/interceptors/inserter-enable-control-factory";
import { ConfigurableEnableControlFactory, EntityEnableControlOverrideMap } from "./sequence/interceptors/configurable-enable-control-factory";
import { CraftingCyclePlan } from "./sequence/cycle/crafting-cycle";
import { PrepareStep } from "./runner/steps/prepare-step";
import { WarmupStep } from "./runner/steps/warmup-step";
import { simulationStateKey } from "./runner/steady-state";
import { SimulateStep } from "./runner/steps/simulate-step";
import { RunnerStepType } from "./runner/steps/runner-step";
import { Logger, defaultLogger } from "../common/logger";
import { SerializableTransferHistory, serializeTransferHistory } from "./sequence/transfer-history-serializer";
import { StateTransitionHistory } from "./sequence/state-transition-history";
import { ClockInsight, clockInsights, MachineFactsEntry } from "./insights";
import { SerializableStateTransitionHistory, serializeStateTransitionHistory } from "./sequence/state-transition-serializer";
import { InserterStateTransitionTrackerPlugin } from "../control-logic/inserter/plugins/inserter-state-transition-tracker-plugin";
import { MachineStateTransitionTrackerPlugin } from "../control-logic/machine/plugins/machine-state-transition-tracker-plugin";
import { DrillStateTransitionTrackerPlugin } from "../control-logic/drill/plugins/drill-state-transition-tracker-plugin";

const MAX_SIMULATION_TICKS = 500_000;

/**
 * Maximum allowed deviation (in items) between actual and expected output transfers
 * when determining whether a simulation is considered stable.
 *
 * A tolerance of 1 accounts for minor trimming edge cases (e.g., back-swing wake-list
 * adjustments at period boundaries) while remaining strict enough to reliably detect
 * real instability such as output running at 50% of the expected rate.
 */
const LCM_STABILITY_TOLERANCE = 1;

/** Ticks between the clock reaching a value and an inserter acting on its decider (combinator output, then inserter wake-up) */
const CIRCUIT_LATENCY_TICKS = 2;
/** Inserters already wait one tick after being re-enabled in the simulation, so window starts need one tick less */
const SIMULATED_WAKE_DELAY_TICKS = 1;

/**
 * Number of clock start offsets the as-built check tries. Depending on how the clock lines up with the
 * machines when it starts, a factory can settle into different steady states (seen in game: 64/32 instead of 96).
 */
const AS_BUILT_START_PHASES = 12;
/** Start phases for the confirming check; failing phases can be a narrow band that the quick check skips */
const FULL_CHECK_START_PHASES = 112;

export type SerializableClockWindows = Record<string, { start: number; end: number }[]>;

/** One place tried for a moved crafting cycle or output swing, in ticks from its planned start (negative is earlier) */
export interface CheckedShift {
    shift_ticks: number;
    /** Passed the quick clock-only check (a dozen clock start phases); only the shift that is used is confirmed from more */
    is_stable: boolean;
}

/** Every place tried for one crafting cycle or output swing (1-based `index`), in shift order */
export interface CheckedShiftRow {
    index: number;
    shifts: CheckedShift[];
}

/** One end of the unbroken range of shifts that work around the shift in use */
export interface ShiftRangeEdge {
    shift_ticks: number;
    /** No place further out was tried: the moved windows would meet the same inserters' other windows or the end of the period */
    is_search_limit: boolean;
    /** What the inserters and machines are waiting on at this shift, the limits that stop the swings from going further */
    notes: string[];
}

/** The planned swings moved together by the shifted_cycle option */
export interface ShiftedSwings {
    /** 1-based crafting cycle within the clock period whose windows were moved */
    cycle: number;
    /** Ticks the windows were moved by (negative is earlier) */
    shift_ticks: number;
    /** Clock ticks the moved windows were planned in */
    planned_ticks: { start: number; end: number };
    /** Inserters and drills with a moved window, and the items they move */
    moved: { entity_id: string; item_names: string[] }[];
    shifts_checked: CheckedShiftRow[];
    /** Ends of the range that works around shift_ticks, for the moved cycle */
    earliest: ShiftRangeEdge;
    latest: ShiftRangeEdge;
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
    transfer_history: SerializableTransferHistory;
    state_transition_history: SerializableStateTransitionHistory;
}

/** What the build does when only the exported clock windows drive it, from the unshifted clock start */
export interface ClockOnlyRun {
    transfer_history: SerializableTransferHistory;
    state_transition_history: SerializableStateTransitionHistory;
}

export interface AsBuiltStabilityCheck {
    /** Whether the blueprint's clock windows alone, without the simulator's inventory conditions, produce the expected output from every start phase tried */
    is_stable: boolean;
    /** Output of the first failing start phase, or of the unshifted clock when all pass */
    actual_output_items: number;
    /** Number of clock start phases simulated (stops at the first failure) */
    start_phases_checked: number;
    /** Clock offset of the first failing start phase */
    failed_start_offset?: number;
    /** Periods after which the reported run repeats, when the simulation found the repeat; see SimulationStabilityCheck */
    repeat_periods?: number;
    /** Output items of the reported run over its repeat_periods periods; set when repeat_periods is more than 1 */
    repeat_output_items?: number;
}

export interface SimulationStabilityCheck {
    /** Whether the actual output items are within tolerance of the expected amount (and the as-built check passed, when run) */
    is_stable: boolean;
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

export interface DerivedClockWindowsReport {
    /** Whether the blueprint's windows (planned or derived) pass the as-built check */
    succeeded: boolean;
    /** True when the planned windows already passed the as-built check from every start phase, so nothing was derived */
    kept_planned_windows: boolean;
    /** Ticks added to the end of every derived window; null when nothing was derived or derivation failed */
    end_padding_ticks: number | null;
    /** Machine-to-machine inserters whose observed windows were replaced by brief full-hand windows */
    full_hand_inserters?: string[];
    /** With derive_mode "uneven_output": the output swing moved off its planned start and by how many ticks (negative is earlier) */
    moved_output_swing?: { swing: number; shift_ticks: number; shifts_checked: CheckedShiftRow[] };
}

export interface SwingAttemptResult {
    /** The terminal_swing_count value that was tried */
    terminal_swing_count: number;
    /** Whether this attempt produced stable output */
    is_stable: boolean;
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
     * With derive_clock_windows: "prefer_planned" keeps planned windows that pass the as-built check (default), "always"
     * derives anyway, "uneven_output" derives with one output swing moved off its planned start
     */
    derive_mode?: "prefer_planned" | "always" | "uneven_output";
    /** Replace the output inserters' windows with evenly spaced single swings timed to find a full hand ready */
    full_hand_output?: boolean;
    /** Move one crafting cycle's windows together to another place in the clock period, when the period spans several cycles */
    shifted_cycle?: boolean;
    /** Start warmup with the output machines still output blocked, so the clock has to drain the surplus */
    keep_output_buffers?: boolean;
    /** Warmup length in simulation periods (default 10) */
    warmup_periods?: number;
    /**
     * Simulate and record this many periods instead of one (default 1). The histories then cover the longer run;
     * the stability check compares one period of output, so it only means something at 1.
     */
    simulate_periods?: number;
    /** Also run the exported clock for several periods to show the fuel being consumed (default true; internal check runs never do) */
    fuel_consumption_view?: boolean;
    /** Also build the modulo-clock blueprint (default true; internal check runs never export it) */
    modulo_blueprint?: boolean;
    /** Called as generateClockAlternatives moves through its alternatives and their sub-steps */
    on_progress?: (progress: GenerationProgress) => void;
    /** Called with a short description of the current sub-step (clock-only checks, observed window derivation) */
    on_progress_detail?: (detail: string) => void;
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
    const state_transition_history = configureStateTransitionPlugins(simulation_context, relative_tick_provider);
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

    const { target_production_rate, output_machine_state_machines, output_inserters, crafting_cycle_plan } =
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
    const fuel_clocks = fuelClocks(simulation_context.entity_registry, crafting_cycle_plan.total_duration.ticks * recipe_lcm);

    // Create automatic enable control factory
    const enable_control_factory = new EnableControlFactory(
        simulation_context.state_registry,
        crafting_cycle_plan,
        relative_tick_provider,
        resettable_registry,
        logger,
        fuel_clocks,
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

    const duration: Duration = Duration.ofTicks(crafting_cycle_plan.total_duration.ticks * recipe_lcm);
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
    relative_tick = simulation_context.tick_provider.getCurrentTick();
    resettable_registry.resetAll();
    
    const simulate_periods = options.simulate_periods ?? 1;
    const recorded_duration = Duration.ofTicks(duration.ticks * simulate_periods);
    const simulate_step = new SimulateStep(new_simulation_context, recorded_duration);
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
    );
    const final_history = clipBeltFillerWindows(
        trimmed_history,
        simulation_context.entity_registry,
        new Set(output_inserters.map(os => os.inserter.entity_id.id)),
    );

    logger.log("\n--- Transfer History ---");
    InventoryTransferHistory.print(final_history, logger);

    // Compute output stability: compare actual items transferred by output inserters
    // against the expected amount derived from the crafting cycle plan.
    const output_inserter_ids = new Set(output_inserters.map(os => os.inserter.entity_id.id));
    let total_actual_output = 0;
    for (const [entity_id, transfers] of final_history.entries()) {
        if (output_inserter_ids.has(entity_id.id)) {
            total_actual_output += transfers.reduce((s, t) => s + t.amount, 0);
        }
    }
    let total_expected_output_float = 0;
    for (const [entity_id, etc] of swing_counts.entries()) {
        if (output_inserter_ids.has(entity_id.id)) {
            total_expected_output_float += etc.total_transfer_count.toDecimal() * etc.stack_size * recipe_lcm;
        }
    }
    const total_expected_output = Math.round(total_expected_output_float);
    // Compute effective terminal swing count from the output inserter in the entity_transfer_map
    let used_terminal_swing_count = 1;
    for (const [entity_id, etc] of swing_counts.entries()) {
        if (output_inserter_ids.has(entity_id.id)) {
            used_terminal_swing_count = Math.round(etc.total_transfer_count.toDecimal());
            break;
        }
    }

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
        is_stable: Math.abs(total_actual_output - total_expected_output) <= LCM_STABILITY_TOLERANCE && exported_short.length === 0
            && repeats_at_expected_output,
        actual_output_items: total_actual_output,
        expected_output_items: total_expected_output,
        used_lcm: recipe_lcm,
        repeat_periods,
        repeat_output_items,
    };
    logger.log(`Stability check: actual=${total_actual_output} expected=${total_expected_output} stable=${stability_check.is_stable} (tolerance=${LCM_STABILITY_TOLERANCE})`);

    const unslacked_windows = windowsFromHistory(final_history);
    const full_belt_pickup_slack = beltPickupSlackTicks(simulation_context.entity_registry);
    const belt_pickup_slack_mode = options.belt_pickup_slack ?? "auto";
    const use_belt_pickup_slack = belt_pickup_slack_mode === "always" || (belt_pickup_slack_mode === "auto"
        && beltPickupSlackHelps(config, unslacked_windows, full_belt_pickup_slack, duration.ticks, total_expected_output, logger));
    const belt_pickup_slack = use_belt_pickup_slack ? full_belt_pickup_slack : new Map<string, number>();
    let planned_windows = withBeltPickupSlack(unslacked_windows, belt_pickup_slack, duration.ticks);
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
    // a fuel inserter takes the items it carries from the inserter: its transfers are not always in the history, and
    // the name of the inserter would keep fuel inserters with the same windows from being merged into one combinator
    for (const inserter of fuelOnlyInserters(simulation_context.entity_registry)) {
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
        const windows = withFuelWindows(all_windows, fuel_clocks, duration.ticks);
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
        fuel_clocks,
    );
    };
    const moduloBlueprintFor = (windows: Map<string, OpenRange[]>) => {
        if (options.modulo_blueprint === false) {
            return undefined;
        }
        const blueprint = blueprintForWindows(windows, undefined, true);
        return blueprint.entities.some(entity => entity.name === "arithmetic-combinator") ? blueprint : undefined;
    };
    const subtick_clock = subtickClockForPeriod(duration.ticks);
    const subtickClockFor = (windows: Map<string, OpenRange[]>) => subtick_clock
        ? { clock: subtick_clock, blueprint: blueprintForWindows(windows, subtick_clock) }
        : undefined;

    const fuelConsumptionViewFor = (windows: Map<string, OpenRange[]>): FuelConsumptionView | undefined => {
        if (fuel_clocks.size === 0 || options.fuel_consumption_view === false) {
            return undefined;
        }
        return fuelConsumptionView(config, windows, fuel_clocks, duration.ticks, logger);
    };

    let clock_only_run: ClockOnlyRun | undefined;
    const clockOnlyRunOf = (run: BlueprintGenerationResult): ClockOnlyRun => ({
        transfer_history: run.serializable_transfer_history,
        state_transition_history: run.serializable_state_transition_history,
    });

    if (config.overrides?.derive_clock_windows) {
        const planned_stable = stability_check.is_stable;
        const non_deriving_config: Config = { ...config, overrides: { ...config.overrides, derive_clock_windows: false } };
        const planned_run = runAsBuiltCheck(non_deriving_config, planned_windows, duration.ticks, logger, AS_BUILT_START_PHASES,
            (n, total) => options.on_progress_detail?.(`Checking planned windows, clock start ${n}/${total}`));
        let planned_check = planned_run.check;
        clock_only_run = clockOnlyRunOf(planned_run.result);
        if (planned_stable && planned_check.is_stable) {
            planned_check = runAsBuiltCheck(non_deriving_config, planned_windows, duration.ticks, logger, FULL_CHECK_START_PHASES,
                (n, total) => options.on_progress_detail?.(`Confirming planned windows, clock start ${n}/${total}`)).check;
        }
        logger.log(`Derived clock windows: planned windows as-built actual=${planned_check.actual_output_items} stable=${planned_check.is_stable} (${planned_check.start_phases_checked} start phases)`);
        if (planned_stable && planned_check.is_stable && (options.derive_mode ?? "prefer_planned") === "prefer_planned") {
            // planned windows keep the plan's batched swings, which derived windows would break into per-craft swings
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
        stability_check.is_stable = stability_check.is_stable && derived.windows !== null;

        if (derived.windows !== null && derived.verification !== null) {
            const full_hand = fullHandTransferWindows(non_deriving_config, derived.windows, derived.verification,
                output_inserter_ids, simulation_context.entity_registry, duration.ticks, logger, options.on_progress_detail);
            const windows = full_hand?.windows ?? derived.windows;
            if (full_hand) {
                stability_check.as_built = full_hand.check;
                report.full_hand_inserters = full_hand.inserters;
            }
            return {
                ...(full_hand?.result ?? derived.verification),
                blueprint: blueprintForWindows(windows),
                modulo_blueprint: moduloBlueprintFor(windows),
                subtick: subtickClockFor(windows),
                clock_windows: serializeClockWindows(withFuelWindows(windows, fuel_clocks, duration.ticks)),
                belt_pickup_slack_ticks: Object.fromEntries(belt_pickup_slack),
                crafting_cycle_plan,
                fuel_consumption_view: fuelConsumptionViewFor(windows),
                used_lcm: recipe_lcm,
                used_terminal_swing_count,
                stability_check,
                serializable_transfer_plan,
                computed_lcm,
                derived_clock_windows: report,
            };
        }
        logger.log("Derived clock windows: no padding passed the as-built check; falling back to the planned windows.");
        stability_check.as_built = planned_check;
        stability_check.is_stable = planned_stable && planned_check.is_stable;
        return {
            ...buildResult(),
            derived_clock_windows: report,
        };
    }

    if (options.verify_as_built ?? false) {
        const as_built_run = runAsBuiltCheck(config, planned_windows, duration.ticks, logger, AS_BUILT_START_PHASES,
            (n, total) => options.on_progress_detail?.(`Checking clock-only output, clock start ${n}/${total}`));
        stability_check.as_built = as_built_run.check;
        clock_only_run = clockOnlyRunOf(as_built_run.result);
        stability_check.is_stable = stability_check.is_stable && stability_check.as_built.is_stable;
        logger.log(`As-built check (clock windows only, ${stability_check.as_built.start_phases_checked} start phases): actual=${stability_check.as_built.actual_output_items} expected=${total_expected_output} stable=${stability_check.as_built.is_stable}`);
    }

    return buildResult();

    function buildResult(): BlueprintGenerationResult {
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
            clock_windows: serializeClockWindows(withFuelWindows(planned_windows, fuel_clocks, duration.ticks)),
            belt_pickup_slack_ticks: Object.fromEntries(belt_pickup_slack),
            crafting_cycle_plan,
            simulation_duration: duration,
            transfer_history: final_history,
            serializable_transfer_history,
            serializable_state_transition_history,
            machine_facts: simulation_context.machines.map(it => ({
                entity_id: it.machine_state.machine.entity_id.id,
                facts: Machine.getMachineFacts(it.machine_state.machine),
            })),
            shifted_cycle,
            clock_only_run,
            fuel_consumption_view: fuelConsumptionViewFor(planned_windows),
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
function planCraftingCycle(config: Config, simulation_context: SimulationContext, logger: Logger) {
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

    // Find output inserters for each output machine
    const output_inserters = output_machine_state_machines.map(machine_state_machine => {
        const inserter = simulation_context.state_registry
            .getAllStates()
            .filter(EntityState.isInserter)
            .find(it => it.inserter.source.entity_id.id === machine_state_machine.machine_state.entity_id.id);
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

    return { target_production_rate, output_machine_state_machines, output_inserters, crafting_cycle_plan };
}

/** The hands every inserter and drill moves per crafting cycle, and the cycles the clock needs to make them whole */
function transferPlanOf(config: Config, crafting_cycle_plan: CraftingCyclePlan, simulation_context: SimulationContext) {
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

/** What validating a config finds out before any clock is generated */
export interface ConfigValidation {
    /** Hands each inserter and drill moves per crafting cycle */
    transfer_plan: SerializableTransferPlan;
    /** Crafting cycles in one clock period: the computed LCM, or the config's override */
    used_lcm: number;
    /** Hands each output inserter takes per crafting cycle, before any backoff a generation may apply */
    output_swings_per_cycle: number;
    cycle_ticks: number;
    period_ticks: number;
}

/**
 * Checks that a clock can be planned for the config and returns that plan, without generating any clock: every
 * ingredient and output has an inserter, the machines can reach the target rate, and every belt that is filled is
 * planned for. Costs one prepare run (the machines crafting until output blocked) instead of the hundreds of
 * simulations a generation does. Throws with the reason when the config is not valid.
 *
 * A generation can still end up with another plan than this one: it lowers the output swings when the planned
 * count is unstable, and offers other counts as potential clocks.
 */
export function validateConfig(config: Config, options: { logger?: Logger } = {}): ConfigValidation {
    const logger = options.logger ?? { log: () => { }, warn: () => { }, error: () => { }, debug: () => { } };
    assertInserterCoverage(config);

    const simulation_context = SimulationContext.fromConfig(config);
    new PrepareStep(simulation_context).execute();

    const { crafting_cycle_plan, output_inserters } = planCraftingCycle(config, simulation_context, logger);
    const { recipe_lcm, serializable_transfer_plan } = transferPlanOf(config, crafting_cycle_plan, simulation_context);
    const cycle_ticks = crafting_cycle_plan.total_duration.ticks;
    const output_ids = new Set(output_inserters.map(it => it.inserter.entity_id.id));
    const output_plan = crafting_cycle_plan.entity_transfer_map.entries_array().find(([entity_id]) => output_ids.has(entity_id.id));
    const output_swings_per_cycle = output_plan?.[1].total_transfer_count.toDecimal() ?? 1;
    return {
        transfer_plan: serializable_transfer_plan,
        used_lcm: recipe_lcm,
        output_swings_per_cycle,
        cycle_ticks,
        period_ticks: cycle_ticks * recipe_lcm,
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
 * An inserter that only takes by-products no machine in the config uses just clears them out of the machine,
 * whatever it puts them on. Nothing in the chain depends on its rate, so it is not planned.
 */
function takesUnusedByProductsOnly(entity_registry: ReadableEntityRegistry, inserter: Inserter): boolean {
    const source = entity_registry.getEntityById(inserter.source.entity_id);
    if (!source || !Entity.isMachine(source) || inserter.filtered_items.size === 0) {
        return false;
    }
    const machines = entity_registry.getAll().filter(Entity.isMachine);
    const by_products = new Set(source.outputs.slice(1).map(it => it.item_name));
    return Array.from(inserter.filtered_items).every(item_name =>
        by_products.has(item_name) && !machines.some(machine => machine.inputs.has(item_name))
    );
}

/** An inserter filling a belt nothing in the config empties has no rate to plan for */
function assertBeltFillersPlanned(entity_registry: ReadableEntityRegistry, swing_counts: EntityTransferCountMap): void {
    for (const inserter of entity_registry.getAll().filter(Entity.isInserter)) {
        if (!EntityId.isBelt(inserter.sink.entity_id) || swing_counts.has(inserter.entity_id)) {
            continue;
        }
        if (takesUnusedByProductsOnly(entity_registry, inserter)) {
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
    if (!Number.isInteger(period)) {
        return false;
    }
    const fixed = (control: EnableControlOverrideConfig | undefined) => control !== undefined && (
        control.mode === "ALWAYS" || control.mode === "NEVER"
        || (control.mode === "CLOCKED" && control.period_duration_ticks === period)
    );
    return config.inserters.every(inserter => fixed(inserter.overrides?.enable_control))
        && (config.drills?.configs ?? []).every(drill => fixed(drill.overrides?.enable_control));
}

const NESTED_RUN_OPTIONS = (logger: Logger): GenerateClockOptions => ({
    belt_pickup_slack: "never",
    modulo_blueprint: false,
    logger: { log: () => { }, warn: () => { }, error: logger.error.bind(logger), debug: () => { } },
    verify_as_built: false,
    fuel_consumption_view: false,
});

/** End padding candidates tried in order; a candidate is only used when the next one also passes, for margin */
const DERIVED_WINDOW_END_PADDING_CANDIDATES = [0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 14, 16];

const INSERTER_BUSY_STATUSES = new Set<string>([
    InserterStatus.PICKUP,
    InserterStatus.SWING,
    InserterStatus.DROP_OFF,
    InserterStatus.TARGET_FULL,
]);

/**
 * Derives clock windows by simulating with only the output inserters clocked (their planned windows)
 * and every other inserter free, then turning each inserter's busy time (pickup through return swing)
 * into a decider window. Windows are padded and accepted only if a clock-only simulation stays stable.
 * Drills keep their planned windows.
 */
function deriveClockWindows(
    config: Config,
    planned_history: InventoryTransferHistory,
    output_inserter_ids: Set<string>,
    belt_pickup_slack: Map<string, number>,
    period: number,
    logger: Logger,
    report?: (detail: string) => void,
): {
    windows: Map<string, OpenRange[]> | null;
    end_padding_ticks: number | null;
    verification: BlueprintGenerationResult | null;
    as_built: AsBuiltStabilityCheck | null;
} {
    const base_config: Config = { ...config, overrides: { ...config.overrides, derive_clock_windows: false } };
    const planned_windows = windowsFromHistory(planned_history);
    const output_windows = new Map(Array.from(planned_windows).filter(([key]) => output_inserter_ids.has(key)));
    // drills only report WORKING/DISABLED, so their activity gives no useful window to derive
    const drill_windows = new Map(Array.from(planned_windows).filter(([key]) => key.startsWith("drill:")));

    const planned = deriveWithOutputWindows(base_config, output_windows, drill_windows, output_inserter_ids, belt_pickup_slack, period, "planned output", logger, report);
    if (planned.windows !== null || planned.even_output_windows === null) {
        return planned;
    }
    // Bunched output swings (e.g. a double swing then a long gap) can leave a partial stack in hand when the window closes
    const even = deriveWithOutputWindows(base_config, planned.even_output_windows, drill_windows, output_inserter_ids, belt_pickup_slack, period, "evenly spaced output", logger, report);
    if (even.windows !== null) {
        return even;
    }
    return (even.as_built?.actual_output_items ?? 0) > (planned.as_built?.actual_output_items ?? 0) ? even : planned;
}

function deriveWithOutputWindows(
    base_config: Config,
    output_windows: Map<string, OpenRange[]>,
    drill_windows: Map<string, OpenRange[]>,
    output_inserter_ids: Set<string>,
    belt_pickup_slack: Map<string, number>,
    period: number,
    label: string,
    logger: Logger,
    report?: (detail: string) => void,
    /** Confirm the accepted padding from many more start phases; a caller comparing several results confirms its pick itself */
    confirm: boolean = true,
): {
    windows: Map<string, OpenRange[]> | null;
    end_padding_ticks: number | null;
    verification: BlueprintGenerationResult | null;
    as_built: AsBuiltStabilityCheck | null;
    even_output_windows: Map<string, OpenRange[]> | null;
} {
    const fixed_windows = new Map([...output_windows, ...drill_windows]);
    report?.(`Simulating with only the output inserters clocked (${label} windows)`);
    const derivation = generateClockForConfig(
        buildAsBuiltConfig(base_config, fixed_windows, period),
        NESTED_RUN_OPTIONS(logger)
    );
    logger.log(`Derived clock windows (${label}): output-only run actual=${derivation.stability_check.actual_output_items} expected=${derivation.stability_check.expected_output_items}`);
    const even_output_windows = evenlySpacedOutputWindows(output_windows, derivation, period);
    if (!derivation.stability_check.is_stable) {
        return { windows: null, end_padding_ticks: null, verification: derivation, as_built: null, even_output_windows };
    }

    const busy_windows = new Map<string, OpenRange[]>();
    for (const entity of derivation.serializable_state_transition_history.entities) {
        if (entity.entity_type !== "inserter" || output_inserter_ids.has(entity.entity_id)) {
            continue;
        }
        const ranges = busyDeciderRanges(entity.initial_status, entity.transitions, period);
        if (ranges.length > 0) {
            busy_windows.set(entity.entity_id, ranges);
        }
    }

    const attempts: { padding: number; result: BlueprintGenerationResult; check: AsBuiltStabilityCheck; windows: Map<string, OpenRange[]> }[] = [];
    for (const padding of DERIVED_WINDOW_END_PADDING_CANDIDATES) {
        const padded = new Map(fixed_windows);
        for (const [key, ranges] of busy_windows) {
            padded.set(key, OpenRange.reduceRanges(ranges.map(r =>
                OpenRange.from(r.start_inclusive, Math.min(r.end_inclusive + padding, period - 1))
            )));
        }
        const windows = withBeltPickupSlack(padded, belt_pickup_slack, period);
        const { result, check } = runAsBuiltCheck(base_config, windows, period, logger, AS_BUILT_START_PHASES,
            (n, total) => report?.(`Trying ${padding} tick${padding === 1 ? "" : "s"} of padding (${label} windows), clock start ${n}/${total}`));
        logger.log(`Derived clock windows (${label}): end padding ${padding} -> actual=${check.actual_output_items} stable=${check.is_stable} (${check.start_phases_checked} start phases)`);
        attempts.push({ padding, result, check, windows });

        const previous = attempts[attempts.length - 2];
        if (previous?.check.is_stable && check.is_stable) {
            if (!confirm) {
                return { windows, end_padding_ticks: padding, verification: result, as_built: check, even_output_windows };
            }
            // failing start phases can be a narrow band the quick check skips over
            const full = runAsBuiltCheck(base_config, windows, period, logger, FULL_CHECK_START_PHASES,
                (n, total) => report?.(`Confirming ${padding} tick${padding === 1 ? "" : "s"} of padding (${label} windows), clock start ${n}/${total}`)).check;
            logger.log(`Derived clock windows (${label}): end padding ${padding} full check -> actual=${full.actual_output_items} stable=${full.is_stable} (${full.start_phases_checked} start phases)`);
            if (full.is_stable) {
                return { windows, end_padding_ticks: padding, verification: result, as_built: full, even_output_windows };
            }
            check.is_stable = false;
            check.actual_output_items = full.actual_output_items;
            check.failed_start_offset = full.failed_start_offset;
            check.repeat_periods = full.repeat_periods;
            check.repeat_output_items = full.repeat_output_items;
        }
    }

    const best = attempts.reduce((a, b) => b.check.actual_output_items > a.check.actual_output_items ? b : a);
    return { windows: null, end_padding_ticks: null, verification: best.result, as_built: best.check, even_output_windows };
}

/** Groups checked shifts by the cycle or swing they moved, keeping their order */
function checkedShiftRows(checked: { index: number; shift_ticks: number; is_stable: boolean }[]): CheckedShiftRow[] {
    const rows = new Map<number, CheckedShift[]>();
    for (const { index, shift_ticks, is_stable } of checked) {
        rows.set(index, [...(rows.get(index) ?? []), { shift_ticks, is_stable }]);
    }
    return Array.from(rows, ([index, shifts]) => ({ index, shifts }));
}

/** Positions tried for a shifted crafting cycle; each costs up to a dozen clock-only simulations */
const MAX_SHIFTED_CYCLE_CANDIDATES = 48;
/** Best-ranked shifts confirmed from many start phases before giving up */
const MAX_SHIFTED_CYCLE_CONFIRMATIONS = 3;
/** Smallest shift tried, as a fraction of the crafting cycle; anything closer to the plan is barely a different clock */
const MIN_SHIFTED_CYCLE_FRACTION = 1 / 8;

interface ShiftedCycleCandidate {
    /** 0-based crafting cycle within the clock period */
    cycle_index: number;
    shift_ticks: number;
    /** False for the planned position and shifts next to it: checked to show the whole range, never used */
    selectable: boolean;
    windows: Map<string, OpenRange[]>;
}

/**
 * The planned windows with one crafting cycle's windows (every inserter's and drill's) moved together, keeping their
 * lengths and spacing. A window belongs to the cycle it starts in. The first cycle stays put as the reference, and a
 * moved window never touches the same entity's windows of another cycle or wraps the end of the period.
 * Only shifts at least an eighth of a cycle away from the planned position can be used; a cycle with none is left out.
 */
function shiftedCycleCandidates(
    planned_windows: Map<string, OpenRange[]>,
    cycle_ticks: number,
    period: number,
): ShiftedCycleCandidate[] {
    const cycles = Math.round(period / cycle_ticks);
    if (!Number.isInteger(period) || cycles < 2) {
        return [];
    }
    const cycleOf = (range: OpenRange) => Math.min(cycles - 1, Math.floor(range.start_inclusive / cycle_ticks));

    const room: { cycle_index: number; min: number; max: number }[] = [];
    for (let cycle_index = 1; cycle_index < cycles; cycle_index++) {
        let min = -Infinity;
        let max = Infinity;
        for (const ranges of planned_windows.values()) {
            const moved = ranges.filter(range => cycleOf(range) === cycle_index);
            if (moved.length === 0) {
                continue;
            }
            const fixed = ranges.filter(range => cycleOf(range) !== cycle_index);
            const first = Math.min(...moved.map(range => range.start_inclusive));
            const last = Math.max(...moved.map(range => range.end_inclusive));
            const before = Math.max(-2, ...fixed.filter(range => range.end_inclusive < first).map(range => range.end_inclusive));
            const after = Math.min(period + 1, ...fixed.filter(range => range.start_inclusive > last).map(range => range.start_inclusive));
            min = Math.max(min, before + 2 - first);
            max = Math.min(max, after - 2 - last);
        }
        if (Number.isFinite(min) && Number.isFinite(max) && max > min) {
            room.push({ cycle_index, min, max });
        }
    }
    const span = room.reduce((sum, it) => sum + it.max - it.min, 0);
    const step = Math.max(1, Math.ceil(span / MAX_SHIFTED_CYCLE_CANDIDATES));

    const candidates: ShiftedCycleCandidate[] = [];
    for (const { cycle_index, min, max } of room) {
        const of_cycle: ShiftedCycleCandidate[] = [];
        for (let shift_ticks = Math.ceil(min / step) * step; shift_ticks <= max; shift_ticks += step) {
            of_cycle.push({
                cycle_index,
                shift_ticks,
                selectable: Math.abs(shift_ticks) >= cycle_ticks * MIN_SHIFTED_CYCLE_FRACTION,
                windows: new Map(Array.from(planned_windows, ([key, ranges]) => [key, ranges
                    .map(range => cycleOf(range) !== cycle_index ? range
                        : OpenRange.from(range.start_inclusive + shift_ticks, range.end_inclusive + shift_ticks))
                    .sort((a, b) => a.start_inclusive - b.start_inclusive)])),
            });
        }
        if (of_cycle.some(it => it.selectable)) {
            candidates.push(...of_cycle);
        }
    }
    return candidates;
}

/** The windows a candidate moves, at the candidate's shift */
function movedWindows(
    planned_windows: Map<string, OpenRange[]>,
    candidate: { cycle_index: number; shift_ticks: number },
    cycle_ticks: number,
    period: number,
): { entity_id: string; start: number; end: number }[] {
    const cycles = Math.round(period / cycle_ticks);
    const moved: { entity_id: string; start: number; end: number }[] = [];
    for (const [entity_id, ranges] of planned_windows) {
        for (const range of ranges) {
            if (Math.min(cycles - 1, Math.floor(range.start_inclusive / cycle_ticks)) === candidate.cycle_index) {
                moved.push({ entity_id, start: range.start_inclusive + candidate.shift_ticks, end: range.end_inclusive + candidate.shift_ticks });
            }
        }
    }
    return moved;
}

/** Waits shorter than this are the normal tick or two between an inserter being enabled and moving */
const MIN_SHIFT_EDGE_WAIT_TICKS = 3;

/**
 * What limits a clock-only run at the edge of the range of shifts that work, read from what the moved inserters and
 * the machines they feed were waiting on: an inserter enabled but idle at a belt is waiting for its machine to drop
 * below an insertion limit, one waiting at a machine is waiting for a full hand, and a machine that stops until
 * the moved swings arrive has run out of ingredients.
 */
function shiftEdgeNotes(
    run: BlueprintGenerationResult,
    moved: { entity_id: string; start: number; end: number }[],
): string[] {
    const entities = new Map(run.serializable_state_transition_history.entities.map(entity => [entity.entity_id, entity]));
    const segmentsOf = (entity_id: string) => {
        const entity = entities.get(entity_id);
        if (entity === undefined) {
            return [];
        }
        const sorted = [...entity.transitions].sort((a, b) => a.tick - b.tick);
        const first_tick = sorted[0]?.tick ?? run.serializable_state_transition_history.total_duration_ticks;
        return [
            { status: entity.initial_status, start: 0, end: first_tick },
            ...sorted.map(it => ({ status: it.to_status, start: it.tick, end: it.tick + it.duration_ticks })),
        ];
    };
    // ticks an inserter is enabled for a decider window
    const enabledSpan = (window: { start: number; end: number }) => ({
        start: window.start + CIRCUIT_LATENCY_TICKS - SIMULATED_WAKE_DELAY_TICKS,
        end: window.end + CIRCUIT_LATENCY_TICKS + 1,
    });

    const notes = new Set<string>();
    for (const window of moved) {
        const entity = entities.get(window.entity_id);
        if (entity === undefined || entity.entity_type !== "inserter") {
            continue;
        }
        const span = enabledSpan(window);
        const segments = segmentsOf(window.entity_id);
        segments.forEach((segment, index) => {
            const waited = Math.min(segment.end, span.end) - Math.max(segment.start, span.start);
            const next = segments[index + 1];
            if (waited < MIN_SHIFT_EDGE_WAIT_TICKS || next === undefined || next.start >= span.end) {
                return;
            }
            if (segment.status === InserterStatus.IDLE && next.status === InserterStatus.PICKUP) {
                if (entity.source?.entity_id.startsWith("belt:") && entity.sink?.entity_id.startsWith("machine:")) {
                    const item = run.serializable_transfer_history.entities.find(it => it.entity_id === window.entity_id)
                        ?.transfers.filter(it => it.end_tick > next.start).sort((a, b) => a.start_tick - b.start_tick)[0]?.item_name;
                    notes.add(`${entity.label} waits ${waited} ticks for ${entity.sink.label} to drop below its insertion limit`
                        + (item ? ` for ${item}` : ""));
                } else if (entity.source?.entity_id.startsWith("machine:")) {
                    notes.add(`${entity.label} waits ${waited} ticks for ${entity.source.label} to have items`);
                }
            }
            if (segment.status === InserterStatus.PICKUP && next.status === InserterStatus.SWING && entity.source?.entity_id.startsWith("machine:")) {
                notes.add(`${entity.label} waits ${waited} ticks at ${entity.source.label} for a full hand`);
            }
        });

        // a machine that only starts again while these swings are under way was waiting for them
        const fed = entity.sink?.entity_id.startsWith("machine:") ? entity.sink.entity_id : entity.source?.entity_id;
        if (fed === undefined || !fed.startsWith("machine:")) {
            continue;
        }
        for (const segment of segmentsOf(fed)) {
            const stopped = segment.status === MachineStatus.INGREDIENT_SHORTAGE || segment.status === MachineStatus.OUTPUT_FULL;
            if (stopped && segment.end > span.start && segment.end <= span.end + MIN_SHIFT_EDGE_WAIT_TICKS && segment.end - segment.start >= MIN_SHIFT_EDGE_WAIT_TICKS) {
                const label = entities.get(fed)?.label ?? fed;
                notes.add(segment.status === MachineStatus.INGREDIENT_SHORTAGE
                    ? `${label} is out of ingredients for ${segment.end - segment.start} ticks until these swings arrive`
                    : `${label} stops for ${segment.end - segment.start} ticks until these swings arrive, out of ingredients with its output waiting to be removed`);
            }
        }
    }
    return Array.from(notes);
}

/**
 * Finds a place for one crafting cycle's planned windows other than where the plan put them. The plan repeats the
 * same cycle evenly over the clock period, but the build only has to balance over the whole period, so a cycle can
 * run earlier or later while the machines' buffers carry the difference. Every shift is checked with the clock-only
 * simulation; of those that pass, the one with the most passing shifts on either side (in the same direction from
 * the planned position) is confirmed from many start phases and used. Null when no shift passes.
 */
function shiftedCycleWindows(
    config: Config,
    planned_windows: Map<string, OpenRange[]>,
    cycle_ticks: number,
    period: number,
    logger: Logger,
    report?: (detail: string) => void,
): { windows: Map<string, OpenRange[]>; swings: ShiftedSwings } | null {
    const candidates = shiftedCycleCandidates(planned_windows, cycle_ticks, period);
    const describe = (candidate: ShiftedCycleCandidate) =>
        `cycle ${candidate.cycle_index + 1} ${Math.abs(candidate.shift_ticks)} ticks ${candidate.shift_ticks < 0 ? "earlier" : "later"}`;

    const passes = new Set<number>();
    const runs = new Map<number, BlueprintGenerationResult>();
    candidates.forEach((candidate, index) => {
        const { result, check } = runAsBuiltCheck(config, candidate.windows, period, logger, AS_BUILT_START_PHASES,
            (n, total) => report?.(`Shift ${index + 1}/${candidates.length} (${describe(candidate)}), clock start ${n}/${total}`));
        if (check.is_stable) {
            passes.add(index);
            runs.set(index, result);
        }
    });
    logger.log(`Shifted crafting cycle: ${passes.size} of ${candidates.length} shifts pass the quick clock-only check: `
        + Array.from(passes, index => `${candidates[index].cycle_index + 1}:${candidates[index].shift_ticks}`).join(" "));

    // candidates are listed per cycle in shift order; the shifts around the planned position are not used and end a run
    const sameRun = (a: ShiftedCycleCandidate, b: ShiftedCycleCandidate) =>
        a.selectable && b.selectable && a.cycle_index === b.cycle_index && Math.sign(a.shift_ticks) === Math.sign(b.shift_ticks);
    const neighboursPassing = (index: number, direction: 1 | -1) => {
        let run = 0;
        for (let next = index + direction; passes.has(next) && sameRun(candidates[next], candidates[index]); next += direction) {
            run++;
        }
        return run;
    };
    const margin = (index: number) => Math.min(neighboursPassing(index, 1), neighboursPassing(index, -1));
    const ranked = Array.from(passes).filter(index => candidates[index].selectable).sort((a, b) => margin(b) - margin(a)
        || Math.abs(candidates[a].shift_ticks) - Math.abs(candidates[b].shift_ticks));
    const shifts_checked = checkedShiftRows(candidates.map((candidate, index) =>
        ({ index: candidate.cycle_index + 1, shift_ticks: candidate.shift_ticks, is_stable: passes.has(index) })));

    for (const index of ranked.slice(0, MAX_SHIFTED_CYCLE_CONFIRMATIONS)) {
        const candidate = candidates[index];
        const full = runAsBuiltCheck(config, candidate.windows, period, logger, FULL_CHECK_START_PHASES,
            (n, total) => report?.(`Confirming ${describe(candidate)}, clock start ${n}/${total}`)).check;
        logger.log(`Shifted crafting cycle: ${describe(candidate)} full check -> stable=${full.is_stable}`);
        if (full.is_stable) {
            // the range that works runs through the planned position, so its ends ignore the direction split used for ranking
            const edgeOf = (direction: 1 | -1): ShiftRangeEdge => {
                let edge = index;
                while (passes.has(edge + direction) && candidates[edge + direction].cycle_index === candidate.cycle_index) {
                    edge += direction;
                }
                const beyond = candidates[edge + direction];
                return {
                    shift_ticks: candidates[edge].shift_ticks,
                    is_search_limit: beyond === undefined || beyond.cycle_index !== candidate.cycle_index,
                    notes: shiftEdgeNotes(runs.get(edge)!, movedWindows(planned_windows, candidates[edge], cycle_ticks, period)),
                };
            };
            const planned = movedWindows(planned_windows, { ...candidate, shift_ticks: 0 }, cycle_ticks, period);
            return {
                windows: candidate.windows,
                swings: {
                    cycle: candidate.cycle_index + 1,
                    shift_ticks: candidate.shift_ticks,
                    planned_ticks: {
                        start: Math.min(...planned.map(it => it.start)),
                        end: Math.max(...planned.map(it => it.end)),
                    },
                    moved: Array.from(new Set(planned.map(it => it.entity_id)), entity_id => ({ entity_id, item_names: [] })),
                    shifts_checked,
                    earliest: edgeOf(-1),
                    latest: edgeOf(1),
                },
            };
        }
    }
    return null;
}

/** Positions tried for moved output swings; each costs dozens of clock-only simulations */
const MAX_UNEVEN_OUTPUT_CANDIDATES = 24;

interface UnevenOutputCandidate {
    /** Index of the moved window among each output inserter's windows, in clock order */
    window_index: number;
    shift_ticks: number;
    output_windows: Map<string, OpenRange[]>;
}

/**
 * The planned output windows with one window moved earlier or later in steps of a craft, the first window staying
 * put as the reference. A moved window keeps at least its own length clear of its neighbours. Every output inserter
 * moves the same window by the same amount. Empty when there is a single window per period or the period is fractional.
 */
function unevenOutputCandidates(
    output_windows: Map<string, OpenRange[]>,
    period: number,
    step_ticks: number,
): UnevenOutputCandidate[] {
    const sorted = new Map(Array.from(output_windows, ([key, ranges]) =>
        [key, [...ranges].sort((a, b) => a.start_inclusive - b.start_inclusive)] as const));
    const count = Math.min(...Array.from(sorted.values(), ranges => ranges.length));
    if (!Number.isInteger(period) || sorted.size === 0 || count < 2
        || Array.from(sorted.values()).some(ranges => ranges.length !== count)) {
        return [];
    }

    // shifts every output inserter has room for, per moved window
    const room: { window_index: number; min: number; max: number }[] = [];
    for (let window_index = 1; window_index < count; window_index++) {
        let min = -Infinity;
        let max = Infinity;
        for (const ranges of sorted.values()) {
            const window = ranges[window_index];
            const length = window.end_inclusive - window.start_inclusive + 1;
            const next_start = window_index + 1 < count ? ranges[window_index + 1].start_inclusive : ranges[0].start_inclusive + period;
            min = Math.max(min, ranges[window_index - 1].end_inclusive + length + 1 - window.start_inclusive);
            max = Math.min(max, next_start - length - 1 - window.end_inclusive, period - 1 - window.end_inclusive);
        }
        room.push({ window_index, min, max });
    }
    const span = room.reduce((sum, it) => sum + Math.max(0, it.max - it.min), 0);
    const step = Math.max(step_ticks, span / MAX_UNEVEN_OUTPUT_CANDIDATES, 1);

    const candidates: UnevenOutputCandidate[] = [];
    for (const { window_index, min, max } of room) {
        const shifts = new Set<number>();
        for (let n = 1; n * step <= Math.max(max, -min); n++) {
            shifts.add(Math.round(n * step));
            shifts.add(-Math.round(n * step));
        }
        for (const shift_ticks of Array.from(shifts).filter(it => it >= min && it <= max).sort((a, b) => a - b)) {
            candidates.push({
                window_index,
                shift_ticks,
                output_windows: new Map(Array.from(sorted, ([key, ranges]) => [key, ranges.map((range, index) => index !== window_index ? range
                    : OpenRange.from(range.start_inclusive + shift_ticks, range.end_inclusive + shift_ticks))])),
            });
        }
    }
    return candidates;
}

/**
 * Like deriveClockWindows, but with one output swing moved off its planned start: a machine only has to make up for
 * its output over the whole period, so it can craft more between one pair of swings than the next. Every candidate
 * position gets its own observed windows; of those that pass the clock-only check, the one with the most passing
 * positions on either side is confirmed and used, since its neighbours show how far the timing can slip.
 * Null when there is nothing to move or no position passes.
 */
function deriveUnevenOutputClockWindows(
    config: Config,
    planned_history: InventoryTransferHistory,
    output_inserter_ids: Set<string>,
    belt_pickup_slack: Map<string, number>,
    period: number,
    step_ticks: number,
    logger: Logger,
    report?: (detail: string) => void,
): {
    windows: Map<string, OpenRange[]> | null;
    end_padding_ticks: number | null;
    verification: BlueprintGenerationResult | null;
    as_built: AsBuiltStabilityCheck | null;
    moved_output_swing: { swing: number; shift_ticks: number; shifts_checked: CheckedShiftRow[] };
} | null {
    const base_config: Config = { ...config, overrides: { ...config.overrides, derive_clock_windows: false } };
    const planned_windows = windowsFromHistory(planned_history);
    const output_windows = new Map(Array.from(planned_windows).filter(([key]) => output_inserter_ids.has(key)));
    const drill_windows = new Map(Array.from(planned_windows).filter(([key]) => key.startsWith("drill:")));

    const candidates = unevenOutputCandidates(output_windows, period, step_ticks);
    const passing: { index: number; candidate: UnevenOutputCandidate; derived: ReturnType<typeof deriveWithOutputWindows> }[] = [];
    candidates.forEach((candidate, index) => {
        const label = `output swing ${candidate.window_index + 1} moved ${candidate.shift_ticks} ticks`;
        const derived = deriveWithOutputWindows(base_config, candidate.output_windows, drill_windows, output_inserter_ids,
            belt_pickup_slack, period, label, logger,
            report && (detail => report(`Position ${index + 1}/${candidates.length}: ${detail}`)), false);
        if (derived.windows !== null) {
            passing.push({ index, candidate, derived });
        }
    });

    // candidates are listed per moved window in shift order, so neighbours in the list are neighbours in time
    const passes = new Set(passing.map(it => it.index));
    const neighboursPassing = (index: number, direction: 1 | -1) => {
        let run = 0;
        for (let next = index + direction; passes.has(next) && candidates[next].window_index === candidates[index].window_index; next += direction) {
            run++;
        }
        return run;
    };
    const margin = (index: number) => Math.min(neighboursPassing(index, 1), neighboursPassing(index, -1));
    const ranked = [...passing].sort((a, b) => margin(b.index) - margin(a.index)
        || Math.abs(a.candidate.shift_ticks) - Math.abs(b.candidate.shift_ticks));
    logger.log(`Uneven output swings: ${passing.length} of ${candidates.length} positions pass the quick clock-only check`);
    for (const { index, candidate, derived } of passing) {
        const windows = Array.from(derived.windows!, ([key, ranges]) => `${key} ${ranges.map(r => `${r.start_inclusive}-${r.end_inclusive}`).join(",")}`).join("; ");
        logger.log(`Uneven output swings: swing ${candidate.window_index + 1} moved ${candidate.shift_ticks} ticks, ${margin(index)} passing positions on each side: ${windows}`);
    }

    for (const { candidate, derived } of ranked) {
        const full = runAsBuiltCheck(base_config, derived.windows!, period, logger, FULL_CHECK_START_PHASES,
            (n, total) => report?.(`Confirming output swing ${candidate.window_index + 1} moved ${candidate.shift_ticks} ticks, clock start ${n}/${total}`));
        logger.log(`Uneven output swings: swing ${candidate.window_index + 1} moved ${candidate.shift_ticks} ticks full check -> stable=${full.check.is_stable}`);
        if (full.check.is_stable) {
            return {
                windows: derived.windows,
                end_padding_ticks: derived.end_padding_ticks,
                verification: full.result,
                as_built: full.check,
                moved_output_swing: {
                    swing: candidate.window_index + 1,
                    shift_ticks: candidate.shift_ticks,
                    shifts_checked: checkedShiftRows(candidates.map((it, index) =>
                        ({ index: it.window_index + 1, shift_ticks: it.shift_ticks, is_stable: passes.has(index) }))),
                },
            };
        }
    }
    return null;
}

/**
 * The output inserters' swings spread evenly over the period, one swing per window. Windows are the shortest
 * planned window minus the circuit latency, since the game keeps the inserter enabled that much longer and
 * a longer window lets it return and grab a partial stack. Null when that would not change anything or cannot be built.
 */
function evenlySpacedOutputWindows(
    output_windows: Map<string, OpenRange[]>,
    derivation: BlueprintGenerationResult,
    period: number,
): Map<string, OpenRange[]> | null {
    if (!Number.isInteger(period)) {
        return null;
    }
    const swing_counts = new Map<string, number>();
    for (const entity of derivation.serializable_state_transition_history.entities) {
        if (!output_windows.has(entity.entity_id)) {
            continue;
        }
        const sorted = [...entity.transitions].sort((a, b) => a.tick - b.tick);
        let status = entity.initial_status;
        let swings = 0;
        for (const transition of sorted) {
            if (transition.tick >= 1 && transition.tick <= period && transition.to_status === InserterStatus.DROP_OFF && status !== InserterStatus.DROP_OFF) {
                swings++;
            }
            status = transition.to_status;
        }
        swing_counts.set(entity.entity_id, swings);
    }

    const even = new Map<string, OpenRange[]>();
    let changed = false;
    for (const [key, ranges] of output_windows) {
        const swings = swing_counts.get(key) ?? 0;
        if (swings === 0 || ranges.length === 0) {
            return null;
        }
        const length = Math.min(...ranges.map(r => r.end_inclusive - r.start_inclusive + 1)) - CIRCUIT_LATENCY_TICKS;
        if (length < 1 || length >= period / swings) {
            return null;
        }
        const first = ranges[0].start_inclusive;
        const spaced: OpenRange[] = [];
        for (let k = 0; k < swings; k++) {
            spaced.push(...rotateRanges([OpenRange.from(first, first + length - 1)], Math.round(k * period / swings), period));
        }
        const reduced = OpenRange.reduceRanges(spaced);
        changed ||= reduced.length !== ranges.length || reduced.some((r, i) => r.start_inclusive !== ranges[i].start_inclusive || r.end_inclusive !== ranges[i].end_inclusive);
        even.set(key, reduced);
    }
    return changed ? even : null;
}

/** Busy ticks of a simulated inserter as decider windows (shifted back by the circuit latency) */
function busyDeciderRanges(
    initial_status: string,
    transitions: { tick: number; to_status: string }[],
    period: number,
): OpenRange[] {
    // manual lcm overrides can produce fractional periods; the simulation runs whole ticks up to the ceiling
    const ticks = Math.ceil(period);
    const busy = new Array<boolean>(ticks).fill(false);
    const sorted = [...transitions].sort((a, b) => a.tick - b.tick);
    let status = initial_status;
    let next = 0;
    // simulated clock ticks run 1..period, matching the clocked controls
    for (let tick = 1; tick <= ticks; tick++) {
        while (next < sorted.length && sorted[next].tick <= tick) {
            status = sorted[next].to_status;
            next++;
        }
        if (INSERTER_BUSY_STATUSES.has(status)) {
            busy[(((tick - CIRCUIT_LATENCY_TICKS) % ticks) + ticks) % ticks] = true;
        }
    }

    const ranges: OpenRange[] = [];
    let start: number | null = null;
    for (let tick = 0; tick <= ticks; tick++) {
        if (tick < ticks && busy[tick]) {
            start ??= tick;
        } else if (start !== null) {
            ranges.push(OpenRange.from(start, tick - 1));
            start = null;
        }
    }
    return ranges;
}

/**
 * Simulates the factory driven only by the given decider windows, first with the clock as planned and then
 * with the whole clock shifted to other start offsets relative to the machines' initial state.
 * Fractional periods are only checked unshifted.
 */
function runAsBuiltCheck(
    config: Config,
    decider_windows: Map<string, OpenRange[]>,
    period: number,
    logger: Logger,
    start_phases: number = AS_BUILT_START_PHASES,
    report?: (checked: number, total: number) => void,
): { result: BlueprintGenerationResult; check: AsBuiltStabilityCheck } {
    const step = Math.max(1, Math.floor(period / start_phases));
    const total = Math.min(start_phases, Math.floor((period - 1) / step) + 1);
    const result = generateClockForConfig(buildAsBuiltConfig(config, decider_windows, period), NESTED_RUN_OPTIONS(logger));
    const check: AsBuiltStabilityCheck = {
        is_stable: result.stability_check.is_stable,
        actual_output_items: result.stability_check.actual_output_items,
        start_phases_checked: 1,
        repeat_periods: result.stability_check.repeat_periods,
        repeat_output_items: result.stability_check.repeat_output_items,
    };
    report?.(1, total);
    if (!check.is_stable) {
        check.failed_start_offset = 0;
        return { result, check };
    }

    for (let offset = step; offset < period && check.start_phases_checked < start_phases; offset += step) {
        const rotated = new Map(Array.from(decider_windows, ([key, ranges]) => [key, rotateRanges(ranges, offset, period)] as const));
        const shifted = generateClockForConfig(buildAsBuiltConfig(config, rotated, period), NESTED_RUN_OPTIONS(logger));
        check.start_phases_checked++;
        report?.(check.start_phases_checked, total);
        if (!shifted.stability_check.is_stable) {
            check.is_stable = false;
            check.actual_output_items = shifted.stability_check.actual_output_items;
            check.failed_start_offset = offset;
            check.repeat_periods = shifted.stability_check.repeat_periods;
            check.repeat_output_items = shifted.stability_check.repeat_output_items;
            break;
        }
    }
    return { result, check };
}

function rotateRanges(ranges: OpenRange[], offset: number, period: number): OpenRange[] {
    // the simulated clock position (tick % period) is fractional for a fractional period
    const last_position = Number.isInteger(period) ? period - 1 : period;
    const rotated: OpenRange[] = [];
    for (const range of ranges) {
        const start = (range.start_inclusive + offset) % period;
        const end = start + (range.end_inclusive - range.start_inclusive);
        if (end >= period) {
            rotated.push(OpenRange.from(start, last_position));
            rotated.push(OpenRange.from(0, end - period));
        } else {
            rotated.push(OpenRange.from(start, end));
        }
    }
    return rotated;
}

const MAX_SUBTICK_SCALE = 1000;

const FULL_HAND_WINDOW_LENGTHS = [4, 6, 8];
const FULL_HAND_OFFSET_STEP = 1;
const FULL_HAND_MAX_CONFIRM_ATTEMPTS = 5;
/** A pickup longer than this waited at the machine for more items */
const FULL_HAND_SLOW_PICKUP_TICKS = 2;
/** Only searched when the planned output windows fill hands in this many extra grabs per hand or more */
const FULL_HAND_MIN_EXTRA_GRABS_PER_HAND = 0.25;
/** Spare output capacity: every n-th window is lengthened so a second grab can drain a surplus */
const FULL_HAND_SPARE_EVERY = [3, 2];
const FULL_HAND_SPARE_TICKS = Array.from({ length: 13 }, (_, i) => i + 4);
/** Warmup periods after which a run started with full output machines must be back at the expected output */
const FULL_HAND_RECOVERY_PERIODS = [1, 2];

type SpareWindows = { every: number; ticks: number };

/**
 * Output windows with one swing each, evenly spaced so each grab finds a full hand already in the machine
 * instead of picking up a few items at a time while the machine crafts. The start offset and window length
 * are searched with clock-only simulations: candidates that keep the expected output are ranked by how long
 * the output machines sit output full (at the input block, a delayed input drop in game starves the machine),
 * then by how many output pickups had to wait for items.
 * One grab per window only keeps up with production, so a surplus left by a disturbance (a slow drop onto a busy
 * belt) never drains and keeps the input drops blocked. The timing must recover from full output machines; if it
 * does not, every n-th window is lengthened for a second grab, preferring the fewest pickups that wait for items.
 * The result is confirmed from several clock start phases. Skipped when the planned windows already fill most hands
 * in one grab (and, with count_waits, when most pickups do not wait at the machine either).
 */
function fullHandOutputWindows(
    config: Config,
    windows: Map<string, OpenRange[]>,
    output_swings: Map<string, number>,
    output_machine_ids: Set<string>,
    period: number,
    logger: Logger,
    report?: (detail: string) => void,
    count_waits = false,
): { windows: Map<string, OpenRange[]>; result: BlueprintGenerationResult; check: AsBuiltStabilityCheck } | null {
    const swing_counts = Array.from(new Set(Array.from(output_swings.values(), s => Math.round(s * 1e6) / 1e6)));
    if (swing_counts.length !== 1 || !Number.isInteger(swing_counts[0]) || swing_counts[0] < 1) {
        return null;
    }
    const swings = swing_counts[0];
    const spacing = period / swings;
    const outputs = Array.from(output_swings.keys());

    const build = (offset: number, length: number, spare?: SpareWindows) => {
        const result = new Map(windows);
        // floor keeps every start below the period, so starts stay whole ticks
        const starts = Array.from({ length: swings }, (_, j) => Math.floor(offset + j * spacing));
        const ranges = OpenRange.reduceRanges(starts.flatMap((start, j) => {
            const extra = spare && j % spare.every === 0 ? spare.ticks : 0;
            return rotateRanges([OpenRange.from(0, length - 1 + extra)], start, period);
        }));
        outputs.forEach(key => result.set(key, ranges));
        return result;
    };
    const pickupStats = (result: BlueprintGenerationResult) => {
        let slow = 0;
        let pickups = 0;
        let swings = 0;
        for (const entity of result.serializable_state_transition_history.entities) {
            if (!output_swings.has(entity.entity_id)) {
                continue;
            }
            const transitions = [...entity.transitions].sort((a, b) => a.tick - b.tick);
            transitions.forEach((transition, index) => {
                if (transition.to_status === InserterStatus.DROP_OFF) {
                    swings++;
                }
                if (transition.to_status !== InserterStatus.PICKUP) {
                    return;
                }
                pickups++;
                const next = transitions[index + 1];
                if (next && next.tick - transition.tick > FULL_HAND_SLOW_PICKUP_TICKS) {
                    slow++;
                }
            });
        }
        return { slow, pickups, swings };
    };
    const slowPickups = (result: BlueprintGenerationResult) => pickupStats(result).slow;
    const outputFullTicks = (result: BlueprintGenerationResult) => {
        let ticks = 0;
        for (const entity of result.serializable_state_transition_history.entities) {
            if (!output_machine_ids.has(entity.entity_id)) {
                continue;
            }
            const transitions = [...entity.transitions].sort((a, b) => a.tick - b.tick);
            let status = entity.initial_status;
            let since = 0;
            for (const transition of transitions) {
                if (status === MachineStatus.OUTPUT_FULL) {
                    ticks += transition.tick - since;
                }
                status = transition.to_status;
                since = transition.tick;
            }
            if (status === MachineStatus.OUTPUT_FULL) {
                ticks += Math.ceil(period) - since;
            }
        }
        return ticks;
    };

    const planned = pickupStats(generateClockForConfig(buildAsBuiltConfig(config, windows, period), NESTED_RUN_OPTIONS(logger)));
    const extra_grabs = (planned.pickups - planned.swings) / Math.max(1, planned.swings);
    const waits = planned.slow / Math.max(1, planned.swings);
    logger.log(`Full-hand output: current windows take ${planned.pickups} grabs for ${planned.swings} hands, ${planned.slow} waited for items`);
    if (extra_grabs < FULL_HAND_MIN_EXTRA_GRABS_PER_HAND && !(count_waits && waits >= FULL_HAND_MIN_EXTRA_GRABS_PER_HAND)) {
        return null;
    }

    type Candidate = { offset: number; length: number; output_full: number; slow: number };
    const recovers = (candidate_windows: Map<string, OpenRange[]>) => FULL_HAND_RECOVERY_PERIODS.every(warmup_periods =>
        generateClockForConfig(buildAsBuiltConfig(config, candidate_windows, period),
            { ...NESTED_RUN_OPTIONS(logger), keep_output_buffers: true, warmup_periods }).stability_check.is_stable);
    // shortest spare first: longer windows let more grabs wait for items
    const recoveringTiming = (candidate: Candidate, label: string) => {
        if (recovers(build(candidate.offset, candidate.length))) {
            return { spare: undefined as SpareWindows | undefined, output_full: candidate.output_full, slow: candidate.slow };
        }
        for (const every of FULL_HAND_SPARE_EVERY) {
            for (const ticks of FULL_HAND_SPARE_TICKS.filter(t => candidate.length + t < spacing)) {
                report?.(`Searching spare output capacity (${label}, every ${every} windows +${ticks} ticks)`);
                const spare = { every, ticks };
                const spare_windows = build(candidate.offset, candidate.length, spare);
                const result = generateClockForConfig(buildAsBuiltConfig(config, spare_windows, period), NESTED_RUN_OPTIONS(logger));
                if (result.stability_check.is_stable && recovers(spare_windows)) {
                    return { spare, output_full: outputFullTicks(result), slow: slowPickups(result) };
                }
            }
        }
        return null;
    };
    const confirm = (candidate: Candidate) => {
        let label = `offset ${candidate.offset}, ${candidate.length}-tick windows`;
        report?.(`Checking full-hand output recovery (${label})`);
        const timing = recoveringTiming(candidate, label);
        if (!timing) {
            logger.log(`Full-hand output: ${label} does not recover from full output machines`);
            return null;
        }
        if (timing.spare) {
            label += `, every ${timing.spare.every} windows +${timing.spare.ticks} ticks`;
        }
        const candidate_windows = build(candidate.offset, candidate.length, timing.spare);
        const quick = runAsBuiltCheck(config, candidate_windows, period, logger, AS_BUILT_START_PHASES,
            (n, of) => report?.(`Checking full-hand output (${label}), clock start ${n}/${of}`)).check;
        if (!quick.is_stable) {
            return null;
        }
        const full = runAsBuiltCheck(config, candidate_windows, period, logger, FULL_CHECK_START_PHASES,
            (n, of) => report?.(`Confirming full-hand output (${label}), clock start ${n}/${of}`));
        logger.log(`Full-hand output: ${label}, ${timing.output_full} output-full ticks, ${timing.slow} slow pickups, stable=${full.check.is_stable}`);
        return full.check.is_stable ? { windows: candidate_windows, ...full } : null;
    };

    // shortest windows first; a timing with no output-full ticks and no slow pickups cannot be beaten, so try it at once
    const candidates: Candidate[] = [];
    let attempts = 0;
    let searched = 0;
    const total = FULL_HAND_WINDOW_LENGTHS.length * Math.ceil(spacing / FULL_HAND_OFFSET_STEP);
    for (const length of FULL_HAND_WINDOW_LENGTHS) {
        if (length >= spacing) {
            continue;
        }
        // per length, so failing short windows still leave longer ones a chance
        let length_attempts = 0;
        for (let offset = 0; offset < spacing; offset += FULL_HAND_OFFSET_STEP) {
            report?.(`Searching full-hand output timing (${++searched}/${total})`);
            const result = generateClockForConfig(buildAsBuiltConfig(config, build(offset, length), period), NESTED_RUN_OPTIONS(logger));
            if (!result.stability_check.is_stable) {
                continue;
            }
            const candidate = { offset, length, output_full: outputFullTicks(result), slow: slowPickups(result) };
            if (candidate.output_full > 0 || candidate.slow > 0) {
                candidates.push(candidate);
                continue;
            }
            if (length_attempts < FULL_HAND_MAX_CONFIRM_ATTEMPTS) {
                length_attempts++;
                attempts++;
                const confirmed = confirm(candidate);
                if (confirmed) {
                    return confirmed;
                }
            }
        }
    }
    candidates.sort((a, b) => a.output_full - b.output_full || a.slow - b.slow || a.length - b.length);
    for (const candidate of candidates.slice(0, Math.max(0, FULL_HAND_MAX_CONFIRM_ATTEMPTS - attempts))) {
        const confirmed = confirm(candidate);
        if (confirmed) {
            return confirmed;
        }
    }
    logger.log("Full-hand output: no timing kept the expected output; keeping the planned output windows.");
    return null;
}

/**
 * Machine-to-machine inserters that move a full hand every swing but wait at the source machine for it get brief,
 * evenly spaced windows instead (one inserter at a time), kept only when the clock-only check passes from every
 * start phase. In game, a long window keeps the inserter rescanning both machines while it waits.
 */
function fullHandTransferWindows(
    config: Config,
    windows: Map<string, OpenRange[]>,
    verification: BlueprintGenerationResult,
    output_inserter_ids: Set<string>,
    entity_registry: ReadableEntityRegistry,
    period: number,
    logger: Logger,
    report?: (detail: string) => void,
): { windows: Map<string, OpenRange[]>; result: BlueprintGenerationResult; check: AsBuiltStabilityCheck; inserters: string[] } | null {
    let current: { windows: Map<string, OpenRange[]>; result: BlueprintGenerationResult; check: AsBuiltStabilityCheck } | null = null;
    const inserters: string[] = [];
    for (const [entity_id, transfers] of verification.transfer_history.entries()) {
        const entity = entity_registry.getEntityByIdOrThrow(entity_id);
        if (!Entity.isInserter(entity) || output_inserter_ids.has(entity_id.id)
            || !EntityId.isMachine(entity.source.entity_id) || !EntityId.isMachine(entity.sink.entity_id)) {
            continue;
        }
        const source = entity_registry.getEntityByIdOrThrow(entity.source.entity_id);
        const stack_size = Entity.isMachine(source) ? handSizeFor(entity, source.output.item_name) : entity.metadata.stack_size;
        if (!Entity.isMachine(source) || stack_size >= source.output.outputBlock.quantity
            || transfers.length === 0 || transfers.some(t => t.amount !== stack_size)) {
            continue;
        }
        const found = fullHandOutputWindows(config, current?.windows ?? windows, new Map([[entity_id.id, transfers.length]]),
            new Set([source.entity_id.id]), period, logger, report, true);
        if (found) {
            current = found;
            inserters.push(entity_id.id);
        }
    }
    return current && { ...current, inserters };
}

/** A fractional period as p/q ticks with small integers (e.g. 550.9565... = 12672/23), or null */
function subtickClockForPeriod(period: number): SubtickClock | null {
    if (Number.isInteger(period)) {
        return null;
    }
    for (let q = 2; q <= MAX_SUBTICK_SCALE; q++) {
        const p = Math.round(period * q);
        // the multiply combinator outputs up to p * q, which must fit a 32-bit signal
        if (Math.abs(p / q - period) < 1e-6 && p * q < 2 ** 31) {
            return { period_ticks: p, scale: q };
        }
    }
    return null;
}

/** Longest the fuel consumption view runs, in simulated ticks */
const MAX_FUEL_VIEW_TICKS = 100_000;

/**
 * Runs the exported clock for several periods so a fuel inserter shows inserting. One period seldom does: a hand of
 * fuel lasts a machine longer than that, and the fuel slot's limit skips the window until it has burned down. The run
 * starts at one and a half times the longest a full hand lasts, and doubles while no fuel inserter swung.
 */
function fuelConsumptionView(
    config: Config,
    windows: Map<string, OpenRange[]>,
    fuel_clocks: ReadonlyMap<string, FuelClock>,
    period: number,
    logger: Logger,
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
    let periods = Math.min(Math.max(2, Math.ceil(1.5 * hand_lasts / period)), max_periods);
    while (true) {
        const run = generateClockForConfig(
            buildAsBuiltConfig(config, windows, period),
            { ...NESTED_RUN_OPTIONS(logger), simulate_periods: periods },
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
                transfer_history: run.serializable_transfer_history,
                state_transition_history: run.serializable_state_transition_history,
            };
        }
        periods = Math.min(periods * 2, max_periods);
    }
}

/** The windows of a clock with the fuel inserters on the clocks of their own, which do not come from the plan */
function withFuelWindows(
    windows: Map<string, OpenRange[]>,
    fuel_clocks: ReadonlyMap<string, FuelClock>,
    period: number,
): Map<string, OpenRange[]> {
    if (fuel_clocks.size === 0) {
        return windows;
    }
    const result = new Map(windows);
    for (const [inserter_id, clock] of fuel_clocks) {
        result.set(inserter_id, fuelWindowsOverPeriod(clock, period));
    }
    return result;
}

function windowsFromHistory(history: InventoryTransferHistory): Map<string, OpenRange[]> {
    const windows = new Map<string, OpenRange[]>();
    for (const [entity_id, transfers] of history.entries()) {
        windows.set(entity_id.id, OpenRange.reduceRanges(transfers.map(t => t.tick_range)));
    }
    return windows;
}

/**
 * Ticks added to the end of each belt-fed inserter's window. In game, a grab from a full belt can stall while a
 * gap left by an upstream inserter passes the pickup point, so the window must outlast a late pickup or the
 * inserter is disabled holding a partial hand. Sized as one more full-hand pickup (one lane stack per tick).
 */
const MAX_BELT_PICKUP_SLACK_TICKS = 16;

function beltPickupSlackTicks(entity_registry: ReadableEntityRegistry): Map<string, number> {
    const slack = new Map<string, number>();
    for (const entity of entity_registry.getAll()) {
        if (!Entity.isInserter(entity)) {
            continue;
        }
        const source = entity_registry.getEntityByIdOrThrow(entity.source.entity_id);
        if (!Entity.isBelt(source)) {
            continue;
        }
        const lanes = source.lanes.filter(lane => entity.filtered_items.has(lane.ingredient_name));
        const lane_stack_size = Math.min(...(lanes.length > 0 ? lanes : source.lanes).map(lane => lane.stack_size));
        const ticks = Math.ceil(entity.metadata.stack_size / lane_stack_size);
        slack.set(entity.entity_id.id, Math.min(ticks, MAX_BELT_PICKUP_SLACK_TICKS));
    }
    return slack;
}

function withBeltPickupSlack(
    windows: Map<string, OpenRange[]>,
    slack: Map<string, number>,
    period: number,
): Map<string, OpenRange[]> {
    const result = new Map<string, OpenRange[]>();
    for (const [key, ranges] of windows) {
        const ticks = slack.get(key) ?? 0;
        if (ticks === 0 || !Number.isInteger(period)) {
            result.set(key, ranges);
            continue;
        }
        const extended = ranges.flatMap(r => {
            const length = Math.min(r.end_inclusive - r.start_inclusive + ticks, period - 1);
            return rotateRanges([OpenRange.from(0, length)], r.start_inclusive, period);
        });
        result.set(key, OpenRange.reduceRanges(extended));
    }
    return result;
}

/**
 * Slack lets a belt-fed inserter finish a late pickup, but in a short period it can also leave time for an
 * extra swing when the machine is not at its insertion limit. False only when the clock-only check passes
 * without the slack but not with it, or lands further from the expected output with it.
 */
function beltPickupSlackHelps(
    config: Config,
    windows: Map<string, OpenRange[]>,
    slack: Map<string, number>,
    period: number,
    expected_output: number,
    logger: Logger,
): boolean {
    if (Array.from(slack.values()).every(ticks => ticks === 0) || !Number.isInteger(period)) {
        return true;
    }
    const base_config: Config = { ...config, overrides: { ...config.overrides, derive_clock_windows: false } };
    const with_slack = runAsBuiltCheck(base_config, withBeltPickupSlack(windows, slack, period), period, logger).check;
    if (with_slack.is_stable) {
        return true;
    }
    const without_slack = runAsBuiltCheck(base_config, windows, period, logger).check;
    logger.log(`Belt pickup slack: clock-only actual with=${with_slack.actual_output_items} without=${without_slack.actual_output_items} expected=${expected_output}`);
    if (without_slack.is_stable) {
        return false;
    }
    return Math.abs(with_slack.actual_output_items - expected_output) <= Math.abs(without_slack.actual_output_items - expected_output);
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
): Config {
    const windows = new Map<string, EnableControlRange[]>();
    // fuel inserters swing on clocks of their own, which the blueprint exports as repeating windows
    const fuel_clocks = fuelClocks(createEntityRegistryFromConfig(config), period);
    for (const [key, ranges] of withFuelWindows(decider_windows, fuel_clocks, period)) {
        windows.set(key, shiftRangesForCircuitLatency(ranges, period));
    }

    const asBuiltControl = (entity_key: string, current: EnableControlOverrideConfig | undefined): EnableControlOverrideConfig => {
        const ranges = windows.get(entity_key);
        if (ranges && ranges.length > 0) {
            return { mode: "CLOCKED", ranges, period_duration_ticks: period };
        }
        return current?.mode === "NEVER" ? current : { mode: "ALWAYS" };
    };

    return {
        ...config,
        inserters: config.inserters.map((inserter, index) => ({
            ...inserter,
            overrides: {
                ...inserter.overrides,
                enable_control: asBuiltControl(`inserter:${inserter.id ?? index + 1}`, inserter.overrides?.enable_control),
            },
        })),
        drills: config.drills === undefined ? undefined : {
            ...config.drills,
            configs: config.drills.configs.map(drill => ({
                ...drill,
                overrides: {
                    ...drill.overrides,
                    enable_control: asBuiltControl(`drill:${drill.id}`, drill.overrides?.enable_control),
                },
            })),
        },
    };
}

function shiftRangesForCircuitLatency(ranges: OpenRange[], period: number): EnableControlRange[] {
    const shifted: EnableControlRange[] = [];
    for (const range of ranges) {
        let start = range.start_inclusive + CIRCUIT_LATENCY_TICKS - SIMULATED_WAKE_DELAY_TICKS;
        let end = range.end_inclusive + CIRCUIT_LATENCY_TICKS;
        if (start >= period) {
            start -= period;
            end -= period;
        }
        if (end >= period) {
            shifted.push({ start, end: Number.isInteger(period) ? period - 1 : period });
            shifted.push({ start: 0, end: end - period });
        } else {
            shifted.push({ start, end });
        }
    }
    return shifted;
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

    if (initial_result.stability_check.is_stable || swing_count_forced || initial_swing_count <= 1) {
        return {
            ...initial_result,
            swing_backoff_report: {
                triggered: false,
                initial_terminal_swing_count: initial_swing_count,
                initial_attempt: {
                    terminal_swing_count: initial_swing_count,
                    is_stable: initial_result.stability_check.is_stable,
                    actual_output_items: initial_result.stability_check.actual_output_items,
                    expected_output_items: initial_result.stability_check.expected_output_items,
                },
                stable_terminal_swing_count: initial_result.stability_check.is_stable ? initial_swing_count : null,
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
        is_stable: false,
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
            is_stable: attempt_result.stability_check.is_stable,
            actual_output_items: attempt_result.stability_check.actual_output_items,
            expected_output_items: attempt_result.stability_check.expected_output_items,
        });

        logger.log(
            `swings=${swings}: actual=${attempt_result.stability_check.actual_output_items}, ` +
            `expected=${attempt_result.stability_check.expected_output_items}, ` +
            `stable=${attempt_result.stability_check.is_stable}`
        );

        if (attempt_result.stability_check.is_stable) {
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

export interface ClockAlternative {
    id: string;
    label: string;
    description: string;
    /** Total decider windows across inserters; fewer means more batched swings */
    inserter_window_count: number;
    /** The clock-only check (the build driven only by the exported clock windows) reaches the expected output */
    is_stable: boolean;
    /** Output of all copies at the period the exported clock actually runs (whole ticks unless it is a subtick clock) */
    items_per_second: number;
    /** What the simulation found that is worth explaining about the build and this clock */
    insights: ClockInsight[];
    result: BlueprintGenerationResult;
}

export interface ClockAlternativesResult {
    alternatives: ClockAlternative[];
    /** The stable alternative with the fewest inserter windows, or 0 when none is stable */
    selected_index: number;
}

/** The alternatives one generation run exports (a subtick and a rounded clock for a fractional period) */
export interface ClockAlternativeRun<T = ClockAlternative> {
    /** Runs with the same period and windows are duplicates; only the first is listed */
    signature: string;
    alternatives: T[];
}

/** What the remaining alternatives need from the first (planned + belt pickup slack) run */
/** Observed windows re-simulate the build hundreds of times; above this period (a high LCM) that takes minutes */
const MAX_OBSERVED_WINDOWS_PERIOD_TICKS = 2400;
/** Output swing counts above the planned one offered as alternatives */
const EXTENDED_SWING_COUNTS = 3;

export interface ClockAlternativeContext {
    swings: number;
    primary_stable: boolean;
    /** Clock period of the primary alternative */
    period_ticks: number;
}

export interface ClockAlternativeTask {
    id: string;
    label: string;
}

export interface ClockAlternativesPlan {
    primary: ClockAlternativeRun | null;
    context: ClockAlternativeContext;
    /** Independent of each other, so they can run in parallel; listed in display order */
    tasks: ClockAlternativeTask[];
}

interface AlternativeDefinition {
    id: string;
    label: string;
    description: string;
    run: () => BlueprintGenerationResult;
}

function quietOptions(options: GenerateClockOptions, logger: Logger, report?: (detail: string) => void): GenerateClockOptions {
    return {
        ...options,
        logger: { log: () => { }, warn: () => { }, error: logger.error.bind(logger), debug: () => { } },
        verify_as_built: true,
        on_progress_detail: report,
    };
}

function alternativeIsStable(result: BlueprintGenerationResult): boolean {
    return result.stability_check.as_built?.is_stable ?? result.stability_check.is_stable;
}

function primaryDefinition(config: Config, options: GenerateClockOptions, report?: (detail: string) => void): AlternativeDefinition {
    const base_config: Config = { ...config, overrides: { ...config.overrides, derive_clock_windows: false } };
    const result = generateClockWithSwingBackoff(base_config, { ...options, verify_as_built: true, belt_pickup_slack: "always", on_progress_detail: report });
    const slack_ticks = Array.from(new Set(Object.values(result.belt_pickup_slack_ticks))).sort((a, b) => a - b);
    const slack_label = slack_ticks.length === 0 ? ""
        : ` (+${slack_ticks.length === 1 ? slack_ticks[0] : `${slack_ticks[0]}–${slack_ticks[slack_ticks.length - 1]}`} ticks)`;
    return {
        id: "planned-belt-slack",
        label: `Planned + belt pickup slack${slack_label}`,
        description: "Same as Planned, but every inserter that picks up from a belt stays enabled a few extra ticks after each window: "
            + "long enough for one more full-hand pickup (one belt stack per tick). In game, gaps left on a shared belt by other "
            + "inserters can slow a pickup down; the extra ticks let it finish instead of the inserter being switched off "
            + "while holding a partial hand.",
        run: () => result,
    };
}

/**
 * Every alternative after the primary one. `known_stable` answers from runs that already finished, so the full-hand
 * alternative only re-simulates a planned run when it was not generated yet (e.g. in another worker).
 */
function alternativeDefinitions(
    config: Config,
    context: ClockAlternativeContext,
    quiet: GenerateClockOptions,
    known_stable: (id: string) => boolean | undefined = () => undefined,
): AlternativeDefinition[] {
    const base_config: Config = { ...config, overrides: { ...config.overrides, derive_clock_windows: false } };
    const fractional = config.overrides?.use_fractional_swings === true;
    const { swings } = context;
    const withSwings = (count: number, extra: GenerateClockOptions) => generateClockForConfig(
        { ...base_config, overrides: { ...base_config.overrides, terminal_swing_count: count } }, extra);
    // a forced count applies to every alternative
    const swings_forced = config.overrides?.terminal_swing_count !== undefined;
    const lower_counts = swings_forced ? [] : Array.from({ length: Math.max(0, swings - 1) }, (_, i) => swings - 1 - i);
    // the planned count only covers what a machine crafts before its output blocks; it keeps crafting while the
    // output inserter takes hands, so longer cycles can work too
    const higher_counts = swings_forced || context.period_ticks > MAX_OBSERVED_WINDOWS_PERIOD_TICKS ? []
        : Array.from({ length: EXTENDED_SWING_COUNTS }, (_, i) => swings + 1 + i);

    return [
        {
            id: "planned",
            label: "Planned",
            description: "The swing schedule the generator plans for the target rate. The build is simulated with each inserter waiting on "
                + "its machine's inventory, and each inserter's windows are the ticks it moved items. Swings are grouped into "
                + "batches that match the crafting cycle.",
            run: () => generateClockWithSwingBackoff(base_config, { ...quiet, belt_pickup_slack: "never" }),
        },
        {
            id: "fractional",
            label: fractional ? "Without fractional swings" : "Fractional swings",
            description: fractional ? "Planned windows with fractional swings turned off: every cycle uses the same whole number of swings."
                : "Planned windows with fractional swings turned on: an inserter that needs e.g. 3/2 swings per cycle alternates "
                + "between 1 and 2 swings instead of rounding, which can need fewer or shorter windows.",
            run: () => generateClockWithSwingBackoff(
                { ...base_config, overrides: { ...base_config.overrides, use_fractional_swings: !fractional } },
                quiet
            ),
        },
        ...(context.period_ticks > MAX_OBSERVED_WINDOWS_PERIOD_TICKS ? [] : [{
            id: "derived",
            label: "Observed windows",
            description: "Built from what the inserters actually do rather than from the planned schedule. The build is simulated with only "
                + "the output inserters clocked and every other inserter running freely; each inserter's windows are the ticks "
                + "it was busy picking up, swinging and dropping, plus a few ticks of padding. Swings end up spread out, roughly "
                + "one per craft, so there are usually more windows than Planned. An inserter between two machines that waits at "
                + "its source for a full hand gets short, evenly spaced windows instead when they stay stable, so it grabs a hand "
                + "that is already there rather than staying enabled while the machine crafts.",
            run: () => generateClockWithSwingBackoff(
                { ...config, overrides: { ...config.overrides, derive_clock_windows: true } },
                { ...quiet, derive_mode: "always" }
            ),
        }]),
        ...(context.period_ticks > MAX_OBSERVED_WINDOWS_PERIOD_TICKS ? [] : [{
            id: "uneven-output",
            label: "Uneven output swings",
            description: "Observed windows with one output swing moved off its planned start, so the output swings are not evenly "
                + "spaced. A machine only has to make up for what the output inserter takes over the whole clock period, so it can "
                + "craft more between one pair of swings than the next and carry the difference in its output slot. The swing is "
                + "tried at positions a craft apart and every other inserter's windows are observed again for each; the position "
                + "with the most working positions on either side is used. Only offered when the period has more than one output "
                + "swing and a moved swing passes the clock-only check.",
            run: () => {
                // one search at the planned swing count; backing off would repeat it for every lower count
                const result = generateClockForConfig(
                    { ...config, overrides: { ...config.overrides, derive_clock_windows: true } },
                    { ...quiet, derive_mode: "uneven_output" }
                );
                assert(result.derived_clock_windows?.moved_output_swing !== undefined, "no moved output swing passes the clock-only check");
                return result;
            },
        }]),
        {
            id: "shifted-swings",
            label: "Shifted swings",
            description: "Planned windows (with belt pickup slack) with one round of swings moved together to another place in the "
                + "clock period: an output swing and the input swings planned with it. The plan spaces these rounds evenly, but a "
                + "machine takes a swing whenever its limits allow: an input hand once it is below its insertion limit and before "
                + "it runs out of that ingredient, an output hand once a full one is ready and before the output fills up. Within "
                + "those limits a round can run earlier or later. Window lengths and their spacing within the round are kept, so "
                + "swings stay as batched as planned. Every shift is checked with the clock-only simulation and the one with the "
                + "most working shifts on either side is used. Only offered when the clock period has more than one round and a "
                + "shift passes.",
            run: () => {
                // one search at the planned swing count, like uneven output swings
                const result = generateClockForConfig(base_config, { ...quiet, belt_pickup_slack: "always", shifted_cycle: true });
                assert(result.shifted_cycle !== undefined, "no shifted round of swings passes the clock-only check");
                return result;
            },
        },
        ...higher_counts.map(higher => ({
            id: `swings-${higher}`,
            label: `${higher} output swings per cycle`,
            description: `Planned windows with a longer crafting cycle: the output inserter takes ${higher} hands per cycle instead of `
                + `${swings} while the machine keeps crafting between swings. Batches more swings into fewer, longer windows.`,
            run: () => withSwings(higher, quiet),
        })),
        ...lower_counts.map(lower => ({
            id: `swings-${lower}`,
            label: `${lower} output swing${lower === 1 ? "" : "s"} per cycle`,
            description: `Planned windows with the output inserter limited to ${lower} swing${lower === 1 ? "" : "s"} per crafting cycle `
                + `instead of ${swings}. The output machine buffers more between swings; useful when the higher swing count `
                + "is unstable.",
            run: () => withSwings(lower, quiet),
        })),
        {
            id: "full-hand",
            label: "Full-hand output swings",
            description: "Output inserters swing once per window, evenly spaced and timed so the machine already holds a full hand when "
                + "the inserter arrives, instead of grabbing a few items at a time while the machine crafts. Only offered when the "
                + "planned output inserters often need more than one grab per hand and a full hand fits below the output block. The timing is "
                + "searched with clock-only simulations, preferring the fewest pickups that wait for items. The timing must "
                + "recover from full output machines; if it does not, some windows are lengthened so a second grab can drain the "
                + "surplus. Other inserters keep the planned windows (with belt pickup slack).",
            run: () => {
                // input windows come from the first planned run whose clock passes, most batched first
                const full_hand: GenerateClockOptions = { ...quiet, belt_pickup_slack: "always", full_hand_output: true };
                if (context.primary_stable) {
                    return generateClockWithSwingBackoff(base_config, full_hand);
                }
                const stable_lower = lower_counts.find(lower =>
                    known_stable(`swings-${lower}`) ?? alternativeIsStable(withSwings(lower, { ...quiet, on_progress_detail: undefined })));
                return stable_lower === undefined
                    ? generateClockWithSwingBackoff(base_config, full_hand)
                    : withSwings(stable_lower, full_hand);
            },
        },
    ];
}

/** Sentences for an alternative's description about what the clock-only check found beyond the output count */
function asBuiltNotes(as_built: AsBuiltStabilityCheck | undefined, expected_output_items: number): string {
    if (as_built === undefined) {
        return "";
    }
    let notes = "";
    if (as_built.repeat_periods !== undefined && as_built.repeat_output_items !== undefined) {
        const expected = expected_output_items * as_built.repeat_periods;
        notes += ` In the clock-only check the build repeats every ${as_built.repeat_periods} periods instead of every period, `
            + `moving ${as_built.repeat_output_items} of ${expected} items over them.`;
    }
    return notes;
}

function runAlternative(definition: AlternativeDefinition, copies: number, logger: Logger): ClockAlternativeRun | null {
    let result: BlueprintGenerationResult;
    try {
        result = definition.run();
    } catch (error) {
        logger.log(`Clock alternative "${definition.label}" could not be generated: ${error instanceof Error ? error.message : error}`);
        return null;
    }
    const { id, label } = definition;
    const signature = JSON.stringify([result.simulation_duration.ticks, result.clock_windows]);
    const inserter_window_count = Object.entries(result.clock_windows)
        .filter(([key]) => key.startsWith("inserter:"))
        .reduce((sum, [, ranges]) => sum + ranges.length, 0);
    // the planning simulation drives inserters from inventory levels and can over- or undershoot
    // where the exported clock does not; in game, recordings matched the clock-only check
    const { as_built, actual_output_items, expected_output_items } = result.stability_check;
    const is_stable = alternativeIsStable(result);
    const planning_note = actual_output_items === expected_output_items ? ""
        : ` The planning simulation moved ${actual_output_items} of ${expected_output_items} items per period; `
        + "stability is judged by the clock-only check, which runs the exported clock windows.";
    const moved = result.derived_clock_windows?.moved_output_swing;
    const moved_note = moved === undefined ? ""
        : ` Output swing ${moved.swing} starts ${Math.abs(moved.shift_ticks)} ticks ${moved.shift_ticks < 0 ? "earlier" : "later"} than planned.`;
    const shifted = result.shifted_cycle;
    const shifted_note = shifted === undefined ? ""
        : ` The swings planned in clock ticks ${shifted.planned_ticks.start}–${shifted.planned_ticks.end} (`
        + shifted.moved.map(it => `${it.entity_id.replace(":", " ")}: ${it.item_names.join(", ")}`).join("; ")
        + `) start ${Math.abs(shifted.shift_ticks)} ticks ${shifted.shift_ticks < 0 ? "earlier" : "later"} than planned.`;
    const description = definition.description + moved_note + shifted_note + planning_note + asBuiltNotes(as_built, expected_output_items);
    logger.log(`Clock alternative "${label}": windows=${inserter_window_count} stable=${is_stable} as-built=${as_built?.actual_output_items}/${expected_output_items} planned=${actual_output_items}`);
    const insights = clockInsights(result, is_stable);
    const period = result.simulation_duration.ticks;
    const rateAt = (clock_period: number) => result.stability_check.expected_output_items * 60 / clock_period * copies;
    if (!result.subtick) {
        return { signature, alternatives: [{ id, label, description, inserter_window_count, is_stable, items_per_second: rateAt(period), insights, result }] };
    }
    const { period_ticks, scale } = result.subtick.clock;
    const rounded = Math.floor(period);
    return {
        signature,
        alternatives: [
            // listed first so it wins ties with the rounded clock for the default selection
            {
                id: `${id}-subtick`,
                label: `${label}, subtick clock`,
                description: `${description} Exported with a subtick clock: the ${period.toFixed(3)}-tick period is `
                    + `${period_ticks}/${scale} ticks, so a ${period_ticks}-tick clock is multiplied by ${scale} and taken modulo `
                    + `${period_ticks} by two extra arithmetic combinators, giving the position in the period in 1/${scale} ticks. `
                    + "Window starts can move by a tick between periods but never drift, so the build runs at exactly the target rate.",
                inserter_window_count,
                is_stable,
                items_per_second: rateAt(period),
                insights,
                result: { ...result, blueprint: result.subtick.blueprint },
            },
            {
                id,
                label: `${label} (clock rounded to ${rounded} ticks)`,
                description: `${description} The period is not a whole number of ticks (${period.toFixed(3)}), so this clock `
                    + `runs it rounded down to ${rounded} ticks, slightly faster than the target; the clock-only check models `
                    + "the exact period, so the machines need a little headroom.",
                inserter_window_count,
                is_stable,
                items_per_second: rateAt(rounded),
                insights,
                result,
            },
        ],
    };
}

/** Runs the primary (planned + belt pickup slack) alternative and lists the rest as independent tasks */
export function planClockAlternatives(config: Config, options: GenerateClockOptions = {}): ClockAlternativesPlan {
    const logger = options.logger ?? defaultLogger;
    const definition = primaryDefinition(config, options, options.on_progress_detail);
    const primary = runAlternative(definition, config.target_output.copies ?? 1, logger);
    const result = definition.run();
    const context: ClockAlternativeContext = {
        swings: result.used_terminal_swing_count,
        primary_stable: alternativeIsStable(result),
        period_ticks: result.simulation_duration.ticks,
    };
    const tasks = alternativeDefinitions(config, context, {}).map(({ id, label }) => ({ id, label }));
    return { primary, context, tasks };
}

/** Generates one alternative listed by planClockAlternatives; progress goes to options.on_progress_detail */
export function runClockAlternativeTask(
    config: Config,
    context: ClockAlternativeContext,
    task_id: string,
    options: GenerateClockOptions = {},
): ClockAlternativeRun | null {
    const logger = options.logger ?? defaultLogger;
    const definition = alternativeDefinitions(config, context, quietOptions(options, logger, options.on_progress_detail))
        .find(it => it.id === task_id);
    assert(definition !== undefined, `Unknown clock alternative task "${task_id}"`);
    return runAlternative(definition, config.target_output.copies ?? 1, logger);
}

/** Lists runs in order, skipping duplicates, and selects the stable alternative with the fewest windows */
export function combineClockAlternativeRuns<T>(
    runs: (ClockAlternativeRun<T> | null)[],
    is_stable: (alternative: T) => boolean,
    window_count: (alternative: T) => number,
): { alternatives: T[]; selected_index: number } {
    const seen = new Set<string>();
    const alternatives: T[] = [];
    for (const run of runs) {
        if (run && !seen.has(run.signature)) {
            seen.add(run.signature);
            alternatives.push(...run.alternatives);
        }
    }
    let selected_index = 0;
    alternatives.forEach((alternative, index) => {
        const best = alternatives[selected_index];
        if (is_stable(alternative) && (!is_stable(best) || window_count(alternative) < window_count(best))) {
            selected_index = index;
        }
    });
    return { alternatives, selected_index };
}

/**
 * Generates the same config several ways (planned windows with and without belt pickup slack, derived
 * per-craft windows, fractional swings toggled, lower output swing counts, full-hand output) and checks each
 * with the clock-only simulation from several start phases. Alternatives with identical windows are listed once.
 * Runs everything in sequence; the UI runs the tasks from planClockAlternatives in parallel workers instead.
 */
export function generateClockAlternatives(
    config: Config,
    options: GenerateClockOptions = {}
): ClockAlternativesResult {
    const logger = options.logger ?? defaultLogger;
    let current_step = "Planned + belt pickup slack";
    let completed = 0;
    let total: number | null = null;
    const report = (detail?: string) => options.on_progress?.({ step: current_step, detail, completed, total });
    const copies = config.target_output.copies ?? 1;

    report();
    const plan = planClockAlternatives(config, { ...options, on_progress_detail: report });
    completed++;
    total = 1 + plan.tasks.length;

    const runs: (ClockAlternativeRun | null)[] = [plan.primary];
    const stable_by_id = new Map<string, boolean>();
    const known_stable = (id: string) => stable_by_id.get(id);
    const definitions = alternativeDefinitions(config, plan.context, quietOptions(options, logger, report), known_stable);
    for (const definition of definitions) {
        current_step = definition.label;
        report();
        const run = runAlternative(definition, copies, logger);
        completed++;
        runs.push(run);
        if (run) {
            stable_by_id.set(definition.id, run.alternatives[0].is_stable);
        }
    }

    current_step = "Done";
    report();
    return combineClockAlternativeRuns(runs, it => it.is_stable, it => it.inserter_window_count);
}

/** A book with the modulo-clock and the full-window blueprint when both exist, otherwise the single blueprint */
export function blueprintFileFor(result: BlueprintGenerationResult): FactorioBlueprintFile {
    if (!result.modulo_blueprint) {
        return { blueprint: result.blueprint };
    }
    const book = new BlueprintBookBuilder()
        .setLabel(result.blueprint.label)
        .addBlueprint(result.modulo_blueprint)
        .addBlueprint(result.blueprint)
        .setActiveIndex(0)
        .build();
    return {
        blueprint_book: {
            ...book,
            description: "Same clock windows, two ways: the modulo clock checks windows that repeat every few cycles "
                + "against the clock modulo that length (far fewer decider conditions); the other lists every window on the raw clock.",
        },
    };
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
    relative_tick_provider: TickProvider
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
    });

    // Add machine state transition plugins
    simulation_context.machines.forEach(it => {
        it.addPlugin(new MachineStateTransitionTrackerPlugin(
            it.machine_state.entity_id,
            relative_tick_provider,
            machine_transition_callback
        ));
    });

    // Add drill state transition plugins
    simulation_context.drills.forEach(it => {
        it.addPlugin(new DrillStateTransitionTrackerPlugin(
            it.drill_state.entity_id,
            relative_tick_provider,
            drill_transition_callback
        ));
    });

    return state_transition_history;
}
