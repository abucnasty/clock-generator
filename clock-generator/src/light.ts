/**
 * The values of the browser exports that need neither the simulation, the game data nor zod: the enum-like
 * constants, the status categories, the clock ranking and Option.
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

export { MachineType } from "./entities/machine/machine-type";
export { machineRuleOfPrototype, machineCanMake, machineForRecipe, machineForRule, placesResultsItself } from "./entities/machine/machine-rule";
export type { CraftingMachineRuleFacts, NamedCraftingMachine } from "./entities/machine/machine-rule";

export { InserterStatus, MachineStatus, DrillStatus } from "./state/entity-status";

export { expandStateTransitionHistory, factorioStatesOf, portableFromSerializable, toPortable, transitionsOf } from "./crafting/sequence/compact-history";
export type {
    CompactEntityStateTransitions,
    CompactStateTransitionHistory,
    PortableStateTransitionHistory,
} from "./crafting/sequence/compact-history";

export { StatusCategory, statusToCategory } from "./state/status-category";

export { combineClockAlternativeRuns, searchesAreNeeded } from "./crafting/rank";

export { whyNotStable, whyNotStableClockOf } from "./crafting/why-not-stable";

export { Option } from "./data-types/option";

export { COPIES_DECIMAL_ERROR, isShortDecimalCopies } from "./config/copies-value";
export { fraction } from "./data-types/fraction";
export { migrateBeltSupplyOverrides } from "./config/migrate-belt-supply";
export { BLOCKED_SLOT_MARKERS } from "./config/migrate-blocked-slots";
export { migrateMiningProductivityLevel, PRODUCTIVITY_PER_MINING_LEVEL } from "./config/migrate-mining-productivity";

export { BELT_PICKUP_LAYOUTS, BELT_PICKUP_LAYOUT_LABELS, pickupLengthForLayout } from "./common/belt-pickup-layout";
export type { BeltPickupLayout } from "./common/belt-pickup-layout";
