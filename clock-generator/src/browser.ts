/**
 * Browser-compatible exports for clock-generator.
 * 
 * This module provides all the necessary exports for using clock-generator
 * in a browser environment, including React applications.
 */

// ============================================================================
// Config Types and Loader
// ============================================================================

export {
    Config,
    ParsedConfig,
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
    // Enable Control Types
    EnableControlOverrideConfig,
    EnableControlRange,
    RuleSet,
    Condition,
    ValueReference,
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
export { suggestedTargetOf } from './config/suggested-target';
export type { SuggestedTarget } from './config/suggested-target';
export { ImportPipeline } from './config/import-pipeline';
export type { ImportInput, ImportStep, ImportedMachine } from './config/import-pipeline';
export { Option } from './data-types/option';

export {
    ConfigValidationError,
    ConfigValidationIssue,
    CopiesError,
    CopiesUnit,
    InserterCoverageError,
    InserterCoverageIssue,
    InserterCoverageIssueKind,
    InserterFixOption,
} from './config/errors';

export { validateCopies, findRepeatedUnits } from './config/copies-validator';
export type { RepeatedUnits } from './config/copies-validator';
export { planRepeatedUnitConversion } from './config/repeated-unit-conversion';
export { AssertionError } from './common/assert';
export type {
    ConversionEntityKind, RetainedConversionEntity, RetainedConversionEntities,
    RepeatedUnitConversionReasonCode, RepeatedUnitConversionReason,
    RepeatedUnitConversionPlan, RepeatedUnitConversionResult,
} from './config/repeated-unit-conversion';

export {
    validateInserterCoverage,
    createInserterCoverageValidator,
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
    searchesAreNeeded,
    clockBeltLabel,
    BlueprintGenerationResult,
    ClockAlternative,
    ClockBelt,
    ClockAlternativesResult,
    ClockAlternativeRun,
    ClockRanking,
    rankingOf,
    ClockAssessment,
    ClockVerdict,
    clockVerdictOf,
    ClockAlternativeContext,
    ClockAlternativeTask,
    ClockAlternativesPlan,
    GenerationProgress,
    AsBuiltStabilityCheck,
    ClockOnlyRun,
    FuelConsumptionView,
    SearchReport,
    SearchCandidate,
    SearchRangeEdge,
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
} from './blueprints/serde-browser';

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

export { recordSimulationTimeline } from './crafting/record-timeline';
export type { RecordTimelineRequest } from './crafting/record-timeline';
export type { TimelineRecording, TimelineEntity, TimelineEvent, TimelineSeries, TimelineValue } from './crafting/timeline-recording';

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
    SerializableFactorioState,
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
    MachineStatus,
    DrillStatus,
} from './state/entity-status';

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
export { computeMachineTargetRates } from './crafting/machine-target-rates';
export type { MachineTargetRate } from './crafting/machine-target-rates';
export type { ClockInsight, MachineFactsEntry, SwingComparison } from './crafting/insights';
export type { BackpressureLossVerdict } from './crafting/backpressure-loss';
export { deadlockRiskNote } from './crafting/deadlock-risk';
export type { SharedItemDeadlockRisk } from './crafting/deadlock-risk';
export { DEFAULT_LOOP_SEED_ITEMS } from './crafting/runner/cold-start';

export { sidecarPickupInserters } from "./config/pickup-capture";
