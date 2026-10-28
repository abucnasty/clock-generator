import { EnergyTrait } from "./energy";
import { HandTrait } from "./hand";
import { InputLimitsTrait } from "./input-limits";
import { LaneTrait } from "./lane";
import { LoopTrait } from "./loop";
import { OutputBlockTrait } from "./output-block";
import { PlacementTrait } from "./placement";
import { ProductionTrait } from "./production";
import { Ratio } from "./ratio";
import { RecipeSelectionTrait } from "./recipe-selection";
import { SpoilageTrait } from "./spoilage";
import { StorageTrait } from "./storage";
import { ThroughputTrait } from "./throughput";
import { TimingTrait } from "./timing";
import { YieldTrait } from "./yield";

/** Every trait by the name its field has on an entity's traits (build-traits.ts) */
export interface TraitTypes {
    production: ProductionTrait;
    yield: YieldTrait;
    input_limits: InputLimitsTrait;
    output_block: OutputBlockTrait;
    recipe_selection: RecipeSelectionTrait;
    placement: PlacementTrait;
    storage: StorageTrait;
    lane: LaneTrait;
    energy: EnergyTrait;
    spoilage: SpoilageTrait;
    hand: HandTrait;
    timing: TimingTrait;
    throughput: ThroughputTrait;
    loop: LoopTrait;
}

/** A figure that has one row: a number, a string, a boolean, a ratio or a list of numbers or strings */
type Leaf = string | number | boolean | Ratio | readonly (string | number)[];

/**
 * The paths of a trait's figures, "trait.field.subfield": a list of objects counts as one of its elements, a nullable
 * field as its value, a ratio and a list of plain values as one figure
 */
type FieldPaths<T, P extends string> =
    T extends Leaf ? P
        : T extends readonly (infer E)[] ? FieldPaths<E, P>
            : T extends object ? { [K in keyof T & string]-?: FieldPaths<NonNullable<T[K]>, `${P}.${K}`> }[keyof T & string]
                : P;

/** Every figure of every trait, "hand.research" */
export type TraitFieldPath = { [K in keyof TraitTypes & string]: FieldPaths<TraitTypes[K], K> }[keyof TraitTypes & string];

/**
 * How well a figure stands, best first:
 * - measured: recorded in the game, the figure or the rule that gives it (a recording, a game test, a measured table);
 * - game-rule: the game's own rule, stated by its data, its developers or its interface, and not recorded here;
 * - game-data: read off the prototype data;
 * - config: as the config sets it;
 * - derived: arithmetic over other figures, as sound as they are;
 * - assumed: a rule of thumb, a fitted number or a model that is not checked in the game;
 * - label: what names an entity, an item or a kind; no figure.
 * A floor (`timing.by_item.floor.*`) whose standing is below "measured" is null where it is not known to hold (P3 2.2).
 */
export type Standing = "measured" | "game-rule" | "game-data" | "config" | "derived" | "assumed" | "label";

/**
 * Where a figure comes from: `rule` the rule of the game (src/rules-of-the-game.ts, "R1"), `audit` the item of the
 * mechanics audit of 0.25.0 ("A15"; the audit is kept outside the repository, so its ids are checked for their form
 * only), `doc` the section that describes it (docs/ of this package, or "mechanics/" for docs/mechanics of
 * factorio-benchmarks), `note` what is kept as it is today and why.
 */
export interface Basis {
    readonly rule?: string;
    readonly audit?: string;
    readonly doc?: string;
    readonly standing: Standing;
    readonly note?: string;
}

/** The basis of every figure of every trait: the compiler holds it to TraitFieldPath, a row each, none over */
export const TRAIT_BASIS: Readonly<Record<TraitFieldPath, Basis>> = {
    "production.kind": { standing: "label" },
    "production.recipe_or_resource": { standing: "label" },
    "production.prototype": { standing: "label" },
    "production.prototype_type": { standing: "game-data", doc: "P4 2.2 (archetypes by prototype class)" },
    "production.speed": { standing: "config", doc: "docs/drills.md (How a drill mines)",
        note: "a machine's as configured (modules, beacons, quality folded in by the sidecar); a drill's mining_speed x (1 + speed bonus)" },
    "production.energy_required": { standing: "game-data" },
    "production.ticks_per_craft": { standing: "derived", doc: "docs/rules-of-the-game.md (Crafting Constraints)" },
    "production.crafts_per_tick": { standing: "derived", doc: "docs/rules-of-the-game.md (Crafting Constraints)",
        note: "the ceiling: a machine never crafts faster" },
    "production.productivity": { standing: "config", audit: "A25", note: "applied as given, not capped at 300% (the sidecar caps it)" },
    "production.bonus_per_craft": { standing: "derived", doc: "mechanics/machines.md section 7" },
    "production.ticks_per_bonus": { standing: "derived", doc: "mechanics/machines.md section 7",
        note: "kept as bonus-productivity-rate.ts computes it, ticks per craft x productivity, which its own comment (120 ticks at 50% give 240) disagrees with; read by labels and machine facts only" },
    "production.inputs.item": { standing: "label" },
    "production.inputs.per_craft": { standing: "game-data" },
    "production.inputs.per_second": { standing: "derived", note: "at full speed (input/consumption-rate.ts)" },
    "production.inputs.per_tick": { standing: "derived" },
    "production.insertion_duration_ticks": { standing: "derived", audit: "A15", note: "ticks to the overload lockout (traits/insertion-duration.ts)" },

    "yield.results.item": { standing: "label" },
    "yield.results.amount": { standing: "game-data" },
    "yield.results.probability": { standing: "game-data", rule: "R18" },
    "yield.results.extra_count_fraction": { standing: "game-data", rule: "R18" },
    "yield.results.ignored_by_productivity": { standing: "game-data", note: "1 of the 2 pentapod eggs a craft" },
    "yield.results.expected_per_craft": { standing: "derived", rule: "R18", audit: "A25", doc: "mechanics/machines.md section 7" },
    "yield.results.per_second": { standing: "derived", note: "the ceiling at full speed" },
    "yield.results.main": { standing: "derived", note: "the result with the largest expected amount a craft (recipe-metadata.ts)" },
    "yield.results.stochastic": { standing: "derived", rule: "R18" },
    "yield.carry": { standing: "assumed", rule: "R18",
        note: "the simulator makes the expected amount and carries the fraction; the game rolls dice (the recycler's returns a tick are a binomial)" },
    "yield.payouts_count_as_finishes": { standing: "measured", rule: "R12", audit: "A3" },

    "input_limits.overload_multiplier": { standing: "game-rule", rule: "R1, R2", audit: "A15",
        note: "ceil(1.166 / (energy / speed)) + 1, 2 to 100: the factor and the clamp are constants no data field backs" },
    "input_limits.limits.item": { standing: "label" },
    "input_limits.limits.limit": { standing: "measured", rule: "R2, R4", audit: "A15, A16", doc: "mechanics/machines.md sections 2 and 5" },
    "input_limits.limits.kind": { standing: "label" },

    "output_block.rule": { standing: "game-data", rule: "R1", doc: "docs/rules-of-the-game.md (Crafting Constraints)",
        note: "from the recipe selection (the prototype's class), not the machine rule" },
    "output_block.per_result.item": { standing: "label" },
    "output_block.per_result.rule": { standing: "game-data", rule: "R1" },
    "output_block.per_result.ingredients_blocked_at": { standing: "measured", rule: "R1", audit: "A15", doc: "docs/rules-of-the-game.md (Crafting Constraints)" },
    "output_block.per_result.held_limit": { standing: "derived", rule: "R1" },
    "output_block.per_result.stack": { standing: "game-data" },

    "recipe_selection.mode": { standing: "game-data", doc: "P4 2.2 (archetypes by prototype class)",
        note: "by-input for the Furnace class (the recycler too), fixed for any other and for a prototype the data does not hold" },

    "placement.mechanism": { standing: "label", rule: "R16, R17, R18" },
    "placement.vector_to_place_result": { standing: "game-data", rule: "R18" },
    "placement.target": { standing: "config" },
    "placement.per_result.item": { standing: "label" },
    "placement.per_result.lands_in": { standing: "measured", rule: "R15, R18", doc: "docs/simulator.md (A machine that places its results itself)" },
    "placement.per_result.into_machine_stop": { standing: "measured", rule: "R3", doc: "docs/drills.md (The stop into a machine)",
        note: "user-verified in the game: 114 on rail, 214 on landfill" },
    "placement.into_container": { standing: "measured", rule: "R16, R18" },
    "placement.phase": { standing: "measured", rule: "R17, R18" },
    "placement.stops_while_stack_waits": { standing: "measured", rule: "R18" },

    "storage.kind": { standing: "label", rule: "R13, R14, R15" },
    "storage.chest_type": { standing: "label" },
    "storage.capacity_by_item.item": { standing: "label" },
    "storage.capacity_by_item.capacity": { standing: "measured", rule: "R13, R15", doc: "docs/simulator.md (Cars, wagons and rocket silos as chests)" },
    "storage.accepts": { standing: "game-rule", rule: "R13" },
    "storage.gives": { standing: "derived", rule: "R14" },
    "storage.items_put_in": { standing: "config" },
    "storage.never_refuses": { standing: "assumed", audit: "A6", note: "an infinity chest as a sink (terminal-rate.ts)" },
    "storage.constant_supply": { standing: "assumed", audit: "A6", note: "an infinity chest as a source keeps its contents" },
    "storage.slots": { standing: "game-data", rule: "R13" },
    "storage.input_slots.overload_multiplier": { standing: "game-rule", rule: "R2, R15", audit: "A15" },
    "storage.input_slots.limits.item": { standing: "label" },
    "storage.input_slots.limits.limit": { standing: "measured", rule: "R2, R15" },
    "storage.input_slots.limits.kind": { standing: "label" },

    "lane.key": { standing: "label" },
    "lane.belt": { standing: "label" },
    "lane.lane": { standing: "label" },
    "lane.listed": { standing: "config", note: "a belt that lists one lane is supplied on it only; drops can land on either side" },
    "lane.item": { standing: "config" },
    "lane.stack": { standing: "config" },
    "lane.belt_prototype": { standing: "label" },
    "lane.tiles_per_tick": { standing: "game-data" },
    "lane.belt_speed": { standing: "game-data", doc: "mechanics/belts.md B2", note: "the prototype's speed x 480 (60 ticks, 8 items a tile)" },
    "lane.items_per_second_ceiling": { standing: "game-rule", doc: "mechanics/belts.md B1, B2" },
    "lane.supply": { standing: "assumed", audit: "A24", note: "a moving belt is assumed saturated" },
    "lane.export_per_second": { standing: "config" },

    "energy.source": { standing: "game-data" },
    "energy.energy_usage_kw": { standing: "game-data", audit: "A27" },
    "energy.energy_bonus": { standing: "config", audit: "A27", note: "clamped at -80% where the burn is worked out" },
    "energy.burner.fuel_categories": { standing: "game-data" },
    "energy.burner.effectivity": { standing: "game-data", note: "not read by the burn; 1 on every burner of 2.1.21" },
    "energy.burner.fuel_inventory_size": { standing: "game-data" },
    "energy.burner.fuels.item": { standing: "game-data" },
    "energy.burner.fuels.fuel_value_mj": { standing: "game-data" },
    "energy.fuel_modelled": { standing: "assumed", audit: "A27",
        note: "kept quirk (D14): only the biochamber rule (a burner on nutrients) burns fuel; the stone and steel furnaces, the captive biter spawner and the burner mining drill run without; to fix after the verification phase with its own blast" },
    "energy.fuel.item": { standing: "config", note: "the config's fuel, else the burner's first" },
    "energy.fuel.fuel_value_mj": { standing: "game-data" },
    "energy.fuel.per_craft": { standing: "derived", audit: "A27" },
    "energy.fuel.per_second": { standing: "derived", audit: "A27" },
    "energy.fuel.per_tick": { standing: "derived", audit: "A27" },
    "energy.fuel.slot_limit": { standing: "measured", rule: "R4", audit: "A16", note: "eleven biochambers, 5 to 13 nutrients" },
    "energy.fuel.energy_per_craft_mj": { standing: "derived" },

    "spoilage.items.item": { standing: "label" },
    "spoilage.items.spoil_ticks": { standing: "game-data" },
    "spoilage.items.quality_affects_spoil_ticks": { standing: "game-data" },
    "spoilage.items.spoil_result": { standing: "game-data" },
    "spoilage.loss_limit_share": { standing: "assumed", audit: "A26", note: "the losses a build is tried with stay under it (backpressure-loss.ts)" },

    "hand.prototype": { standing: "config" },
    "hand.quality": { standing: "config" },
    "hand.nominal": { standing: "config", doc: "docs/rules-of-the-game.md (An inserter's swing, by its prototype and quality)" },
    "hand.research": { standing: "measured", audit: "A22", doc: "docs/rules-of-the-game.md (An inserter's swing, by its prototype and quality)",
        note: "16, 12 and 4, measured once" },
    "hand.by_item.item": { standing: "label" },
    "hand.by_item.hand": { standing: "measured", rule: "R6", doc: "mechanics/inserters.md section 1",
        note: "rounded to belt stacks on a drop for every prototype, though only the stack inserter's data sets grab_less_to_match_belt_stack" },
    "hand.items": { standing: "measured", rule: "R6" },
    "hand.full_hand.at_placing_source": { standing: "measured", rule: "R18", audit: "A22",
        note: "the prototype's wait_for_full_hand" },
    "hand.full_hand.elsewhere": { standing: "measured", audit: "A22", note: "the prototype's wait_for_full_hand; recorded at an assembling machine's output (2.1.21), not yet at a chest or a belt" },
    "hand.wait_for_full_hand": { standing: "game-data", note: "read by full_hand" },
    "hand.grab_less_to_match_belt_stack": { standing: "game-data", note: "recorded, read by nothing yet" },
    "hand.max_belt_stack_size": { standing: "game-data", note: "recorded, read by nothing yet" },

    "timing.rotation_ticks": { standing: "measured", audit: "A22", doc: "docs/rules-of-the-game.md (An inserter's swing, by its prototype and quality)",
        note: "25 prototype and quality pairs, chest to chest" },
    "timing.planned.pickup": { standing: "measured", audit: "A21, A22",
        note: "belt pickup 4 ticks for every kind, calibrated on the legendary stack inserter only" },
    "timing.planned.drop": { standing: "measured", audit: "A22", doc: "mechanics/belts.md B10" },
    "timing.planned.cycle": { standing: "derived" },
    "timing.planned.pickup_to_drop": { standing: "derived" },
    "timing.by_item.item": { standing: "label" },
    "timing.by_item.source_lanes": { standing: "label" },
    "timing.by_item.sink_lane": { standing: "label",
        note: "kept quirk (D14): the lane of the item that its hand is rounded to (inserterHands), not the lane of the config's drop spot (`sink.drop.lane`); the planner facts take an edge's lane from the drop spot" },
    "timing.by_item.floor.pickup": { standing: "measured", doc: "mechanics/inserters.md section 7; mechanics/belts.md B8, B23",
        note: "1 from a machine or chest; ceil(hand / lane stack) from a belt, null for a kind not calibrated on belts" },
    "timing.by_item.floor.drop": { standing: "measured", doc: "mechanics/belts.md B10", note: "1 into a machine or chest; ceil(hand / lane stack) onto a belt" },
    "timing.by_item.floor.cycle": { standing: "measured", audit: "A22", doc: "mechanics/inserters.md section 1",
        note: "pickup + 2 x rotation + drop, the swing rule: 8 for a legendary stack inserter from machine to machine" },
    "timing.belt_pickup_calibrated": { standing: "measured", audit: "A21", doc: "docs/belt-pickup/experiments.md", note: "one evidence row (D9)" },
    "timing.enable_latency_ticks": { standing: "measured", audit: "A18",
        note: "the circuit clock's latency, for every inserter (common/rule-constants.ts), whether or not a circuit clock drives it" },

    "throughput.capacity_group": { standing: "label", note: "the inserter: the edges of the items it carries share one capacity" },
    "throughput.by_item.item": { standing: "label" },
    "throughput.by_item.planned_per_second": { standing: "derived", note: "hand x 60 / the planned cycle" },
    "throughput.by_item.items_per_second_ceiling": { standing: "derived", doc: "mechanics/inserters.md section 1",
        note: "hand x 60 / the floor cycle, as sound as the floor; null where the floor is" },

    "loop.self_ingredients": { standing: "game-data", note: "the recipe's results it also takes; kept apart from those given (machine-state.ts)" },
    "loop.looping_ingredients": { standing: "derived", rule: "R8", note: "made at least as much of a craft as a craft takes (machine.ts)" },
    "loop.seeded": { standing: "assumed", rule: "R8",
        note: "a run gives every machine its looping ingredients, as a player seeds a loop by hand (cold-start.ts, prepare-step.ts)" },
};
