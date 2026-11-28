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

export { suggestedTargetOf } from './config/suggested-target';
export { CONFIG_FORMAT, configFormatProblem, withConfigFormat } from './config/format';
export type { ConfigFormatProblem } from './config/format';
export { readRecipeSetpointAsItem } from './config/setpoint-item';
export { refusalOfPick, refusalOfSetpoint } from './config/setpoint-check';
export { setpointOutputOf } from './data/setpoint-output';
export type { SuggestedTarget } from './config/suggested-target';
export * as Option from 'fp-ts/Option';

export {
    BeltPickupSinkError,
    BeltPickupSinkInserter,
    ConfigValidationError,
    ConfigValidationIssue,
    CopiesUnit,
    FeasibilityError,
    FeasibilityIssue,
    FeasibilityRule,
    FlowAcrossCopySpacingError,
    FlowAcrossCopySpacingIssue,
    InserterCoverageError,
    InserterCoverageIssue,
    InserterCoverageIssueKind,
    InserterFixOption,
    LaneCapacityError,
    LaneCapacityIssue,
    LaneRateError,
    LaneRateIssue,
    SharedLaneSupplyError,
    SharedLaneSupplyIssue,
} from './config/errors';

export { validateCopies, findRepeatedUnits } from './config/copies-validator';
export type { RepeatedUnits } from './config/copies-validator';
export { planRepeatedUnitConversion } from './config/repeated-unit-conversion';
export { withoutOutsideSupply } from './config/outside-supply';
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
export { insertersScopeProblem, beltPickupSinkRefusal } from './config/inserter-scope';
export { uncalibratedBeltPickups, beltPickupNotTestedNote } from './config/pickup-calibration';
export { laneCapacityIssues, lanesExactlyFull, lanesExactlyFullWarning, lanesSharedByCopies, laneSharedByCopiesWarning } from './config/lane-capacity-validator';
// the facts of each lane of a config, its end and its role among them, as the engine reads them
export { laneFactsOfConfig } from './entities/traits/build-traits';
export { copyGapNeededNote } from './config/drop-spacing';
export { dropRoomNote } from './crafting/drop-room-note';
export { sideLoadedDrops, sideLoadedDropWarning } from './config/side-loaded-drop';
export type { UncalibratedBeltPickup } from './config/pickup-calibration';
export { machinePrototypeIssues, machineRuleOf } from './config/machine-prototype';
export type { MachinePrototypeIssue } from './config/machine-prototype';

// ============================================================================
// Blueprint Generation
// ============================================================================

export type { ClockStrategy, StrategyId, StrategyRef } from "./crafting/clock-strategy";
export { catalogRowOf, routerRowOf, settingChipsOf, strategyRowOf } from "./crafting/strategy-catalog";
export type { StrategyCatalogRow, TuningMethod, Selection, EnableControlStrategyRouter, EnableControl, SourceControl, ClockRouting, ClockSettings, SettingChip, OutputCountSetting, WindowCycleSetting, SharedWindowsSetting, LoopsSetting, DrillWindowsSetting, BeltPickupSetting } from "./crafting/strategy-catalog";
export {
    generateClockForConfig,
    validateConfig,
    generateClockWithSwingBackoff,
    generateClockAlternatives,
    blueprintFileFor,
    planClockAlternatives,
    runClockAlternativeTask,
    runCoordinatedSourcesTask,
    COORDINATED_SOURCES_MAKER,
    runRegionLayerTask,
    REGION_LAYER_MAKER,
    regionLayerInputOf,
    regionLayerTaskOf,
    RegionLayerInput,
    CoordinatedSourcesInput,
    CoordinatedSourcesPart,
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
    AlwaysOnReason,
    AlwaysOnReasons,
} from './crafting/generate-blueprint';

export { combinatorLetters, CombinatorLetter, CombinatorGroups } from './crafting/combinator-letters';

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

// ============================================================================
// The import of a pasted blueprint
// ============================================================================

export { importBlueprint, isPleaseCheck, NOTE_CODES, SHARING_ANSWERS, READ_KINDS } from './import';
export type {
    DropLane,
    DropPosition,
    ImportBuild,
    ImportEntity,
    ImportInputs,
    ImportList,
    ImportLayout,
    ImportNote,
    ImportOutcome,
    ImportProblem,
    ImportQuestion,
    ImportResearch,
    ImportSpeed,
    LayoutDrill,
    LayoutHeldBack,
    LayoutInserterLines,
    LayoutLine,
    LayoutPiece,
    NoteCode,
    OutputLine,
    QuestionKind,
    ReadKind,
} from './import';

// ============================================================================
// Research on a build
// ============================================================================

export { ResearchBlockSchema } from './config/research-block';
export type { ResearchBase, ResearchBlock, ResearchBonuses } from './config/research-block';
export { applyResearch, researchDifferences } from './import/apply-research';
export type {
    OutsideReason,
    ResearchBuild,
    ResearchChoice,
    ResearchDifferences,
    ResearchEdit,
    ResearchKind,
    ResearchOutside,
} from './import/apply-research';

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
    chestName,
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
    CompactEntityStateTransitions,
    CompactStateTransitionHistory,
    PortableStateTransitionHistory,
    expandStateTransitionHistory,
    factorioStatesOf,
    portableFromSerializable,
    toPortable,
    transitionsOf,
} from './crafting/sequence/compact-history';

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
    SerializableMachineOutput,
    SerializableMachineInput,
} from './data-types';

export { Machine } from './entities/machine';
export { computeMachineFacts } from './entities/traits/machine-facts-of';
export type { ComputeMachineFactsParams } from './entities/traits/machine-facts-of';
export { computeMachineTargetRates } from './crafting/machine-target-rates';
export type { MachineTargetRate } from './crafting/machine-target-rates';
export { targetRateMaxOf } from './crafting/feasibility/max-rate';
export type { TargetRateMax } from './crafting/feasibility/max-rate';
export type { ClockInsight, MachineFactsEntry, SwingComparison } from './crafting/insights';
export type { DisturbanceTrialVerdict, TrialCount } from './crafting/disturbance-trial';
export type { OscillationFacts, OutputReason } from './crafting/long-run';
export { whyNotStable, whyNotStableClockOf } from './crafting/why-not-stable';
export type { NotMadeClock, SpareTime, WhyNotStable, WhyNotStableBuild, WhyNotStableCause, WhyNotStableClock } from './crafting/why-not-stable';
export { buildLanesOf, withOtherClocks } from './crafting/checked-lanes';
export type { BuildLane, CausePart, CheckedLaneRow, CheckedLanes, CheckedLaneState, CheckedLine, CopyMissed, LaneEndGivenBy, LaneNotCheckedReason, LaneTogether, MissedInWindowCycle, MissedSwingCause, MissedSwings, SharedLaneCause, SharedLaneReason, SharedLaneReasonCode } from './crafting/checked-lanes';
export { deadlockRiskNote } from './crafting/deadlock-risk';
export { machineNameInText, machineNameOf } from './crafting/machine-name';
export type { MachineToName, MachineWords } from './crafting/machine-name';
export { beltNameInText, capitalized, chestNameInText, drillNameInText, entityNameOf, inserterNameInText, insertersInSentence, laneNameInText, lanesInSentence, NO_BUILD, textWords, theName } from './crafting/entity-name';
export type { BuildToName, ItemWords, TextWords } from './crafting/entity-name';
export { buildToNameOf, entityNamesInSentence } from './crafting/build-names';
export type { SharedItemDeadlockRisk } from './crafting/deadlock-risk';
export { DEFAULT_KICK_START_ITEMS } from './crafting/runner/cold-start';


export { regionOrbitsOfConfig } from "./crafting/graph/regions";
export type { FoundOrbit } from "./crafting/graph/regions";

export { deriveOutputTransfers } from "./config/output-transfer";
export type { OutputTransferTarget, OutputTransferResult, OutputTransferSummary } from "./config/output-transfer";
export { outputTransferGenerationIssues, assertOutputTransferGenerationSupported } from "./config/output-transfer-generation";
export type { OutputTransferGenerationIssue } from "./config/output-transfer-generation";

export type { SetpointRate } from "./config/setpoint-rate";
