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
import { COPIES_DECIMAL_ERROR, isShortDecimalCopies } from "./copies-value";
import { migrateBeltSupplyOverrides } from "./migrate-belt-supply";
import { dropFractionalSwingsOverride } from "./migrate-fractional-swings";
import { renameLoopSeedItemsToKickStart } from "./migrate-kick-start";
import { renameTargetOutputToSetpoint } from "./migrate-setpoint";
import { readNeverOverrideAsAuto } from "./migrate-never-override";
import { renameClockedPeriodToWindowCycle } from "./migrate-window-cycle";
import { migrateBlockedSlotFilter } from "./migrate-blocked-slots";
import { migrateMiningProductivityLevelStep } from "./migrate-mining-productivity";
import { migrateMachineTypeStep } from "./migrate-machine-type";
import { FactorioDataService } from "../data/factorio-data-service";
import { machinePlacesResults } from "./machine-prototype";

/**
 * The results of a recipe that a rocket silo used as a machine's result target keeps in its input slots: those its fixed
 * recipe takes as ingredients, where that recipe is of normal quality, the quality of the build's items (recorded on a
 * recycler on scrap into a rocket silo, 2.1.21: processing units and low density structure filled its input slots to a
 * stack and 64, no inserter took them out, and the recycler stopped for good in 24 minutes; with the silo's recipe at
 * another quality every result went into its rocket inventory). None for any other container, from the game data.
 */
function resultsTrappedInSilo(recipe: string, chest: { type: string; recipe_quality?: string } | undefined): string[] {
    if (chest?.type !== ChestType.ROCKET_SILO) return [];
    const silo_recipe = FactorioDataService.findRecipeOrThrow(FactorioDataService.findRocketSiloOrThrow(chest.type).fixed_recipe);
    if (FactorioDataService.findQualityOrThrow(chest.recipe_quality ?? "normal").level !== 0) return [];
    const ingredients = new Set(silo_recipe.ingredients.map(ingredient => ingredient.name));
    let results: string[];
    try {
        results = FactorioDataService.findRecipeOrThrow(recipe).results.map(result => result.name);
    } catch {
        // an unknown recipe is refused where recipes are read
        return [];
    }
    return results.filter(name => ingredients.has(name));
}

// ============================================================================
// Machine Configuration
// ============================================================================

/**
 * Where an entity stands in the game, as the sidecar reads it (tile centres are at .5). Kept for tools: no engine
 * decision reads it, and copies of a build differ in it.
 */
const MapPositionSchema = z.object({ x: z.number().describe("The x coordinate, in tiles."), y: z.number().describe("The y coordinate, in tiles.") });

/** The direction an entity faces, one of the game's 16 (0 north, 4 east, 8 south, 12 west). Kept for tools, as its position */
const DirectionSchema = z.number().int().min(0).max(15);

/** The qualities of the game, for the fields that name one */
const MachineQualitySchema = z.enum(["normal", "uncommon", "rare", "epic", "legendary"]);

/**
 * A machine of the build. What it is is its `prototype`, whose game data gives the rule it is simulated under (a furnace
 * holds a stack of its product, a biochamber burns nutrients, any other crafting machine stops at its overload
 * multiplier; `entities/machine/machine-rule.ts`). That rule is internal: no config field names or sets it. The former
 * `type` field ("machine", "furnace", "biochamber") is read once, before the machine is checked, as the prototype of a
 * machine of that rule (`migrate-machine-type.ts`), and dropped when the machine names its prototype.
 */
export const MachineConfigurationSchema = z.preprocess(migrateMachineTypeStep, z.object({
    id: z.number().int().positive().describe("The number that identifies the machine in the configuration."),
    recipe: z.string().describe("The name of the recipe that the machine makes."),
    productivity: z.number().min(0).describe("The productivity bonus of the machine, in percent."),
    crafting_speed: z.number().positive().describe("The crafting speed of the machine, with its modules and beacons."),
    energy_consumption_bonus: z.number().min(-80).optional().describe("The change in energy consumption of the machine from modules and beacons, in percent."),
    fuel: z.string().optional().describe("The name of the fuel item that the machine burns."),
    /**
     * The machine's prototype name in the game data ("electric-furnace", "assembling-machine-3"): its game data gives the
     * rule it is simulated under and the recipes it can make (a recipe it cannot make is warned about), and the clock's
     * descriptions show it as its icon. Its speed and productivity come from `crafting_speed` and `productivity` alone.
     * A machine without one (or with one the data does not hold) is simulated as an assembling machine, and the
     * descriptions name it by its id. Sidecar 0.12.0 exports it.
     */
    prototype: z.string().optional().describe("The prototype name of the machine in the game data, for example \"assembling-machine-3\"."),
    /**
     * The machine's quality, which its crafting speed already counts; kept for labels, it changes nothing the engine
     * simulates. Sidecar 0.12.0 exports it.
     */
    quality: MachineQualitySchema.optional().describe("The quality of the machine, for labels only: the crafting speed already includes it."),
    /** The quality of the recipe the machine is set to; kept for labels. Sidecar 0.12.0 exports it. */
    recipe_quality: MachineQualitySchema.optional().describe("The quality of the recipe that the machine makes, for labels only."),
    /** Where the machine stands (MapPositionSchema). Sidecar 0.12.0 exports it. */
    position: MapPositionSchema.optional().describe("Where the machine is in the game, in tiles, from the sidecar."),
    /**
     * The machine or container a machine that places its results itself (a recycler, by its prototype's game data) puts them
     * into: the one that stands at its result spot, as a drill's `target`. Each tick the machine puts what waits in its
     * output into it as far as it has room. Only such a machine takes one; without it the machine keeps its results in
     * its output for inserters to take.
     */
    result_target: z.discriminatedUnion("type", [z.object({
        type: z.literal(TargetType.CHEST).describe("The entity that receives the results is a chest."),
        id: z.number().int().positive().describe("The id of the chest that receives the results."),
    }), z.object({
        type: z.literal(TargetType.MACHINE).describe("The entity that receives the results is a machine."),
        id: z.number().int().positive().describe("The id of the machine that receives the results."),
    })]).optional().describe("The machine or chest into which a machine that puts its own results, such as a recycler, puts them."),
}));

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
/** What a target's rate counts: the item made and taken out, or the item taken in and destroyed */
export const TARGET_COUNTS = ["made", "destroyed"] as const;
export type TargetCounts = typeof TARGET_COUNTS[number];

export const TargetProductionRateConfigSchema = z.object({
    recipe: z.string().describe("The name of the item that the setpoint counts."),
    items_per_second: z.number().positive().describe("The rate of the setpoint for all copies together, in items per second."),
    copies: z.number().positive().refine(isShortDecimalCopies, {
        message: COPIES_DECIMAL_ERROR,
    }).describe("The number of identical builds in the game, which can be partial, for example 2.25."),
    /**
     * Where the next copy stands from this one, in tiles and in the coordinates of the exported positions. It lets the
     * result check whether the copies' drops onto a shared belt fit between each other (config/drop-spacing.ts); nothing
     * else reads it. Omitted where it is not known.
     */
    copy_offset: MapPositionSchema.optional().describe("The distance from this build to the next copy, in tiles."),
    /**
     * What the rate counts. "made" (the default; every config before 0.24.0 has no `counts` and is read so): the item
     * `recipe` names is made by the build and taken out of it. "destroyed": the item is taken into the build from
     * outside it and destroyed there, by a machine that places its results itself (a recycler that voids ore); the rate
     * is what the inserters that bring it in from outside put into those machines, and what the machines give back of
     * it is not counted.
     */
    counts: z.enum(TARGET_COUNTS).optional().describe("What the rate counts: \"made\" (default) for items that the build makes, or \"destroyed\" for items that it destroys."),
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
    start: z.number().int().min(0).describe("The tick of the window cycle at which the enable window starts."),
    end: z.number().int().positive().describe("The tick of the window cycle at which the enable window ends.")
});

export type EnableControlRange = z.infer<typeof EnableControlRangeSchema>;

/**
 * Base schema for enable control override with mode discriminator.
 */
const EnableControlOverrideAutoSchema = z.object({
    mode: z.literal(EnableControlMode.AUTO).describe("AUTO: the generator makes the enable windows of the entity.")
});

const EnableControlOverrideAlwaysSchema = z.object({
    mode: z.literal(EnableControlMode.ALWAYS).describe("ALWAYS: the entity is always enabled.")
});

const EnableControlOverrideClockedSchema = z.object({
    mode: z.literal(EnableControlMode.CLOCKED).describe("CLOCKED: the entity is enabled during the enable windows that you give."),
    ranges: z.array(EnableControlRangeSchema).min(1).describe("The enable windows of the entity, as tick ranges of the window cycle."),
    window_cycle_ticks: z.number().int().positive().optional().describe("The window cycle time of these enable windows, in ticks; the default is the time of the planned output cycles."),
    /**
     * Where the decider of these windows stands in the order the clock's deciders are built, 0 the first: set by the
     * check of an exported clock, which builds them in the order of its blueprint. Of two inserters whose windows open
     * in the same tick the game updates the one whose decider was built last first. Where it is left out on either
     * of two such inserters, the one that waits for the other's take goes a tick after it, the later of the two ticks
     * the game can have.
     */
    decider_build_order: z.number().int().nonnegative().optional().describe("The position, from 0, of the decider combinator for these enable windows in the order of the clock's blueprint."),
    /**
     * Ticks of circuit latency the ranges carry: set by the check of an exported clock, which moves the windows of its
     * deciders by the latency. A clock of the game counts from its start, so in that many ticks after it starts no
     * window has reached an inserter yet. Left out, nothing is dark at the start.
     */
    latency_ticks: z.number().int().nonnegative().optional().describe("The circuit latency of these enable windows, in ticks."),
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
    type: z.literal(ValueReferenceType.CONSTANT).describe("CONSTANT: a fixed number."),
    value: z.number().describe("The number.")
});

const ValueReferenceInventoryItemSchema = z.object({
    type: z.literal(ValueReferenceType.INVENTORY_ITEM).describe("INVENTORY_ITEM: the count of an item in the source or sink."),
    entity: EntityReferenceSchema.describe("The end of the inserter that the value comes from: SOURCE or SINK."),
    item_name: z.string().describe("The name of the item to count.")
});

const ValueReferenceAutomatedInsertionLimitSchema = z.object({
    type: z.literal(ValueReferenceType.AUTOMATED_INSERTION_LIMIT).describe("AUTOMATED_INSERTION_LIMIT: the automated insertion limit of the source or sink for an item."),
    entity: EntityReferenceSchema.describe("The end of the inserter that the value comes from: SOURCE or SINK."),
    item_name: z.string().describe("The name of the item.")
});

const ValueReferenceOutputBlockSchema = z.object({
    type: z.literal(ValueReferenceType.OUTPUT_BLOCK).describe("OUTPUT_BLOCK: the count of items at which the output of the source or sink is full."),
    entity: EntityReferenceSchema.describe("The end of the inserter that the value comes from: SOURCE or SINK.")
});

const ValueReferenceCraftingProgressSchema = z.object({
    type: z.literal(ValueReferenceType.CRAFTING_PROGRESS).describe("CRAFTING_PROGRESS: the crafting progress of the source or sink."),
    entity: EntityReferenceSchema.describe("The end of the inserter that the value comes from: SOURCE or SINK.")
});

const ValueReferenceBonusProgressSchema = z.object({
    type: z.literal(ValueReferenceType.BONUS_PROGRESS).describe("BONUS_PROGRESS: the productivity bonus progress of the source or sink."),
    entity: EntityReferenceSchema.describe("The end of the inserter that the value comes from: SOURCE or SINK.")
});

const ValueReferenceHandQuantitySchema = z.object({
    type: z.literal(ValueReferenceType.HAND_QUANTITY).describe("HAND_QUANTITY: the count of items in the hand of the inserter."),
    item_name: z.string().optional().describe("The name of the item to count; without it, all items in the hand count.")
});

const ValueReferenceMachineStatusSchema = z.object({
    type: z.literal(ValueReferenceType.MACHINE_STATUS).describe("MACHINE_STATUS: 1 when the source or sink shows the status, else 0."),
    entity: EntityReferenceSchema.describe("The end of the inserter that the value comes from: SOURCE or SINK."),
    status: z.enum([
        MachineStatus.INGREDIENT_SHORTAGE,
        MachineStatus.WORKING,
        MachineStatus.OUTPUT_FULL,
        MachineStatus.NO_FUEL,
    ]).describe("The machine status to compare with.")
});

const ValueReferenceInserterStackSizeSchema = z.object({
    type: z.literal(ValueReferenceType.INSERTER_STACK_SIZE).describe("INSERTER_STACK_SIZE: the number of items that the hand of the inserter holds.")
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
    left: ValueReferenceSchema.describe("The value on the left side of the comparison."),
    operator: ComparisonOperatorSchema.describe("The comparison operator."),
    right: ValueReferenceSchema.describe("The value on the right side of the comparison.")
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
        operator: RuleOperatorSchema.describe("AND: all rules must be true. OR: one rule must be true."),
        rules: z.array(z.union([ConditionSchema, RuleSetSchema])).min(1).describe("The conditions and the rule sets that this rule set combines.")
    })
);

export type RuleSet = z.infer<typeof RuleSetSchema>;

const LatchConfigSchema = z.object({
    release: RuleSetSchema.describe("The rule set that disables the entity again when it is true.")
});

const EnableControlOverrideConditionalSchema = z.object({
    mode: z.literal(EnableControlMode.CONDITIONAL).describe("CONDITIONAL: the entity is enabled while its rule set is true."),
    rule_set: RuleSetSchema.describe("The rule set that enables the entity when it is true."),
    latch: LatchConfigSchema.optional().describe("Keeps the entity enabled after its rule set is true, until the release rule set is true.")
});

export type EnableControlOverrideConditional = z.infer<typeof EnableControlOverrideConditionalSchema>;

export const EnableControlOverrideConfigSchema = z.preprocess(readNeverOverrideAsAuto, z.preprocess(renameClockedPeriodToWindowCycle, z.discriminatedUnion("mode", [
    EnableControlOverrideAutoSchema,
    EnableControlOverrideAlwaysSchema,
    EnableControlOverrideClockedSchema,
    EnableControlOverrideConditionalSchema
])));

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
    type: z.literal(TargetType.MACHINE).describe("The drill puts its items into a machine."),
    id: z.number().int().positive().describe("The id of the machine.")
});

/** A chest of any type the drill drops into, by its rules: slots and room, weight and routing for a silo */
const DrillTargetChestConfigSchema = z.object({
    type: z.literal(TargetType.CHEST).describe("The drill puts its items into a chest."),
    id: z.number().int().positive().describe("The id of the chest.")
});

const DrillTargetConfigSchema = z.discriminatedUnion("type", [DrillTargetMachineConfigSchema, DrillTargetChestConfigSchema]);

/**
 * Overrides configuration for mining drills.
 */
const MiningDrillOverridesConfigSchema = z.object({
    enable_control: EnableControlOverrideConfigSchema.optional().describe("The Enable Control Strategy override of the drill."),
    /**
     * For a drill into a chest on the windows the generator makes for it (no enable control, or AUTO): ticks each window
     * starts earlier than the fewest that keep the chest's takers supplied. The generator tries 1 when a clock does not
     * hold with the fewest.
     */
    extra_window_ticks: z.number().int().min(0).optional().describe("Extra ticks at the start of each enable window that the generator makes for a drill into a chest.")
});

export const MiningDrillConfigSchema = z.object({
    id: z.number().int().positive().describe("The number that identifies the drill in the configuration."),
    type: MiningDrillTypeSchema.describe("The prototype name of the drill."),
    mined_item_name: z.string().describe("The name of the item that the drill mines."),
    /**
     * The speed bonus can be obtained by hovering over the drill and typing:
     * `/c game.print(game.player.selected.speed_bonus)`
     */
    speed_bonus: z.number().describe("The mining speed bonus of the drill, as the game gives it."),
    /**
     * The drill's mining productivity in percent, as a machine's: the force's mining productivity research and the
     * drill's productivity modules together, as the game gives it and its bonus bar uses it (not capped). The sidecar
     * exports it; the game shows it with: `/c game.print(game.player.selected.productivity_bonus * 100)`
     */
    productivity: z.number().min(0).describe("The mining productivity of the drill from research and modules, in percent."),
    target: DrillTargetConfigSchema.describe("The machine or chest into which the drill puts its items."),
    overrides: MiningDrillOverridesConfigSchema.optional().describe("Settings that replace what the generator chooses for this drill."),
    /** Where the drill stands and the way it faces (MapPositionSchema, DirectionSchema). Sidecar 0.12.0 exports them. */
    position: MapPositionSchema.optional().describe("Where the drill is in the game, in tiles, from the sidecar."),
    direction: DirectionSchema.optional().describe("The direction that the drill faces: 0 north, 4 east, 8 south, 12 west."),
});

export type MiningDrillConfig = z.infer<typeof MiningDrillConfigSchema>;

/** The mining drills. A config with the former `mining_productivity_level` is read as each drill's productivity once. */
export const DrillsConfigSchema = z.preprocess(migrateMiningProductivityLevelStep, z.object({
    configs: z.array(MiningDrillConfigSchema).describe("The mining drills of the build.")
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
    lane: z.union([z.literal(1), z.literal(2)]).describe("The lane on which the inserter drops items: 1 or 2, by its place in the belt's lanes."),
    /**
     * Tiles along the belt's path, increasing in the direction the belt runs. The origin is free but the same for
     * every inserter that drops on the belt, and a position may be negative or a fraction: only the distances
     * between them count.
     */
    position: z.number().describe("Where the inserter drops along the belt, in tiles in the direction of travel.")
});

/**
 * A field only a side-loaded pickup has. Side-loaded pickups are out of scope, so the field is kept only to refuse a
 * config that names it: without it the schema would drop the field and read the pickup as a plain belt.
 */
const sideLoadedPickupField = (field: string) => z.custom<never>(() => false, { error: sideLoadedPickupRefusal(field) }).optional();

const InserterBeltSourceConfigSchema = z.object({
    type: z.literal(TargetType.BELT).describe("The inserter takes items from a belt."),
    id: z.number().int().positive().describe("The id of the belt."),
    /**
     * Preferred pickup lane, by its place in the belt's `lanes`, 1 or 2 (left in travel direction first).
     * This is the nearest lane beside a belt, or the lane selected by mirroring at a front underground exit.
     * The inserter takes from that lane first when its sink takes the items of both, as in the game.
     * Without it the inserter takes its items in the
     * order of its `filters`, or of the sink's ingredients when it has none, which may not be what the build does.
     */
    near_lane: z.union([z.literal(1), z.literal(2)]).optional().describe("The lane, 1 or 2, from which the inserter takes items first."),
    /** Exposed pickup line in tiles: 1 on a straight belt (default), 0.5 at either underground endpoint.
     * Geometry is independent of the moving/backed-up supply setting (backed_up_belts).
     */
    pickup_length: z.union([z.literal(0.5), z.literal(1)]).default(1).describe("The length of belt from which the inserter can take items, in tiles: 1 on a straight belt, 0.5 at an underground belt end."),
    /** Physical approach and endpoint; required for manual underground pickups. */
    pickup_layout: z.enum(BELT_PICKUP_LAYOUTS).optional().describe("The layout of the belt at the pickup, which a manual underground pickup must have."),
    /** Refused: side-loaded pickups, by one stream or two merging, are out of scope */
    pickup_supply: sideLoadedPickupField("pickup_supply").describe("Not supported: the generator refuses a side-loaded pickup."),
    /** Refused: side-loaded pickups, by one stream or two merging, are out of scope */
    pickup_merge: sideLoadedPickupField("pickup_merge").describe("Not supported: the generator refuses a side-loaded pickup."),
    /** Persistent capture provenance; absent on manual configurations. */
    pickup_capture: BeltPickupCaptureSchema.optional().describe("What the sidecar recorded about the belt at the pickup; a manual configuration does not have it."),
    /** Refused: only an inserter's sink has a drop spot (see the checks of ConfigSchema) */
    drop: InserterBeltDropConfigSchema.optional().describe("Not used on a source: the generator refuses it, because a drop belongs on the sink.")
});

const SideLoadedDropCaptureSchema = z.object({
    status: z.literal("side-loaded").describe("The items that the inserter drops side-load onto another belt."),
    /** The belt tiles from the drop tile to the belt its stream side-loads onto */
    tiles: z.number().int().positive().describe("The number of belt tiles from the drop tile to the belt that the items side-load onto."),
    sidecar_version: z.string().optional().describe("The version of the sidecar that recorded this."),
});

const InserterBeltSinkConfigSchema = z.object({
    type: z.literal(TargetType.BELT).describe("The inserter drops items on a belt."),
    id: z.number().int().positive().describe("The id of the belt."),
    /**
     * Where the inserter drops on a shared lane. Omitted positions use independent local output tiles with
     * retained stock. It is all or none per belt: when any inserter that drops on a belt has it, every one must.
     */
    drop: InserterBeltDropConfigSchema.optional().describe("Where the inserter drops on a shared lane; give it to all inserters that drop on the belt, or to none."),
    /**
     * Sidecar 0.13.0 marks a drop whose stream side-loads onto a belt that is fed from behind, `tiles` along the belt
     * from the drop. It is a note for the result and changes nothing in the clock (docs/game-data-and-scope.md).
     */
    drop_capture: SideLoadedDropCaptureSchema.optional().describe("A note from the sidecar that the drop side-loads onto another belt; it does not change the clock."),
    /**
     * The way the belt runs at the drop tile (DirectionSchema, the cardinal ones), which Sidecar 0.14.0 exports. It
     * orders the drops along the belt in the check of config/drop-spacing.ts and changes nothing in the clock.
     */
    belt_direction: DirectionSchema.optional().describe("The direction in which the belt moves at the drop tile.")
});

const InserterMachineConfigSchema = z.object({
    type: z.literal(TargetType.MACHINE).describe("The entity at this end of the inserter is a machine."),
    id: z.number().int().positive().describe("The id of the machine.")
});

const InserterChestConfigSchema = z.object({
    type: z.literal(TargetType.CHEST).describe("The entity at this end of the inserter is a chest."),
    id: z.number().int().positive().describe("The id of the chest.")
});

export { TargetType };

export const InserterAnimationOverrideConfigSchema = z.object({
    pickup_duration_ticks: z.number().int().positive().optional().describe("The number of ticks that the inserter takes to pick up items.")
});

export type InserterAnimationOverrideConfig = z.infer<typeof InserterAnimationOverrideConfigSchema>;

/**
 * Overrides configuration for inserters.
 * Contains animation overrides and enable control overrides.
 */
const InserterOverridesConfigSchema = z.object({
    animation: InserterAnimationOverrideConfigSchema.optional().describe("Settings that replace the movement times of the inserter."),
    enable_control: EnableControlOverrideConfigSchema.optional().describe("The Enable Control Strategy override of the inserter.")
});

export const InserterConfigSchema = z.object({
    id: z.number().int().positive().optional().describe("The number that identifies the inserter in the configuration."),
    source: z.discriminatedUnion("type", [
        InserterBeltSourceConfigSchema,
        InserterMachineConfigSchema,
        InserterChestConfigSchema
    ]).describe("The belt, machine or chest from which the inserter takes items."),
    sink: z.discriminatedUnion("type", [
        InserterBeltSinkConfigSchema,
        InserterMachineConfigSchema,
        InserterChestConfigSchema
    ]).describe("The belt, machine or chest into which the inserter puts items."),
    /**
     * The inserter's prototype name in the game data: "inserter", "fast-inserter", "long-handed-inserter",
     * "bulk-inserter" or "stack-inserter" (default). The burner inserter needs fuel and is refused. The prototype sets
     * how long a swing takes, with the quality, and how many items the hand holds, with the research. Only the
     * legendary stack inserter may pick up from a belt: belt pickup timing is calibrated on it alone (follow-up F7).
     */
    prototype: z.string().optional().describe("The prototype name of the inserter in the game data; the default is \"stack-inserter\"."),
    /** The inserter's quality (default "legendary"); the higher it is, the faster the arm turns. It does not change the hand. */
    quality: z.enum(["normal", "uncommon", "rare", "epic", "legendary"]).optional().describe("The quality of the inserter, which sets how fast its arm turns; the default is \"legendary\"."),
    /**
     * Items in the hand. Without it the hand is what all the research gives the prototype (16 for a stack inserter, 12
     * for a bulk inserter, 4 for the others); with it, it overrides that, as when a technology is not researched.
     */
    stack_size: z.number().int().positive().optional().describe("The number of items that the hand holds; the default is what all research gives."),
    filters: z.array(z.string()).optional().describe("The names of the items that the inserter moves."),
    /**
     * How the game reads `filters`: "whitelist" (default), the items the inserter moves. "blacklist", the items it
     * leaves, is refused when there are filters: the generator models a whitelist only. Kept so that a captured
     * blacklist is refused rather than stripped and read as the items to move.
     */
    filter_mode: z.enum(["whitelist", "blacklist"]).optional().describe("How the game reads the filters: \"whitelist\" (default); the generator refuses \"blacklist\"."),
    overrides: InserterOverridesConfigSchema.optional().describe("Settings that replace what the generator chooses for this inserter."),
    /** Where the inserter stands and the way it faces (MapPositionSchema, DirectionSchema). Sidecar 0.12.0 exports them. */
    position: MapPositionSchema.optional().describe("Where the inserter is in the game, in tiles, from the sidecar."),
    direction: DirectionSchema.optional().describe("The direction that the inserter faces: 0 north, 4 east, 8 south, 12 west."),
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

/**
 * What happens to an item at the downstream end of a lane, as `LaneEnd` in entities/traits/lane-facts.ts has it. A dead
 * end holds the items until a hand takes them; an outlet carries them away at `outlet_rate` items a second; "unknown" is
 * an end that the build does not show.
 */
const LaneEndConfigSchema = z.discriminatedUnion("kind", [
    z.object({
        kind: z.literal("dead_end").describe("dead_end: the lane stops, and the items stay on it until a hand takes them."),
    }),
    z.object({
        kind: z.literal("outlet").describe("outlet: the lane continues, and the items that no hand takes move away."),
        outlet_rate: z.number().positive().describe("The items per second that move off the end of the lane."),
    }),
    z.object({
        kind: z.literal("unknown").describe("unknown: the configuration does not know the end of the lane."),
    }),
]);

/** Whether every copy of the unit takes from the same lane, or each copy has a lane of its own (`LaneSharing`) */
const LaneSharingConfigSchema = z.enum(["shared_by_copies", "one_per_copy"]);

/**
 * One lane of a belt. The lane facts (`supply_rate`, `lane_end`, `sharing`) are optional, and each one is read alone:
 * a fact that the lane does not state is derived as entities/traits/lane-facts.ts `laneFactsOf` says. A field without a
 * default, so that a config that states none is written back without them.
 */
const BeltLaneConfigSchema = z.object({
    ingredient: z.string().describe("The name of the item on the lane."),
    stack_size: z.number().int().positive().describe("The number of items in each stack on the lane."),
    supply_rate: z.number().positive().optional().describe("The items per second that come onto the lane where it starts. The default is the lane's capacity."),
    lane_end: LaneEndConfigSchema.optional().describe("The end of the lane. Without it, backed_up_belts sets the end."),
    sharing: LaneSharingConfigSchema.optional().describe("shared_by_copies (default): all copies take from this lane. one_per_copy: each copy has a lane of its own."),
});

const ExportBeltLaneConfigSchema = BeltLaneConfigSchema.extend({
    /** Items per second taken off this lane by consumers outside the config */
    consumption_per_second: z.number().positive().optional().describe("The items per second that entities outside the configuration take off this lane."),
});

const NormalBeltConfigSchema = z.object({
    id: z.number().int().positive().describe("The number that identifies the belt in the configuration."),
    type: BeltTypeSchema.describe("The prototype name of the belt."),
    strategy: z.literal(BeltStrategy.NORMAL).optional().describe("normal (default): only the build takes items off the belt."),
    lanes: z.union([
        z.tuple([BeltLaneConfigSchema]),
        z.tuple([BeltLaneConfigSchema, BeltLaneConfigSchema])
    ]).describe("The lanes of the belt, one or two, the left lane in the direction of travel first.")
});

const ExportBeltConfigSchema = z.object({
    id: z.number().int().positive().describe("The number that identifies the belt in the configuration."),
    type: BeltTypeSchema.describe("The prototype name of the belt."),
    strategy: z.literal(BeltStrategy.EXPORT).describe("export: entities outside the configuration also take items off the belt."),
    lanes: z.union([
        z.tuple([ExportBeltLaneConfigSchema]),
        z.tuple([ExportBeltLaneConfigSchema, ExportBeltLaneConfigSchema])
    ]).describe("The lanes of the belt, one or two, the left lane in the direction of travel first.")
});

export const BeltConfigSchema = z.union([NormalBeltConfigSchema, ExportBeltConfigSchema]);

export type BeltConfig = z.infer<typeof BeltConfigSchema>;

// ============================================================================
// Chest Configuration
// ============================================================================

export const BufferChestConfigSchema = z.object({
    type: z.literal(ChestType.BUFFER_CHEST).describe("A chest that holds one item."),

    id: z.number().int().positive().describe("The number that identifies the chest in the configuration."),
    storage_size: z.number().int().positive().describe("The number of slots of the chest."),
    /**
     * The single item type this chest is filtered to hold.
     * Chests only support one item type for simplicity.
     */
    item_filter: z.string().describe("The name of the one item that the chest holds."),
    /** The chest's prototype name in the game data ("steel-chest"), which the clock's descriptions show as its icon; without it they name it by its id. Sidecar 0.12.0 exports it. */
    prototype: z.string().optional().describe("The prototype name of the chest in the game data, for example \"steel-chest\"."),
    /** Where the chest stands (MapPositionSchema). Sidecar 0.12.0 exports it. */
    position: MapPositionSchema.optional().describe("Where the chest is in the game, in tiles, from the sidecar."),
});

export type BufferChestConfig = z.infer<typeof BufferChestConfigSchema>;


export const InfinityFilterConfigSchema = z.object({
    /**
     * The entity name of the item to request
     */
    item_name: z.string().min(1).describe("The name of the item that the chest supplies."),
    /**
     * The count of items to request from the infinity chest each time.
     */
    request_count: z.number().int().nonnegative().describe("The number of items that the chest keeps.")
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
    type: z.literal(ChestType.INFINITY_CHEST).describe("A chest that supplies items without end."),
    id: z.number().int().positive().describe("The number that identifies the chest in the configuration."),
    item_filter: z.array(InfinityFilterConfigSchema).default([]).describe("The items that the chest supplies."),
    /** Remove incoming items that are not configured supplies. Omitted in legacy builds. */
    remove_unfiltered_items: z.boolean().optional().describe("Whether the chest removes the items that are not in its filters."),
    /** Where the chest stands (MapPositionSchema). Sidecar 0.12.0 exports it. */
    position: MapPositionSchema.optional().describe("Where the chest is in the game, in tiles, from the sidecar."),
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
        slot: z.number().int().positive().describe("The slot number, from 1."),
        /** The only item the slot takes */
        item: z.string().min(1).describe("The only item that the slot takes."),
        blocked: z.never({ error: BOTH_IN_SLOT_FILTER }).optional().describe("Not used with item."),
    }),
    z.object({
        /** The slot, from 1 */
        slot: z.number().int().positive().describe("The slot number, from 1."),
        /** The slot takes no item, as with the game's no-item or deconstruction planner filter */
        blocked: z.literal(true).describe("The slot takes no item."),
        item: z.never({ error: BOTH_IN_SLOT_FILTER }).optional().describe("Not used with blocked."),
    }),
]));

export const SlotContentConfigSchema = z.object({
    /** The slot, from 1 */
    slot: z.number().int().positive().describe("The slot number, from 1."),
    item: z.string().min(1).describe("The name of the item in the slot."),
    /** At most the item's stack size */
    count: z.number().int().positive().describe("The number of items in the slot, at most one stack."),
});

export type SlotContentConfig = z.infer<typeof SlotContentConfigSchema>;

const slotContainerFields = {
    id: z.number().int().positive().describe("The number that identifies the entity in the configuration."),
    /** Slots that take one item only, or none when blocked; the other slots take any item */
    slot_filters: z.array(SlotFilterConfigSchema).optional().describe("The slots that take one item only, or no item."),
    /** What the container holds when the build starts, slot by slot; empty without it */
    contents: z.array(SlotContentConfigSchema).optional().describe("The items that the entity holds when the build starts."),
    storage_size: storageSizeRefused.describe("Not used: the game data gives the slots, and the generator refuses a configuration with this field."),
    /** Where it stands (MapPositionSchema). Sidecar 0.12.0 exports it. */
    position: MapPositionSchema.optional().describe("Where the entity is in the game, in tiles, from the sidecar."),
};

/** A car as a chest: the slots of its trunk, from the game data */
export const CarConfigSchema = z.object({ type: z.literal(ChestType.CAR).describe("A car, used as a chest."), ...slotContainerFields });
/** A tank as a chest: the slots of its trunk, from the game data */
export const TankConfigSchema = z.object({ type: z.literal(ChestType.TANK).describe("A tank, used as a chest."), ...slotContainerFields });
/** A cargo wagon standing still, as a chest: its slots from the game data and its quality */
export const CargoWagonConfigSchema = z.object({
    type: z.literal(ChestType.CARGO_WAGON).describe("A cargo wagon that does not move, used as a chest."),
    ...slotContainerFields,
    /** The wagon's quality (default "normal"), which sets its slots */
    quality: QualityNameSchema.optional().describe("The quality of the wagon, which sets its slots; the default is \"normal\"."),
});

export type CarConfig = z.infer<typeof CarConfigSchema>;
export type TankConfig = z.infer<typeof TankConfigSchema>;
export type CargoWagonConfig = z.infer<typeof CargoWagonConfigSchema>;
export type SlotContainerConfig = CarConfig | TankConfig | CargoWagonConfig;

export const ItemCountConfigSchema = z.object({
    item: z.string().min(1).describe("The name of the item."),
    count: z.number().int().positive().describe("The number of items."),
});

/**
 * A rocket silo as a chest. It takes any item into its rocket inventory, as far as the rocket lifts its weight, and its
 * recipe's ingredients into its input slots, up to the automated insertion limit. No craft is run.
 */
export const RocketSiloConfigSchema = z.object({
    type: z.literal(ChestType.ROCKET_SILO).describe("A rocket silo, used as a chest."),
    id: z.number().int().positive().describe("The number that identifies the rocket silo in the configuration."),
    /**
     * The quality of its rocket part recipe (default "normal"). Of any other quality, the ingredients the build brings
     * (all of normal quality) go into the rocket inventory instead of the input slots.
     */
    recipe_quality: QualityNameSchema.optional().describe("The quality of the rocket part recipe; the default is \"normal\"."),
    /** Its crafting speed with modules and beacons (default the game data's, 1), which sets the insertion limit */
    crafting_speed: z.number().positive().optional().describe("The crafting speed of the rocket silo, which sets its automated insertion limit."),
    /** Its productivity; no craft is run, so it changes nothing yet */
    productivity: z.number().min(0).optional().describe("The productivity bonus of the rocket silo, which changes nothing at this time."),
    /** What it holds when the build starts, placed as an inserter would place it */
    contents: z.array(ItemCountConfigSchema).optional().describe("The items that the rocket silo holds when the build starts."),
    storage_size: storageSizeRefused.describe("Not used: the game data gives the slots, and the generator refuses a configuration with this field."),
    /** Where it stands (MapPositionSchema). Sidecar 0.12.0 exports it. */
    position: MapPositionSchema.optional().describe("Where the rocket silo is in the game, in tiles, from the sidecar."),
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

export const ConfigOverridesSchema = z.preprocess(renameLoopSeedItemsToKickStart, z.preprocess(dropFractionalSwingsOverride, z.preprocess(migrateBeltSupplyOverrides, z.object({
    lcm: z.number().int().positive().optional().describe("The number of output cycles in one window cycle; without it, the generator calculates the number."),
    /**
     * Forces the number of output swings per crafting cycle. Without it the generator picks the count and lowers it
     * until the output is stable.
     */
    terminal_swing_count: z.number().int().positive().optional().describe("The number of output swings in each output cycle; without it, the generator chooses the number."),
    /**
     * Input supply is backed up at the pickup: items stop between grabs and upstream supply refills the gaps at belt
     * speed, so a hand takes the stacks in reach a tick each and then waits for the belt to bring the rest. Geometry is
     * retained independently of this rule.
     *
     * A clock is made for a moving belt by default: each window of an inserter that picks up from a belt stays open
     * a few ticks longer (belt pickup slack), and a clock without it is only selected when no clock with it holds the
     * target rate. When enabled, a clock is made without the slack and the one with the fewest wake-ups is selected.
     * A clock that does not hold the expected output without the slack is listed as unstable.
     *
     * @default false
     */
    backed_up_belts: z.boolean().optional().describe("Whether the input belts are backed up at the pickup, so that the clocks have no belt slack."),
    /**
     * Run the four searches for every build: observed windows, uneven output swings, shifted swings and full-hand
     * output swings. They take most of the time of a generation.
     *
     * By default they only run when no clock made without a search can be selected as stable. Where one can, a
     * search may still find a stable clock with fewer wake-ups; when enabled, the searches run for that too.
     *
     * @default false
     */
    search_for_fewer_wake_ups: z.boolean().optional().describe("Whether the generator always does the four searches, to find a clock with fewer wakeups."),
    /**
     * Try every clock from other starts than the plain cold start of the staged scaffold too: with the clock standing 30,
     * 300, 700 and 1000 ticks into its window cycle at the first tick, and with the inserters that compete for one machine's
     * product served in ascending config ids and in two random orders. The clock is stable when it reaches its target
     * from every start, start-dependent when it does from some, unstable when it does from none; a start-dependent
     * clock is listed with where it reaches its target and where it settles elsewhere.
     *
     * By default every clock is judged from the cold start alone, and the generator says that start dependence was
     * not checked. Takes a few more long runs of every clock.
     *
     * @default false
     */
    check_start_dependence: z.boolean().optional().describe("Whether the generator tests each clock from more starts than the cold start."),
    /**
     * Items of its own product a machine whose recipe makes its own ingredient (pentapod eggs) is given once when a clock
     * starts on the staged scaffold: the loop cannot start itself, so the scaffold's machines get their kick start by hand.
     *
     * @default 200
     */
    kick_start_items: z.number().int().nonnegative().optional().describe("The kick start: the number of its own product that a machine gets before its clock starts, when its recipe uses that product."),
    /**
     * @deprecated Ignored. Set terminal_swing_count to force an output swing count instead; other counts are
     * offered as potential clocks.
     */
    disable_swing_backoff: z.boolean().optional().describe("Not used: set terminal_swing_count to give the number of output swings."),
    /**
     * Derive every non-output inserter's clock window from how it behaves when only the output
     * inserters are clocked, then verify the result with a clock-only (as-built) simulation.
     * Replaces the heuristic window trimming; the result is marked unstable when no padding passes.
     * 
     * @default false
     */
    derive_clock_windows: z.boolean().optional().describe("Whether the generator finds the enable windows of other inserters from a run in which only the output inserters have a clock."),
    /**
     * Item names to exclude from the LCM calculation.
     * 
     * Inserters that exclusively transfer items in this list will not contribute
     * their transfer fractions to the LCM computation, reducing the overall LCM.
     * Any such inserter should be set to ALWAYS enabled so it runs every cycle
     * regardless of the window cycle.
     */
    ignored_lcm_ingredients: z.array(z.string()).optional().describe("The items that do not change the window cycle time; set each inserter that moves only these items to ALWAYS.")
}))));

export type ConfigOverrides = z.infer<typeof ConfigOverridesSchema>;

// ============================================================================
// Root Config
// ============================================================================

export const ConfigSchema = z.preprocess(renameTargetOutputToSetpoint, z.preprocess(normalizePickupCaptureConfig, z.object({
    setpoint: TargetProductionRateConfigSchema.describe("The setpoint: the product that the build must make, and the rate it must hold. The clock never changes it."),
    machines: z.array(MachineConfigurationSchema).describe("The machines of the build."),
    drills: DrillsConfigSchema.optional().describe("The mining drills of the build."),
    inserters: z.array(InserterConfigSchema).describe("The inserters of the build."),
    belts: z.array(BeltConfigSchema).describe("The belts of the build."),
    chests: z.array(ChestConfigSchema).optional().describe("The chests of the build, and the cars, tanks, cargo wagons and rocket silos that it uses as chests."),
    overrides: ConfigOverridesSchema.optional().describe("Settings that replace what the generator chooses for the configuration.")
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
    config.machines.forEach((machine, index) => {
        if (machine.result_target === undefined) return;
        const chest_id = machine.result_target.id;
        if (machine.result_target.type === "machine") {
            const target = config.machines.find(target => target.id === machine.result_target!.id);
            const path = ["machines", index, "result_target"];
            if (!target) {
                context.addIssue({ code: "custom", path: [...path, "id"], message: `Machine ${machine.id} places its results into machine ${chest_id}, which is not in the configuration` });
            } else if (target.id === machine.id) {
                context.addIssue({ code: "custom", path, message: `Machine ${machine.id} cannot place its results into itself. Pick the machine at its output side.` });
            }
        } else if (!config.chests?.some(chest => chest.id === chest_id)) {
            context.addIssue({ code: "custom", path: ["machines", index, "result_target", "id"],
                message: `Machine ${machine.id} places its results into chest ${chest_id}, which is not in the configuration` });
        }
        // the prototype's game data says whether it places its results itself; without the data this is checked when it loads
        if (FactorioDataService.isAvailable() && !machinePlacesResults(machine)) {
            context.addIssue({ code: "custom", path: ["machines", index, "result_target"],
                message: `Machine ${machine.id}${machine.prototype === undefined ? " names no prototype, so it" : ` (${machine.prototype})`} `
                    + "does not place its results itself: only a machine that does (a recycler) has a `result_target`; "
                    + "an inserter takes the results out of any other" });
        }
        const trapped = machine.result_target.type === "chest" && FactorioDataService.isAvailable() ? resultsTrappedInSilo(machine.recipe, config.chests?.find(chest => chest.id === chest_id)) : [];
        if (trapped.length > 0) {
            context.addIssue({ code: "custom", path: ["chests", config.chests!.findIndex(chest => chest.id === chest_id), "recipe_quality"],
                message: `Machine ${machine.id} places ${trapped.join(" and ")} into rocket silo ${chest_id}, whose rocket part recipe takes `
                    + `${trapped.length === 1 ? "it" : "them"} at normal quality: ${trapped.length === 1 ? "it goes" : "they go"} into the silo's input slots, `
                    + "where no inserter takes them out, and once those are full the machine stops for good. Set the silo's `recipe_quality` "
                    + "to another quality, so that every result goes into its rocket inventory." });
        }
    });
    config.drills?.configs.forEach((drill, index) => {
        if (drill.target.type !== TargetType.CHEST) return;
        const chest_id = drill.target.id;
        if (!config.chests?.some(chest => chest.id === chest_id)) {
            context.addIssue({ code: "custom", path: ["drills", "configs", index, "target", "id"],
                message: `Drill ${drill.id} drops into chest ${chest_id}, which is not in the configuration` });
        }
        // a drill into a chest is on the windows the generator makes for it (AUTO), on its own (CLOCKED) or always on;
        // a condition needs an inserter's hand to read
        const mode = drill.overrides?.enable_control?.mode;
        if (mode === EnableControlMode.CONDITIONAL) {
            context.addIssue({ code: "custom", path: ["drills", "configs", index, "overrides", "enable_control"],
                message: `Drill ${drill.id} drops into a chest; its override can be AUTO, CLOCKED or ALWAYS, not ${mode}` });
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
})));

/** Parsed configs have explicit pickup geometry on every belt source. */
export type ParsedConfig = z.infer<typeof ConfigSchema>;
/** Public engine inputs also accept inserters whose pickup length uses the straight-belt default. */
export type Config = Omit<ParsedConfig, "inserters"> & { inserters: InserterConfig[] };
