import assert from "../common/assert";
import { Config } from '../config';
import { EnableControlOverrideConfig, EnableControlRange } from '../config/schema';
import { assertInserterCoverage } from '../config/inserter-coverage-validator';
import { DebugPluginFactory } from './sequence/debug/debug-plugin-factory';
import { DebugSettingsProvider, MutableDebugSettingsProvider } from './sequence/debug/debug-settings-provider';
import { cloneSimulationContextWithInterceptors, SimulationContext } from './sequence/simulation-context';
import { Duration, OpenRange } from '../data-types';
import { assertIsMachine, Entity, Inserter, Machine, ReadableEntityRegistry } from '../entities';
import { TargetProductionRate } from "./target-production-rate";
import { EntityState, InserterStatus, MachineState, MachineStatus } from "../state";
import Fraction, { fraction } from "fractionability";
import { createSignalPerInserterBlueprint, SubtickClock } from "./blueprint";
import { FactorioBlueprint } from "../blueprints/blueprint";
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

export interface AsBuiltStabilityCheck {
    /** Whether the blueprint's clock windows alone, without the simulator's inventory conditions, produce the expected output from every start phase tried */
    is_stable: boolean;
    /** Output of the first failing start phase, or of the unshifted clock when all pass */
    actual_output_items: number;
    /** Number of clock start phases simulated (stops at the first failure) */
    start_phases_checked: number;
    /** Clock offset of the first failing start phase */
    failed_start_offset?: number;
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
    crafting_cycle_plan: CraftingCyclePlan;
    simulation_duration: Duration;
    transfer_history: InventoryTransferHistory;
    /** Serializable transfer history for UI visualization */
    serializable_transfer_history: SerializableTransferHistory;
    /** Serializable state transition history for UI visualization */
    serializable_state_transition_history: SerializableStateTransitionHistory;
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
    /** With derive_clock_windows: "prefer_planned" keeps planned windows that pass the as-built check (default), "always" derives anyway */
    derive_mode?: "prefer_planned" | "always";
    /** Replace the output inserters' windows with evenly spaced single swings timed to find a full hand ready */
    full_hand_output?: boolean;
    /** Start warmup with the output machines still output blocked, so the clock has to drain the surplus */
    keep_output_buffers?: boolean;
    /** Warmup length in simulation periods (default 10) */
    warmup_periods?: number;
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

    // Compute crafting cycle plan
    const target_production_rate = TargetProductionRate.fromConfig(config.target_output);

    // Find all output machines (machines that produce the target output item)
    const output_machine_state_machines = simulation_context.machines.filter(
        it => it.machine_state.machine.output.item_name === target_production_rate.machine_production_rate.item
    );
    assert(
        output_machine_state_machines.length > 0,
        `No machine with output item ${target_production_rate.machine_production_rate.item} found`
    );
    
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

    logger.log("All machines are output blocked.");
    simulation_context.machines.forEach(it => {
        MachineState.print(it.machine_state, logger);
    });

    const swing_counts = crafting_cycle_plan.entity_transfer_map;
    EntityTransferCountMap.print(swing_counts, logger);

    const ignored_ingredients = config.overrides?.ignored_lcm_ingredients;
    const computed_lcm = EntityTransferCountMap.lcm(swing_counts, ignored_ingredients);
    const recipe_lcm = config.overrides?.lcm ?? computed_lcm;
    logger.log(`Simulation context ingredient LCM: ${recipe_lcm}`);
    const serializable_transfer_plan = EntityTransferCountMap.serialize(swing_counts, ignored_ingredients);

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

    // Create automatic enable control factory
    const enable_control_factory = new EnableControlFactory(
        simulation_context.state_registry,
        crafting_cycle_plan,
        relative_tick_provider,
        resettable_registry,
        logger
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

    const warmup_period: Duration = Duration.ofTicks(crafting_cycle_plan.total_duration.ticks * recipe_lcm * (options.warmup_periods ?? 10));
    const duration: Duration = Duration.ofTicks(crafting_cycle_plan.total_duration.ticks * recipe_lcm);

    assert(warmup_period.ticks < MAX_SIMULATION_TICKS, `Warmup period of ${warmup_period.ticks} ticks exceeds maximum allowed ${MAX_SIMULATION_TICKS} ticks`);
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
    
    const simulate_step = new SimulateStep(new_simulation_context, duration);
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
    const final_history = trimmed_history;

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

    const stability_check: SimulationStabilityCheck = {
        is_stable: Math.abs(total_actual_output - total_expected_output) <= LCM_STABILITY_TOLERANCE,
        actual_output_items: total_actual_output,
        expected_output_items: total_expected_output,
        used_lcm: recipe_lcm,
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
            os.inserter.metadata.stack_size < output_machine_state_machines[index].machine_state.machine.output.outputBlock.quantity);
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
            planned_windows = full_hand;
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
    const blueprintForWindows = (windows: Map<string, OpenRange[]>, subtick_clock?: SubtickClock): FactorioBlueprint => createSignalPerInserterBlueprint(
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
        subtick_clock
    );
    const subtick_clock = subtickClockForPeriod(duration.ticks);
    const subtickClockFor = (windows: Map<string, OpenRange[]>) => subtick_clock
        ? { clock: subtick_clock, blueprint: blueprintForWindows(windows, subtick_clock) }
        : undefined;

    if (config.overrides?.derive_clock_windows) {
        const planned_stable = stability_check.is_stable;
        const non_deriving_config: Config = { ...config, overrides: { ...config.overrides, derive_clock_windows: false } };
        let planned_check = runAsBuiltCheck(non_deriving_config, planned_windows, duration.ticks, logger, AS_BUILT_START_PHASES,
            (n, total) => options.on_progress_detail?.(`Checking planned windows, clock start ${n}/${total}`)).check;
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

        const derived = deriveClockWindows(config, final_history, output_inserter_ids, belt_pickup_slack, duration.ticks, logger, options.on_progress_detail);
        const report: DerivedClockWindowsReport = {
            succeeded: derived.windows !== null,
            kept_planned_windows: false,
            end_padding_ticks: derived.end_padding_ticks,
        };
        stability_check.as_built = derived.as_built ?? undefined;
        stability_check.is_stable = stability_check.is_stable && derived.windows !== null;

        if (derived.windows !== null && derived.verification !== null) {
            return {
                ...derived.verification,
                blueprint: blueprintForWindows(derived.windows),
                subtick: subtickClockFor(derived.windows),
                clock_windows: serializeClockWindows(derived.windows),
                belt_pickup_slack_ticks: Object.fromEntries(belt_pickup_slack),
                crafting_cycle_plan,
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
        stability_check.as_built = runAsBuiltCheck(config, planned_windows, duration.ticks, logger, AS_BUILT_START_PHASES,
            (n, total) => options.on_progress_detail?.(`Checking clock-only output, clock start ${n}/${total}`)).check;
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
            duration.ticks
        );

        // Create serializable state transition history for UI visualization
        const serializable_state_transition_history = serializeStateTransitionHistory(
            state_transition_history,
            simulation_context.entity_registry,
            duration.ticks
        );

        return {
            blueprint,
            subtick: subtickClockFor(planned_windows),
            clock_windows: serializeClockWindows(planned_windows),
            belt_pickup_slack_ticks: Object.fromEntries(belt_pickup_slack),
            crafting_cycle_plan,
            simulation_duration: duration,
            transfer_history: final_history,
            serializable_transfer_history,
            serializable_state_transition_history,
            used_lcm: recipe_lcm,
            used_terminal_swing_count,
            stability_check,
            serializable_transfer_plan,
            computed_lcm,
        };
    }
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
    logger: { log: () => { }, warn: () => { }, error: logger.error.bind(logger), debug: () => { } },
    verify_as_built: false,
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
        }
    }

    const best = attempts.reduce((a, b) => b.check.actual_output_items > a.check.actual_output_items ? b : a);
    return { windows: null, end_padding_ticks: null, verification: best.result, as_built: best.check, even_output_windows };
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
 * in one grab.
 */
function fullHandOutputWindows(
    config: Config,
    windows: Map<string, OpenRange[]>,
    output_swings: Map<string, number>,
    output_machine_ids: Set<string>,
    period: number,
    logger: Logger,
    report?: (detail: string) => void,
): Map<string, OpenRange[]> | null {
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
    logger.log(`Full-hand output: planned output windows take ${planned.pickups} grabs for ${planned.swings} hands`);
    if (extra_grabs < FULL_HAND_MIN_EXTRA_GRABS_PER_HAND) {
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
    const confirm = (candidate: Candidate): Map<string, OpenRange[]> | null => {
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
            (n, of) => report?.(`Confirming full-hand output (${label}), clock start ${n}/${of}`)).check;
        logger.log(`Full-hand output: ${label}, ${timing.output_full} output-full ticks, ${timing.slow} slow pickups, stable=${full.is_stable}`);
        return full.is_stable ? candidate_windows : null;
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
            if (attempts < FULL_HAND_MAX_CONFIRM_ATTEMPTS) {
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
    for (const [key, ranges] of decider_windows) {
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
 * Backoff can be suppressed by setting `config.overrides.disable_swing_backoff = true`.
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

    const backoff_disabled = config.overrides?.disable_swing_backoff === true;

    if (initial_result.stability_check.is_stable || backoff_disabled || initial_swing_count <= 1) {
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
    const lowerSwings = (lower: number, extra: GenerateClockOptions) => generateClockForConfig(
        { ...base_config, overrides: { ...base_config.overrides, terminal_swing_count: lower } }, extra);
    const lower_counts = Array.from({ length: Math.max(0, swings - 1) }, (_, i) => swings - 1 - i);

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
                + "one per craft, so there are usually more windows than Planned.",
            run: () => generateClockWithSwingBackoff(
                { ...config, overrides: { ...config.overrides, derive_clock_windows: true } },
                { ...quiet, derive_mode: "always" }
            ),
        }]),
        ...lower_counts.map(lower => ({
            id: `swings-${lower}`,
            label: `${lower} output swing${lower === 1 ? "" : "s"} per cycle`,
            description: `Planned windows with the output inserter limited to ${lower} swing${lower === 1 ? "" : "s"} per crafting cycle `
                + `instead of ${swings}. The output machine buffers more between swings; useful when the higher swing count `
                + "is unstable.",
            run: () => lowerSwings(lower, quiet),
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
                    known_stable(`swings-${lower}`) ?? alternativeIsStable(lowerSwings(lower, { ...quiet, on_progress_detail: undefined })));
                return stable_lower === undefined
                    ? generateClockWithSwingBackoff(base_config, full_hand)
                    : lowerSwings(stable_lower, full_hand);
            },
        },
    ];
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
    const description = definition.description + planning_note;
    logger.log(`Clock alternative "${label}": windows=${inserter_window_count} stable=${is_stable} as-built=${as_built?.actual_output_items}/${expected_output_items} planned=${actual_output_items}`);
    const period = result.simulation_duration.ticks;
    const rateAt = (clock_period: number) => result.stability_check.expected_output_items * 60 / clock_period * copies;
    if (!result.subtick) {
        return { signature, alternatives: [{ id, label, description, inserter_window_count, is_stable, items_per_second: rateAt(period), result }] };
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
        
        const machine_max_swings = fraction(output_crafted).divide(inserter.metadata.stack_size);
        
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
