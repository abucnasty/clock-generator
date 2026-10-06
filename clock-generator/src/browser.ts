/**
 * Browser-compatible exports for clock-generator.
 * 
 * This module provides all the necessary exports for using clock-generator
 * in a browser environment, including React applications.
 * 
 * Note: HOCON parsing is NOT available in the browser. Use JSON format instead.
 */

// ============================================================================
// Config Types and Loader
// ============================================================================

export {
    Config,
    ConfigSchema,
    TargetProductionRateConfigSchema,
    MachineConfigurationSchema,
    DrillsConfigSchema,
    MiningDrillConfigSchema,
    InserterConfigSchema,
    BeltConfigSchema,
    ChestConfigSchema,
    BufferChestConfigSchema,
    InfinityChestConfigSchema,
    ConfigOverridesSchema,
    // Enable Control Enums
    EnableControlMode,
    EntityReference,
    ComparisonOperator,
    ValueReferenceType,
    RuleOperator,
    TargetType,
} from './config/schema';

export {
    parseConfigFromObject,
    parseConfigFromObjectSafe,
    parseConfigFromJson,
    parseConfigFromJsonSafe,
    ConfigParseResult,
} from './config/config-browser';

export {
    LATEST_SIDECAR_VERSION,
    SIDECAR_VERSION_WITH_ENERGY_CONSUMPTION,
    SIDECAR_FEATURES,
    SIDECAR_IMPORT_PIPELINE,
    compareVersions,
    checkSidecarImport,
    sidecarFeatureStep,
} from './config/sidecar-version';
export type { SidecarFeature } from './config/sidecar-version';
export { ImportPipeline } from './config/import-pipeline';
export type { ImportInput, ImportStep, ImportedMachine } from './config/import-pipeline';
export { Option } from './data-types/option';

export {
    ConfigValidationError,
    ConfigValidationIssue,
    InserterCoverageError,
    InserterCoverageIssue,
    InserterCoverageIssueKind,
    InserterFixOption,
} from './config/errors';

export {
    validateInserterCoverage,
    assertInserterCoverage,
} from './config/inserter-coverage-validator';

// ============================================================================
// Blueprint Generation
// ============================================================================

export {
    generateClockForConfig,
    validateConfig,
    generateClockWithSwingBackoff,
    generateClockAlternatives,
    blueprintFileFor,
    planClockAlternatives,
    runClockAlternativeTask,
    combineClockAlternativeRuns,
    BlueprintGenerationResult,
    ClockAlternative,
    ClockAlternativesResult,
    ClockAlternativeRun,
    ClockAlternativeContext,
    ClockAlternativeTask,
    ClockAlternativesPlan,
    GenerationProgress,
    AsBuiltStabilityCheck,
    ClockOnlyRun,
    FuelConsumptionView,
    CheckedShift,
    CheckedShiftRow,
    ShiftRangeEdge,
    ShiftedSwings,
    ConfigValidation,
    SerializableClockWindows,
    GenerateClockOptions,
    DebugSteps,
    SimulationStabilityCheck,
    SwingAttemptResult,
    SwingBackoffReport,
} from './crafting/generate-blueprint';

export {
    FuelPlan,
    FuelMachinePlan,
    FuelInserterPlan,
    FuelLevelSeries,
} from './crafting/fuel-view';

export {
    SerializableTransferPlan,
    SerializableEntityTransferCount,
    SerializableItemTransfer,
} from './crafting/sequence/cycle/swing-counts';

export {
    encodeBlueprintFileBrowser,
    decodeBlueprintFileBrowser,
} from './blueprints/serde';

export {
    FactorioBlueprint,
    FactorioBlueprintFile,
} from './blueprints/blueprint';

// ============================================================================
// Factorio Data Service
// ============================================================================

export {
    FactorioDataService,
    EnrichedRecipe,
    EnrichedIngredient,
} from './data/factorio-data-service';

export {
    FactorioData,
    Recipe,
    Item,
    Ingredient,
    ItemName,
    RecipeName,
    ResourceName,
    Resource,
    MiningDrillSpec,
} from './data/factorio-data-types';

// ============================================================================
// Debug and Logging
// ============================================================================

export {
    DebugSettingsProvider,
    MutableDebugSettingsProvider,
} from './crafting/sequence/debug/debug-settings-provider';

export {
    Logger,
    ConsoleLogger,
    CollectingLogger,
    StreamingLogger,
    CompositeLogger,
    LogMessage,
    defaultLogger,
} from './common/logger';

// ============================================================================
// Runner Step Types (for debug step configuration)
// ============================================================================

export {
    RunnerStepType,
} from './crafting/runner/steps/runner-step';

// ============================================================================
// Common Types
// ============================================================================

export {
    Duration,
} from './data-types';

// Belt, Chest, and Mining Drill Types
export {
    BeltType,
    BeltStrategy,
    ChestType,
    MiningDrillType,
} from './common/entity-types';

// ============================================================================
// Transfer History (for visualization)
// ============================================================================

export {
    SerializableTransferHistory,
    SerializableTransferEntry,
    SerializableEntityTransferHistory,
    serializeTransferHistory,
} from './crafting/sequence/transfer-history-serializer';

// ============================================================================
// State Transition History (for visualization)
// ============================================================================

export {
    SerializableStateTransitionHistory,
    SerializableEntityStateTransitions,
    SerializableStateTransition,
    serializeStateTransitionHistory,
} from './crafting/sequence/state-transition-serializer';

export {
    StateTransitionEntityType,
    EntityStatus,
} from './crafting/sequence/state-transition-history';

// ============================================================================
// Status Types and Categories
// ============================================================================

export {
    InserterStatus,
} from './state/inserter-state';

export {
    MachineStatus,
} from './state/machine-state';

export {
    DrillStatus,
} from './state/drill-state';

export {
    StatusCategory,
    statusToCategory,
    getAllStatusCategories,
} from './state/status-category';

// ============================================================================
// Entity Types and Categories
// ============================================================================

export {
    EntityType,
} from './entities/entity-type';

// ============================================================================
// Machine Facts (for on-the-fly computation in UI)
// ============================================================================

export {
    SerializableMachineFacts,
    SerializableMachineInput,
} from './data-types';

export {
    Machine,
    ComputeMachineFactsParams,
} from './entities/machine';
export type { ClockInsight, MachineFactsEntry } from './crafting/insights';
