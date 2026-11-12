/**
 * The values of the browser exports that need neither the simulation, the game data nor zod: the enum-like
 * constants, the status categories, the clock ranking, the lane facts of a config (a lane's capacity from the engine's
 * belt speeds, its role from the items the caller says each inserter carries), the other clock that a clock's checked lanes
 * name in "what changes it" and fp-ts's Option.
 *
 * A page that runs the generator in a web worker can take its values on the main thread from here, and only types
 * from `browser.ts`, so the generator itself is bundled once, in the worker. The "light entry" test in
 * browser.test.ts keeps it small.
 */

export { ChestType, chestName } from "./common/entity-types";

export {
    EnableControlMode,
    EntityReference,
    ComparisonOperator,
    ValueReferenceType,
    RuleOperator,
    TargetType,
} from "./common/enable-control-types";

export { EntityType } from "./entities/entity-type";

export { machineCanMake, machineForRecipe, machineForRule } from "./entities/machine/machine-rule";

export { machineNameInText, machineNameOf } from "./crafting/machine-name";
export type { MachineToName, MachineWords } from "./crafting/machine-name";
export { beltNameInText, capitalized, chestNameInText, drillNameInText, entityNameOf, inserterNameInText, insertersInSentence, laneNameInText, lanesInSentence, NO_BUILD, theName } from "./crafting/entity-name";
export type { BuildToName, ItemWords, TextWords } from "./crafting/entity-name";
export type { CraftingMachineRuleFacts, NamedCraftingMachine } from "./entities/machine/machine-rule";
export { prototypeTraitsOf } from "./entities/traits/prototype-traits";
export type { CraftingMachineTraitFacts, PrototypeTraits } from "./entities/traits/prototype-traits";

export { InserterStatus, MachineStatus, DrillStatus } from "./state/entity-status";

export { expandStateTransitionHistory, factorioStatesOf, portableFromSerializable, toPortable, transitionsOf } from "./crafting/sequence/compact-history";
export type {
    CompactEntityStateTransitions,
    CompactStateTransitionHistory,
    PortableStateTransitionHistory,
} from "./crafting/sequence/compact-history";

export { StatusCategory, statusToCategory } from "./state/status-category";

export { combineClockAlternativeRuns, searchesAreNeeded, searchesToRun } from "./crafting/rank";

export { coordinatedSourcesInputOf } from "./crafting/candidates/coordinated-sources-parts";

export { whyNotStable, whyNotStableClockOf } from "./crafting/why-not-stable";

export { withOtherClocks } from "./crafting/other-clocks";

export { everyInputLaneIsDeadEnd, withEveryLaneEnd } from "./entities/traits/lane-ends";
export { beltLaneFactsOf } from "./entities/traits/lane-facts";
export type { BeltLaneFacts, FlowDirection, LaneEnd, LaneSharing } from "./entities/traits/lane-facts";
export { laneRolesOf } from "./entities/traits/lane-role";
export type { CarriedItemsOf, LaneRole, LaneRolesOfBuild } from "./entities/traits/lane-role";
export type { Ratio } from "./entities/traits/ratio";

export * as Option from "fp-ts/Option";

export { COPIES_DECIMAL_ERROR, isShortDecimalCopies } from "./config/copies-value";
export { fraction } from "./data-types/fraction";
export { migrateBeltSupplyOverrides } from "./config/migrate-belt-supply";
export { dropFractionalSwingsOverride } from "./config/migrate-fractional-swings";
export { renameLoopSeedItemsToKickStart } from "./config/migrate-kick-start";
export { renameTargetOutputToSetpoint } from "./config/migrate-setpoint";
export { neverOverrideEntitiesOf, readNeverOverridesInConfig, type NeverOverrideEntity } from "./config/migrate-never-override";
export { renameClockedPeriodInConfig } from "./config/migrate-window-cycle";
export { BLOCKED_SLOT_MARKERS } from "./config/migrate-blocked-slots";
export { migrateMiningProductivityLevel, PRODUCTIVITY_PER_MINING_LEVEL } from "./config/migrate-mining-productivity";

export { BELT_PICKUP_LAYOUTS, BELT_PICKUP_LAYOUT_LABELS, pickupLengthForLayout } from "./common/belt-pickup-layout";
export type { BeltPickupLayout } from "./common/belt-pickup-layout";

export type {
    CapacityGroup,
    ContainerNode,
    DrillNode,
    EdgeFloorFacts,
    EdgeFloorStanding,
    EdgeHandFacts,
    EdgePlannedFacts,
    EnergyFacts,
    FactsRatio,
    FactsStanding,
    InputLimitsFacts,
    InserterEdge,
    InserterLandsIn,
    LaneFacts,
    LaneNode,
    LoopFacts,
    MachineNode,
    NodeProductionFacts,
    OutputBlockFacts,
    PlacementEdge,
    PlacementFacts,
    PlacementLandsIn,
    PlannerEdge,
    PlannerFacts,
    PlannerNode,
    PlannerTarget,
    ProductionFacts,
    SpoilageFacts,
    StorageFacts,
    YieldFacts,
} from "./data-types/planner-facts";

export type {
    GraphComponent,
    GraphEdge,
    GraphEdgeVia,
    GraphNode,
    GraphNodeKind,
    GraphShared,
    PlannerGraph,
    SharedVertex,
    TerminalKind,
} from "./data-types/planner-graph";

export { catalogRowOf, routerRowOf, settingChipsOf, strategyRowOf } from "./crafting/strategy-catalog";
