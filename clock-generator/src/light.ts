/**
 * The values of the browser exports that need neither the simulation, the game data nor zod: the enum-like
 * constants, the status categories, the clock ranking and Option.
 *
 * A page that runs the generator in a web worker can take its values on the main thread from here, and only types
 * from `browser.ts`, so the generator itself is bundled once, in the worker. The "light entry" test in
 * browser.test.ts keeps it small.
 */

export { ChestType } from "./common/entity-types";

export {
    EnableControlMode,
    EntityReference,
    ComparisonOperator,
    ValueReferenceType,
    RuleOperator,
    TargetType,
} from "./common/enable-control-types";

export { EntityType } from "./entities/entity-type";

export { InserterStatus, MachineStatus, DrillStatus } from "./state/entity-status";

export { StatusCategory, statusToCategory } from "./state/status-category";

export { combineClockAlternativeRuns, searchesAreNeeded } from "./crafting/rank";

export { Option } from "./data-types/option";
