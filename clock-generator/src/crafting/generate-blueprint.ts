import assert from "../common/assert";
import { Config } from '../config';
import { assertInserterCoverage } from '../config/inserter-coverage-validator';
import { DebugPluginFactory } from './sequence/debug/debug-plugin-factory';
import { DebugSettingsProvider, MutableDebugSettingsProvider } from './sequence/debug/debug-settings-provider';
import { cloneSimulationContextWithInterceptors, SimulationContext } from './sequence/simulation-context';
import { Duration } from '../data-types';
import { assertIsMachine, Inserter, Machine, ReadableEntityRegistry } from '../entities';
import { TargetProductionRate } from "./target-production-rate";
import { EntityState, MachineState } from "../state";
import Fraction, { fraction } from "fractionability";
import { createSignalPerInserterBlueprint } from "./blueprint";
import { FactorioBlueprint } from "../blueprints/blueprint";
import { ResettableRegistry, TickProvider } from "../control-logic";
import { EntityTransferCountMap } from "./sequence/cycle/swing-counts";
import { InventoryTransferHistory } from "./sequence/inventory-transfer-history";
import { InserterInventoryHistoryPlugin } from "../control-logic/inserter/plugins/inserter-inventory-transfer-plugin";
import { DrillInventoryTransferPlugin } from "../control-logic/drill/plugins/drill-inventory-transfer-plugin";
import { EnableControlFactory } from "./sequence/interceptors/inserter-enable-control-factory";
import { ConfigurableEnableControlFactory, EntityEnableControlOverrideMap } from "./sequence/interceptors/configurable-enable-control-factory";
import { CraftingCyclePlan } from "./sequence/cycle/crafting-cycle";
import { PrepareStep } from "./runner/steps/prepare-step";
import { WarmupStep } from "./runner/steps/warmup-step";
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

export interface BlueprintGenerationResult {
    blueprint: FactorioBlueprint;
    crafting_cycle_plan: CraftingCyclePlan;
    simulation_duration: Duration;
    transfer_history: InventoryTransferHistory;
    /** Serializable transfer history for UI visualization */
    serializable_transfer_history: SerializableTransferHistory;
    /** Serializable state transition history for UI visualization */
    serializable_state_transition_history: SerializableStateTransitionHistory;
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
        .forEach(Machine.printMachineFacts);

    let relative_tick = 0;

    const relative_tick_provider = TickProvider.offset({
        base: simulation_context.tick_provider,
        offset: () => -1 * relative_tick
    });

    // Configure plugins
    configureDebugPlugins(simulation_context, relative_tick_provider, debug);
    const inventory_transfer_history = configureInventoryTransferPlugins(simulation_context, relative_tick_provider);
    const state_transition_history = configureStateTransitionPlugins(simulation_context, relative_tick_provider);

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
    output_machine_state_machines.forEach(machine_sm => {
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

    const recipe_lcm = config.overrides?.lcm ?? EntityTransferCountMap.lcm(swing_counts);
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

    const warmup_period: Duration = Duration.ofTicks(crafting_cycle_plan.total_duration.ticks * recipe_lcm * 10);
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
    
    const warmup_step = new WarmupStep(new_simulation_context, warmup_period);
    warmup_step.execute();
    
    debug.disable();

    // Step 3: Simulate
    logger.log(`Starting simulation for ${duration.ticks} ticks`);
    logger.log("Executing Simulate Step");
    inventory_transfer_history.clear();
    state_transition_history.clear();
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

    // Create blueprint - use target output item name (same for all output machines)
    const target_output_item_name = target_production_rate.machine_production_rate.item;
    const blueprint = createSignalPerInserterBlueprint(
        target_output_item_name,
        crafting_cycle_plan,
        duration,
        InventoryTransferHistory.removeDuplicateEntities(final_history),
        simulation_context.entity_registry
    );

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
        crafting_cycle_plan,
        simulation_duration: duration,
        transfer_history: final_history,
        serializable_transfer_history,
        serializable_state_transition_history,
    };
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
        const entity_id = `inserter:${index + 1}`; // 1-based index with type prefix
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
