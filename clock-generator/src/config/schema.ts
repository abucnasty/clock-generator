import { BELT_PICKUP_LAYOUTS, pickupLayoutProblem } from "../common/belt-pickup-layout";
import { BeltPickupCaptureSchema, normalizePickupCaptureConfig, pickupCaptureProblem } from "./pickup-capture";
import { sideLoadedPickupRefusal } from "./errors";
import { z } from "zod";
import { MiningDrillType, BeltType, BeltStrategy, ChestType } from "../common/entity-types";
import {
    EnableControlMode,
    EntityReference,
    ComparisonOperator,
    ValueReferenceType,
    RuleOperator,
    TargetType,
} from "../common/enable-control-types";
import { MachineStatus } from "../state/entity-status";
import { MachineType } from "../entities";
import { COPIES_DECIMAL_ERROR, isShortDecimalCopies } from "./copies-value";
import { migrateBeltSupplyOverrides } from "./migrate-belt-supply";
import { migrateBlockedSlotFilter } from "./migrate-blocked-slots";
import { migrateMiningProductivityLevelStep } from "./migrate-mining-productivity";

// ============================================================================
// Machine Configuration
// ============================================================================

/**
 * Where an entity stands in the game, as the sidecar reads it (tile centres are at .5). Kept for tools: no engine
 * decision reads it, and copies of a build differ in it.
 */
const MapPositionSchema = z.object({ x: z.number(), y: z.number() });

/** The direction an entity faces, one of the game's 16 (0 north, 4 east, 8 south, 12 west). Kept for tools, as its position */
const DirectionSchema = z.number().int().min(0).max(15);

/** The qualities of the game, for the fields that name one */
const MachineQualitySchema = z.enum(["normal", "uncommon", "rare", "epic", "legendary"]);

export const MachineConfigurationSchema = z.object({
    id: z.number().int().positive(),
    recipe: z.string(),
    productivity: z.number().min(0),
    crafting_speed: z.number().positive(),
    /**
     * The simulation rule (MachineType): "machine" the crafting rule, "furnace" the furnace rule, "biochamber" the crafting
     * rule burning nutrients. Without it the rule is the prototype's (machine-prototype.ts), else "machine". With both, a
     * type other than the prototype's rule is used as written and warned about.
     */
    type: z.enum(Object.values(MachineType)).optional(),
    energy_consumption_bonus: z.number().min(-80).optional(),
    fuel: z.string().optional(),
    /**
     * The machine's prototype name in the game data ("electric-furnace", "assembling-machine-3"), which the clock's
     * descriptions show as its icon; without it they name the machine by its id. Its game data gives the machine's rule
     * when `type` is not set, and the recipes it can make (a recipe it cannot make is warned about); its speed and
     * productivity come from `crafting_speed` and `productivity` alone. Sidecar 0.12.0 exports it.
     */
    prototype: z.string().optional(),
    /**
     * The machine's quality, which its crafting speed already counts; kept for labels, it changes nothing the engine
     * simulates. Sidecar 0.12.0 exports it.
     */
    quality: MachineQualitySchema.optional(),
    /** The quality of the recipe the machine is set to; kept for labels. Sidecar 0.12.0 exports it. */
    recipe_quality: MachineQualitySchema.optional(),
    /** Where the machine stands (MapPositionSchema). Sidecar 0.12.0 exports it. */
    position: MapPositionSchema.optional(),
});

export type MachineConfiguration = z.infer<typeof MachineConfigurationSchema>;

// ============================================================================
// Target Production Rate Configuration
// ============================================================================

/**
 * Schema for target production rate configuration.
 * 
 * @property recipe - The recipe name to produce
 * @property items_per_second - Target production rate in items per second
 * @property copies - How many identical units the build holds side by side. The config describes ONE unit, and the
 *   generator plans that unit and multiplies the output rate by `copies`. It is a positive number and may be
 *   fractional, such as 5.5: the build then holds a partial block, and its rate is planned as that fraction of one
 *   block's (5.5 copies of a block of 4 machines that make 240 a second make 480/11 a second per block). The unit
 *   itself is still whole. The number is read as an exact fraction, so it must be a whole number or a short decimal
 *   (a denominator of at most 1000 once reduced); 1/3 written as 0.3333333333333333 is refused. This assumes:
 *   - the units are identical: the same machines, recipes, crafting speeds, productivity, inserters, filters, stack
 *     sizes and chests;
 *   - no inserter joins one unit to another: machine-to-machine and machine-to-chest-to-machine inserters stay
 *     inside a unit;
 *   - the belts are shared between the units: every unit takes from and drops onto the same belt lanes.
 *   A config that itself holds several identical units (copies of one unit side by side, each with its own inserters)
 *   is refused with a CopiesError: describe one unit and set `copies` to the number of units instead.
 */
export const TargetProductionRateConfigSchema = z.object({
    recipe: z.string(),
    items_per_second: z.number().positive(),
    copies: z.number().positive().refine(isShortDecimalCopies, {
        message: COPIES_DECIMAL_ERROR,
    })
});

export type TargetProductionRateConfig = z.infer<typeof TargetProductionRateConfigSchema>;

// ============================================================================
// Enable Control Override Configuration
// ============================================================================

export { EnableControlMode };

/**
 * Range for clocked enable control.
 */
export const EnableControlRangeSchema = z.object({
    start: z.number().int().min(0),
    end: z.number().int().positive()
});

export type EnableControlRange = z.infer<typeof EnableControlRangeSchema>;

/**
 * Base schema for enable control override with mode discriminator.
 */
const EnableControlOverrideAutoSchema = z.object({
    mode: z.literal(EnableControlMode.AUTO)
});

const EnableControlOverrideAlwaysSchema = z.object({
    mode: z.literal(EnableControlMode.ALWAYS)
});

const EnableControlOverrideNeverSchema = z.object({
    mode: z.literal(EnableControlMode.NEVER)
});

const EnableControlOverrideClockedSchema = z.object({
    mode: z.literal(EnableControlMode.CLOCKED),
    ranges: z.array(EnableControlRangeSchema).min(1),
    period_duration_ticks: z.number().int().positive().optional(),
    /**
     * Where the decider of these windows stands in the order the clock's deciders are built, 0 the first: set by the
     * check of an exported clock, which builds them in the order of its blueprint. Of two inserters whose windows open
     * in the same tick the game updates the one whose decider was built last first. Where it is left out on either
     * of two such inserters, the one that waits for the other's take goes a tick after it, the later of the two ticks
     * the game can have.
     */
    decider_build_order: z.number().int().nonnegative().optional(),
    /**
     * Ticks of circuit latency the ranges carry: set by the check of an exported clock, which moves the windows of its
     * deciders by the latency. A clock of the game counts from its start, so in that many ticks after it starts no
     * window has reached an inserter yet. Left out, nothing is dark at the start.
     */
    latency_ticks: z.number().int().nonnegative().optional(),
});

// ============================================================================
// Conditional Enable Control Configuration
// ============================================================================

const EntityReferenceSchema = z.enum([EntityReference.SOURCE, EntityReference.SINK]);
export { EntityReference };

const ComparisonOperatorSchema = z.enum([
    ComparisonOperator.GREATER_THAN,
    ComparisonOperator.LESS_THAN,
    ComparisonOperator.GREATER_THAN_OR_EQUAL,
    ComparisonOperator.LESS_THAN_OR_EQUAL,
    ComparisonOperator.EQUAL,
    ComparisonOperator.NOT_EQUAL,
]);
export { ComparisonOperator };

const ValueReferenceConstantSchema = z.object({
    type: z.literal(ValueReferenceType.CONSTANT),
    value: z.number()
});

const ValueReferenceInventoryItemSchema = z.object({
    type: z.literal(ValueReferenceType.INVENTORY_ITEM),
    entity: EntityReferenceSchema,
    item_name: z.string()
});

const ValueReferenceAutomatedInsertionLimitSchema = z.object({
    type: z.literal(ValueReferenceType.AUTOMATED_INSERTION_LIMIT),
    entity: EntityReferenceSchema,
    item_name: z.string()
});

const ValueReferenceOutputBlockSchema = z.object({
    type: z.literal(ValueReferenceType.OUTPUT_BLOCK),
    entity: EntityReferenceSchema
});

const ValueReferenceCraftingProgressSchema = z.object({
    type: z.literal(ValueReferenceType.CRAFTING_PROGRESS),
    entity: EntityReferenceSchema
});

const ValueReferenceBonusProgressSchema = z.object({
    type: z.literal(ValueReferenceType.BONUS_PROGRESS),
    entity: EntityReferenceSchema
});

const ValueReferenceHandQuantitySchema = z.object({
    type: z.literal(ValueReferenceType.HAND_QUANTITY),
    item_name: z.string().optional()
});

const ValueReferenceMachineStatusSchema = z.object({
    type: z.literal(ValueReferenceType.MACHINE_STATUS),
    entity: EntityReferenceSchema,
    status: z.enum([
        MachineStatus.INGREDIENT_SHORTAGE,
        MachineStatus.WORKING,
        MachineStatus.OUTPUT_FULL,
        MachineStatus.NO_FUEL,
    ])
});

const ValueReferenceInserterStackSizeSchema = z.object({
    type: z.literal(ValueReferenceType.INSERTER_STACK_SIZE)
});

export { ValueReferenceType };

export const ValueReferenceSchema = z.discriminatedUnion("type", [
    ValueReferenceConstantSchema,
    ValueReferenceInventoryItemSchema,
    ValueReferenceAutomatedInsertionLimitSchema,
    ValueReferenceOutputBlockSchema,
    ValueReferenceCraftingProgressSchema,
    ValueReferenceBonusProgressSchema,
    ValueReferenceHandQuantitySchema,
    ValueReferenceMachineStatusSchema,
    ValueReferenceInserterStackSizeSchema
]);

export type ValueReference = z.infer<typeof ValueReferenceSchema>;

export const ConditionSchema = z.object({
    left: ValueReferenceSchema,
    operator: ComparisonOperatorSchema,
    right: ValueReferenceSchema
});

export type Condition = z.infer<typeof ConditionSchema>;

const RuleOperatorSchema = z.enum([RuleOperator.AND, RuleOperator.OR]);
export { RuleOperator };

interface RuleSetType {
    operator: RuleOperator;
    rules: (Condition | RuleSetType)[];
}

export const RuleSetSchema: z.ZodType<RuleSetType> = z.lazy(() =>
    z.object({
        operator: RuleOperatorSchema,
        rules: z.array(z.union([ConditionSchema, RuleSetSchema])).min(1)
    })
);

export type RuleSet = z.infer<typeof RuleSetSchema>;

const LatchConfigSchema = z.object({
    release: RuleSetSchema
});

const EnableControlOverrideConditionalSchema = z.object({
    mode: z.literal(EnableControlMode.CONDITIONAL),
    rule_set: RuleSetSchema,
    latch: LatchConfigSchema.optional()
});

export type EnableControlOverrideConditional = z.infer<typeof EnableControlOverrideConditionalSchema>;

export const EnableControlOverrideConfigSchema = z.discriminatedUnion("mode", [
    EnableControlOverrideAutoSchema,
    EnableControlOverrideAlwaysSchema,
    EnableControlOverrideNeverSchema,
    EnableControlOverrideClockedSchema,
    EnableControlOverrideConditionalSchema
]);

export type EnableControlOverrideConfig = z.infer<typeof EnableControlOverrideConfigSchema>;

// ============================================================================
// Mining Drill Configuration
// ============================================================================

const MiningDrillTypeSchema = z.enum([
    MiningDrillType.ELECTRIC_MINING_DRILL,
    MiningDrillType.BURNER_MINING_DRILL,
    MiningDrillType.BIG_MINING_DRILL
]);

const DrillTargetMachineConfigSchema = z.object({
    type: z.literal(TargetType.MACHINE),
    id: z.number().int().positive()
});

/** A chest of any type the drill drops into, by its rules: slots and room, weight and routing for a silo */
const DrillTargetChestConfigSchema = z.object({
    type: z.literal(TargetType.CHEST),
    id: z.number().int().positive()
});

const DrillTargetConfigSchema = z.discriminatedUnion("type", [DrillTargetMachineConfigSchema, DrillTargetChestConfigSchema]);

/**
 * Overrides configuration for mining drills.
 */
const MiningDrillOverridesConfigSchema = z.object({
    enable_control: EnableControlOverrideConfigSchema.optional(),
    /**
     * For a drill into a chest on the windows the generator makes for it (no enable control, or AUTO): ticks each window
     * starts earlier than the fewest that keep the chest's takers supplied. The generator tries 1 when a clock does not
     * hold with the fewest.
     */
    extra_window_ticks: z.number().int().min(0).optional()
});

export const MiningDrillConfigSchema = z.object({
    id: z.number().int().positive(),
    type: MiningDrillTypeSchema,
    mined_item_name: z.string(),
    /**
     * The speed bonus can be obtained by hovering over the drill and typing:
     * `/c game.print(game.player.selected.speed_bonus)`
     */
    speed_bonus: z.number(),
    /**
     * The drill's mining productivity in percent, as a machine's: the force's mining productivity research and the
     * drill's productivity modules together, as the game gives it and its bonus bar uses it (not capped). The sidecar
     * exports it; the game shows it with: `/c game.print(game.player.selected.productivity_bonus * 100)`
     */
    productivity: z.number().min(0),
    target: DrillTargetConfigSchema,
    overrides: MiningDrillOverridesConfigSchema.optional(),
    /** Where the drill stands and the way it faces (MapPositionSchema, DirectionSchema). Sidecar 0.12.0 exports them. */
    position: MapPositionSchema.optional(),
    direction: DirectionSchema.optional(),
});

export type MiningDrillConfig = z.infer<typeof MiningDrillConfigSchema>;

/** The mining drills. A config with the former `mining_productivity_level` is read as each drill's productivity once. */
export const DrillsConfigSchema = z.preprocess(migrateMiningProductivityLevelStep, z.object({
    configs: z.array(MiningDrillConfigSchema)
}));

// ============================================================================
// Inserter Configuration
// ============================================================================

/**
 * Where an inserter drops on a belt that moves, for the simulator to time the drop by the stacks that are on the lane
 * (clock-generator/docs/simulator.md, "A stack inserter on a moving lane").
 */
const InserterBeltDropConfigSchema = z.object({
    /**
     * The lane the inserter drops on, by its place in the belt's `lanes`, 1 or 2 (the left lane in the direction of
     * travel first). It is 1 when the belt lists one lane, even when the inserter drops on the right lane of the belt.
     */
    lane: z.union([z.literal(1), z.literal(2)]),
    /**
     * Tiles along the belt's path, increasing in the direction the belt runs. The origin is free but the same for
     * every inserter that drops on the belt, and a position may be negative or a fraction: only the distances
     * between them count.
     */
    position: z.number()
});

/**
 * A field only a side-loaded pickup has. Side-loaded pickups are out of scope, so the field is kept only to refuse a
 * config that names it: without it the schema would drop the field and read the pickup as a plain belt.
 */
const sideLoadedPickupField = (field: string) => z.custom<never>(() => false, { error: sideLoadedPickupRefusal(field) }).optional();

const InserterBeltSourceConfigSchema = z.object({
    type: z.literal(TargetType.BELT),
    id: z.number().int().positive(),
    /**
     * Preferred pickup lane, by its place in the belt's `lanes`, 1 or 2 (left in travel direction first).
     * This is the nearest lane beside a belt, or the lane selected by mirroring at a front underground exit.
     * The inserter takes from that lane first when its sink takes the items of both, as in the game.
     * Without it the inserter takes its items in the
     * order of its `filters`, or of the sink's ingredients when it has none, which may not be what the build does.
     */
    near_lane: z.union([z.literal(1), z.literal(2)]).optional(),
    /** Exposed pickup line in tiles: 1 on a straight belt (default), 0.5 at either underground endpoint.
     * Geometry is independent of the moving/backed-up supply setting (backed_up_belts).
     */
    pickup_length: z.union([z.literal(0.5), z.literal(1)]).default(1),
    /** Physical approach and endpoint; required for manual underground pickups. */
    pickup_layout: z.enum(BELT_PICKUP_LAYOUTS).optional(),
    /** Refused: side-loaded pickups, by one stream or two merging, are out of scope */
    pickup_supply: sideLoadedPickupField("pickup_supply"),
    /** Refused: side-loaded pickups, by one stream or two merging, are out of scope */
    pickup_merge: sideLoadedPickupField("pickup_merge"),
    /** Persistent capture provenance; absent on manual configurations. */
    pickup_capture: BeltPickupCaptureSchema.optional(),
    /** Refused: only an inserter's sink has a drop spot (see the checks of ConfigSchema) */
    drop: InserterBeltDropConfigSchema.optional()
});

const InserterBeltSinkConfigSchema = z.object({
    type: z.literal(TargetType.BELT),
    id: z.number().int().positive(),
    /**
     * Where the inserter drops on a shared lane. Omitted positions use independent local output tiles with
     * retained stock. It is all or none per belt: when any inserter that drops on a belt has it, every one must.
     */
    drop: InserterBeltDropConfigSchema.optional()
});

const InserterMachineConfigSchema = z.object({
    type: z.literal(TargetType.MACHINE),
    id: z.number().int().positive()
});

const InserterChestConfigSchema = z.object({
    type: z.literal(TargetType.CHEST),
    id: z.number().int().positive()
});

export { TargetType };

export const InserterAnimationOverrideConfigSchema = z.object({
    pickup_duration_ticks: z.number().int().positive().optional()
});

export type InserterAnimationOverrideConfig = z.infer<typeof InserterAnimationOverrideConfigSchema>;

/**
 * Overrides configuration for inserters.
 * Contains animation overrides and enable control overrides.
 */
const InserterOverridesConfigSchema = z.object({
    animation: InserterAnimationOverrideConfigSchema.optional(),
    enable_control: EnableControlOverrideConfigSchema.optional()
});

export const InserterConfigSchema = z.object({
    id: z.number().int().positive().optional(),
    source: z.discriminatedUnion("type", [
        InserterBeltSourceConfigSchema,
        InserterMachineConfigSchema,
        InserterChestConfigSchema
    ]),
    sink: z.discriminatedUnion("type", [
        InserterBeltSinkConfigSchema,
        InserterMachineConfigSchema,
        InserterChestConfigSchema
    ]),
    /**
     * The inserter's prototype name in the game data: "inserter", "fast-inserter", "long-handed-inserter",
     * "bulk-inserter" or "stack-inserter" (default). The burner inserter needs fuel and is refused. The prototype sets
     * how long a swing takes, with the quality, and how many items the hand holds, with the research. Only the
     * legendary stack inserter may pick up from a belt: belt pickup timing is calibrated on it alone (follow-up F7).
     */
    prototype: z.string().optional(),
    /** The inserter's quality (default "legendary"); the higher it is, the faster the arm turns. It does not change the hand. */
    quality: z.enum(["normal", "uncommon", "rare", "epic", "legendary"]).optional(),
    /**
     * Items in the hand. Without it the hand is what all the research gives the prototype (16 for a stack inserter, 12
     * for a bulk inserter, 4 for the others); with it, it overrides that, as when a technology is not researched.
     */
    stack_size: z.number().int().positive().optional(),
    filters: z.array(z.string()).optional(),
    /**
     * How the game reads `filters`: "whitelist" (default), the items the inserter moves. "blacklist", the items it
     * leaves, is refused when there are filters: the generator models a whitelist only. Kept so that a captured
     * blacklist is refused rather than stripped and read as the items to move.
     */
    filter_mode: z.enum(["whitelist", "blacklist"]).optional(),
    overrides: InserterOverridesConfigSchema.optional(),
    /** Where the inserter stands and the way it faces (MapPositionSchema, DirectionSchema). Sidecar 0.12.0 exports them. */
    position: MapPositionSchema.optional(),
    direction: DirectionSchema.optional(),
});

/** Input may omit pickup length; schema parsing and entity construction both resolve it to 1. */
export type InserterConfig = Omit<z.infer<typeof InserterConfigSchema>, "source"> & {
    source: z.input<typeof InserterConfigSchema>["source"];
};

// ============================================================================
// Belt Configuration
// ============================================================================

const BeltTypeSchema = z.enum([
    BeltType.TRANSPORT_BELT,
    BeltType.FAST_TRANSPORT_BELT,
    BeltType.EXPRESS_TRANSPORT_BELT,
    BeltType.TURBO_TRANSPORT_BELT
]);

const BeltLaneConfigSchema = z.object({
    ingredient: z.string(),
    stack_size: z.number().int().positive(),
});

const ExportBeltLaneConfigSchema = BeltLaneConfigSchema.extend({
    /** Items per second taken off this lane by consumers outside the config */
    consumption_per_second: z.number().positive().optional(),
});

const NormalBeltConfigSchema = z.object({
    id: z.number().int().positive(),
    type: BeltTypeSchema,
    strategy: z.literal(BeltStrategy.NORMAL).optional(),
    lanes: z.union([
        z.tuple([BeltLaneConfigSchema]),
        z.tuple([BeltLaneConfigSchema, BeltLaneConfigSchema])
    ])
});

const ExportBeltConfigSchema = z.object({
    id: z.number().int().positive(),
    type: BeltTypeSchema,
    strategy: z.literal(BeltStrategy.EXPORT),
    lanes: z.union([
        z.tuple([ExportBeltLaneConfigSchema]),
        z.tuple([ExportBeltLaneConfigSchema, ExportBeltLaneConfigSchema])
    ])
});

export const BeltConfigSchema = z.union([NormalBeltConfigSchema, ExportBeltConfigSchema]);

export type BeltConfig = z.infer<typeof BeltConfigSchema>;

// ============================================================================
// Chest Configuration
// ============================================================================

export const BufferChestConfigSchema = z.object({
    type: z.literal(ChestType.BUFFER_CHEST),

    id: z.number().int().positive(),
    storage_size: z.number().int().positive(),
    /**
     * The single item type this chest is filtered to hold.
     * Chests only support one item type for simplicity.
     */
    item_filter: z.string(),
    /** The chest's prototype name in the game data ("steel-chest"), which the clock's descriptions show as its icon; without it they name it by its id. Sidecar 0.12.0 exports it. */
    prototype: z.string().optional(),
    /** Where the chest stands (MapPositionSchema). Sidecar 0.12.0 exports it. */
    position: MapPositionSchema.optional(),
});

export type BufferChestConfig = z.infer<typeof BufferChestConfigSchema>;


export const InfinityFilterConfigSchema = z.object({
    /**
     * The entity name of the item to request
     */
    item_name: z.string().min(1),
    /**
     * The count of items to request from the infinity chest each time.
     */
    request_count: z.number().int().nonnegative()
});

export type InfinityFilterConfig = z.infer<typeof InfinityFilterConfigSchema>;
/**
 * Constant supplies and optional disposal of unfiltered incoming items.
 * 
 * This can be a requester chest, an infinity chest, a buffer chest, etc.
 * 
 * It can also be used to mock an input to a machine that is always available.
 */
export const InfinityChestConfigSchema = z.object({
    type: z.literal(ChestType.INFINITY_CHEST),
    id: z.number().int().positive(),
    item_filter: z.array(InfinityFilterConfigSchema).default([]),
    /** Remove incoming items that are not configured supplies. Omitted in legacy builds. */
    remove_unfiltered_items: z.boolean().optional(),
    /** Where the chest stands (MapPositionSchema). Sidecar 0.12.0 exports it. */
    position: MapPositionSchema.optional(),
});

export type InfinityChestConfig = z.infer<typeof InfinityChestConfigSchema>;

const QualityNameSchema = z.enum(["normal", "uncommon", "rare", "epic", "legendary"]);

/** `storage_size` on a chest whose slots come from the game data: refused, not read as an override */
const storageSizeRefused = z.custom<never>(() => false, {
    error: "`storage_size` is refused on a car, a tank, a cargo wagon or a rocket silo: their slots come from the game "
        + "data (a cargo wagon's by its `quality`)",
}).optional();

const BOTH_IN_SLOT_FILTER = "a slot filter names an item or is `blocked: true`, not both";

/** A slot that takes one item only, or none at all; a filter named as no-item or deconstruction-planner is read as blocked */
const SlotFilterConfigSchema = z.preprocess(migrateBlockedSlotFilter, z.union([
    z.object({
        /** The slot, from 1 */
        slot: z.number().int().positive(),
        /** The only item the slot takes */
        item: z.string().min(1),
        blocked: z.never({ error: BOTH_IN_SLOT_FILTER }).optional(),
    }),
    z.object({
        /** The slot, from 1 */
        slot: z.number().int().positive(),
        /** The slot takes no item, as with the game's no-item or deconstruction planner filter */
        blocked: z.literal(true),
        item: z.never({ error: BOTH_IN_SLOT_FILTER }).optional(),
    }),
]));

export const SlotContentConfigSchema = z.object({
    /** The slot, from 1 */
    slot: z.number().int().positive(),
    item: z.string().min(1),
    /** At most the item's stack size */
    count: z.number().int().positive(),
});

export type SlotContentConfig = z.infer<typeof SlotContentConfigSchema>;

const slotContainerFields = {
    id: z.number().int().positive(),
    /** Slots that take one item only, or none when blocked; the other slots take any item */
    slot_filters: z.array(SlotFilterConfigSchema).optional(),
    /** What the container holds when the build starts, slot by slot; empty without it */
    contents: z.array(SlotContentConfigSchema).optional(),
    storage_size: storageSizeRefused,
    /** Where it stands (MapPositionSchema). Sidecar 0.12.0 exports it. */
    position: MapPositionSchema.optional(),
};

/** A car as a chest: the slots of its trunk, from the game data */
export const CarConfigSchema = z.object({ type: z.literal(ChestType.CAR), ...slotContainerFields });
/** A tank as a chest: the slots of its trunk, from the game data */
export const TankConfigSchema = z.object({ type: z.literal(ChestType.TANK), ...slotContainerFields });
/** A cargo wagon standing still, as a chest: its slots from the game data and its quality */
export const CargoWagonConfigSchema = z.object({
    type: z.literal(ChestType.CARGO_WAGON),
    ...slotContainerFields,
    /** The wagon's quality (default "normal"), which sets its slots */
    quality: QualityNameSchema.optional(),
});

export type CarConfig = z.infer<typeof CarConfigSchema>;
export type TankConfig = z.infer<typeof TankConfigSchema>;
export type CargoWagonConfig = z.infer<typeof CargoWagonConfigSchema>;
export type SlotContainerConfig = CarConfig | TankConfig | CargoWagonConfig;

export const ItemCountConfigSchema = z.object({
    item: z.string().min(1),
    count: z.number().int().positive(),
});

/**
 * A rocket silo as a chest. It takes any item into its rocket inventory, as far as the rocket lifts its weight, and its
 * recipe's ingredients into its input slots, up to the automated insertion limit. No craft is run.
 */
export const RocketSiloConfigSchema = z.object({
    type: z.literal(ChestType.ROCKET_SILO),
    id: z.number().int().positive(),
    /**
     * The quality of its rocket part recipe (default "normal"). Of any other quality, the ingredients the build brings
     * (all of normal quality) go into the rocket inventory instead of the input slots.
     */
    recipe_quality: QualityNameSchema.optional(),
    /** Its crafting speed with modules and beacons (default the game data's, 1), which sets the insertion limit */
    crafting_speed: z.number().positive().optional(),
    /** Its productivity; no craft is run, so it changes nothing yet */
    productivity: z.number().min(0).optional(),
    /** What it holds when the build starts, placed as an inserter would place it */
    contents: z.array(ItemCountConfigSchema).optional(),
    storage_size: storageSizeRefused,
    /** Where it stands (MapPositionSchema). Sidecar 0.12.0 exports it. */
    position: MapPositionSchema.optional(),
});

export type RocketSiloConfig = z.infer<typeof RocketSiloConfigSchema>;

export const ChestConfigSchema = z.discriminatedUnion("type", [
    BufferChestConfigSchema,
    InfinityChestConfigSchema,
    CarConfigSchema,
    TankConfigSchema,
    CargoWagonConfigSchema,
    RocketSiloConfigSchema,
]);

export type ChestConfig = z.infer<typeof ChestConfigSchema>;

// ============================================================================
// Config Overrides
// ============================================================================

export const ConfigOverridesSchema = z.preprocess(migrateBeltSupplyOverrides, z.object({
    lcm: z.number().int().positive().optional(),
    /**
     * Forces the number of output swings per crafting cycle. Without it the generator picks the count and lowers it
     * until the output is stable.
     */
    terminal_swing_count: z.number().int().positive().optional(),
    /**
     * Enable fractional swing support for inserters.
     * 
     * When enabled, inserters with fractional swing counts (e.g., 3/2 swings per cycle)
     * will have their cycles extended to distribute swings across multiple sub-cycles.
     * For example, 3/2 swings becomes 1 swing in the first sub-cycle and 2 swings in the second.
     * 
     * The swing distribution uses a back-loaded strategy to maximize items available
     * before swinging, while respecting automated_insertion_limit constraints.
     * 
     * @default false
     */
    use_fractional_swings: z.boolean().optional(),
    /**
     * Input supply is backed up at the pickup: items stop between grabs and upstream supply refills the gaps,
     * so one stack is available each eligible pickup tick. Geometry is retained independently of this rule.
     *
     * A clock is made for a moving belt by default: each window of an inserter that picks up from a belt stays open
     * a few ticks longer (belt pickup slack), and a clock without it is only selected when no clock with it holds the
     * target rate. When enabled, a clock is made without the slack and the one with the fewest wake-ups is selected.
     * A clock that does not hold the expected output without the slack is listed as unstable.
     *
     * @default false
     */
    backed_up_belts: z.boolean().optional(),
    /**
     * Run the four searches for every build: observed windows, uneven output swings, shifted swings and full-hand
     * output swings. They take most of the time of a generation.
     *
     * By default they only run when no clock made without a search can be selected as stable. Where one can, a
     * search may still find a stable clock with fewer wake-ups; when enabled, the searches run for that too.
     *
     * @default false
     */
    search_for_fewer_wake_ups: z.boolean().optional(),
    /**
     * Try every clock from other starts than the plain cold start of the staged scaffold too: with the clock standing 30,
     * 300, 700 and 1000 ticks into its period at the first tick, and with the inserters that compete for one machine's
     * product served in ascending config ids and in two random orders. The clock is stable when it reaches its target
     * from every start, start-dependent when it does from some, unstable when it does from none; a start-dependent
     * clock is listed with where it reaches its target and where it settles elsewhere.
     *
     * By default every clock is judged from the cold start alone, and the generator says that start dependence was
     * not checked. Takes a few more long runs of every clock.
     *
     * @default false
     */
    check_start_dependence: z.boolean().optional(),
    /**
     * Items of its own product a machine whose recipe makes its own ingredient (pentapod eggs) is given once when a clock
     * starts on the staged scaffold: the loop cannot start itself, so the scaffold's machines are seeded by hand.
     *
     * @default 200
     */
    loop_seed_items: z.number().int().nonnegative().optional(),
    /**
     * @deprecated Ignored. Set terminal_swing_count to force an output swing count instead; other counts are
     * offered as potential clocks.
     */
    disable_swing_backoff: z.boolean().optional(),
    /**
     * Derive every non-output inserter's clock window from how it behaves when only the output
     * inserters are clocked, then verify the result with a clock-only (as-built) simulation.
     * Replaces the heuristic window trimming; the result is marked unstable when no padding passes.
     * 
     * @default false
     */
    derive_clock_windows: z.boolean().optional(),
    /**
     * Item names to exclude from the LCM calculation.
     * 
     * Inserters that exclusively transfer items in this list will not contribute
     * their transfer fractions to the LCM computation, reducing the overall LCM.
     * Any such inserter should be set to ALWAYS enabled so it runs every cycle
     * regardless of the clock period.
     */
    ignored_lcm_ingredients: z.array(z.string()).optional()
}));

export type ConfigOverrides = z.infer<typeof ConfigOverridesSchema>;

// ============================================================================
// Root Config
// ============================================================================

export const ConfigSchema = z.preprocess(normalizePickupCaptureConfig, z.object({
    target_output: TargetProductionRateConfigSchema,
    machines: z.array(MachineConfigurationSchema),
    drills: DrillsConfigSchema.optional(),
    inserters: z.array(InserterConfigSchema),
    belts: z.array(BeltConfigSchema),
    chests: z.array(ChestConfigSchema).optional(),
    overrides: ConfigOverridesSchema.optional()
}).superRefine((config, context) => {
    config.inserters.forEach((inserter, index) => {
        if (inserter.source.type === TargetType.BELT && !inserter.source.pickup_capture) {
            const problem = pickupLayoutProblem(inserter.source);
            if (problem) context.addIssue({code: "custom", path: ["inserters", index, "source", "pickup_layout"], message: problem});
        }
        if (inserter.source.type === TargetType.BELT && inserter.source.pickup_capture?.status === "supported") {
            const problem = pickupCaptureProblem(inserter.source);
            if (problem) context.addIssue({code: "custom", path: ["inserters", index, "source", "pickup_capture"], message: problem});
        }
        if (inserter.source.type === TargetType.BELT && inserter.source.drop !== undefined) {
            context.addIssue({
                code: "custom",
                path: ["inserters", index, "source", "drop"],
                message: "`drop` is the spot an inserter drops on a belt: it belongs on the sink, not on the source"
            });
        }
    });
    config.chests?.forEach((chest, index) => {
        if (chest.type === ChestType.INFINITY_CHEST && !chest.item_filter.length && !chest.remove_unfiltered_items
            && config.inserters.some(inserter => inserter.sink.type === TargetType.CHEST && inserter.sink.id === chest.id)) {
            context.addIssue({ code: "custom", path: ["chests", index, "item_filter"], params: { editable_chest_settings: true },
                message: `Chest ${chest.id}: enable Remove unfiltered items to use an empty infinity chest as an output, or configure a filter.` });
        }
    });
    config.drills?.configs.forEach((drill, index) => {
        if (drill.target.type !== TargetType.CHEST) return;
        const chest_id = drill.target.id;
        if (!config.chests?.some(chest => chest.id === chest_id)) {
            context.addIssue({ code: "custom", path: ["drills", "configs", index, "target", "id"],
                message: `Drill ${drill.id} drops into chest ${chest_id}, which is not in the config` });
        }
        // a drill into a chest is on the windows the generator makes for it (AUTO), on its own (CLOCKED) or always on;
        // a condition needs an inserter's hand to read, and a drill that never runs fills nothing
        const mode = drill.overrides?.enable_control?.mode;
        if (mode === EnableControlMode.CONDITIONAL || mode === EnableControlMode.NEVER) {
            context.addIssue({ code: "custom", path: ["drills", "configs", index, "overrides", "enable_control"],
                message: `Drill ${drill.id} drops into a chest; its enable control can be AUTO, CLOCKED or ALWAYS, not ${mode}` });
        }
    });
    // a drop spot is all or none per belt: the lane rule needs every stack on it
    const dropping = config.inserters.flatMap((inserter, index) =>
        inserter.sink.type === TargetType.BELT ? [{ inserter, index, sink: inserter.sink }] : []);
    for (const belt_id of new Set(dropping.map(it => it.sink.id))) {
        const on_belt = dropping.filter(it => it.sink.id === belt_id);
        const without = on_belt.filter(it => it.sink.drop === undefined);
        if (without.length === on_belt.length || without.length === 0) {
            continue;
        }
        const names = without.map(it => it.inserter.id !== undefined ? String(it.inserter.id) : `at index ${it.index}`);
        context.addIssue({
            code: "custom",
            path: ["inserters", without[0].index, "sink", "drop"],
            message: `Belt ${belt_id}: inserter ${names.join(", ")} drop(s) on it without \`drop\`, while others have it; ` +
                "give every inserter that drops on a belt a `drop` (lane and position), or none"
        });
    }
}));

/** Parsed configs have explicit pickup geometry on every belt source. */
export type ParsedConfig = z.infer<typeof ConfigSchema>;
/** Public engine inputs also accept inserters whose pickup length uses the straight-belt default. */
export type Config = Omit<ParsedConfig, "inserters"> & { inserters: InserterConfig[] };
