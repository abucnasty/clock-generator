/**
 * The planner facts of a build (toPlannerFacts, crafting/facts/to-planner-facts.ts): a projection of its traits
 * (entities/traits/build-traits.ts) as plain, JSON-safe nodes and edges, the input of the planner graph and the
 * feasibility pass. This module imports nothing, so a page can take the types from the light entry.
 *
 * Two kinds of figure are kept apart:
 * - planned: today's figure, as the strategies compute it (`planned` of an inserter edge);
 * - floor and ceiling: the true bound, the fastest the entity ever goes in the simulator and the game (`floor`,
 *   `ceiling`). A floor whose standing is below "measured" is null, and nothing may refuse a build on a null.
 *
 * Node trait fields are the traits' field for field (the test of to-planner-facts holds the types equal); an inserter
 * edge carries the hand and timing of its one item. The facts are read-only: a node's trait fields are the objects of
 * the traits built for that call, so a reader that changes one changes them for every reader of the same facts.
 */

/** An exact rate or amount: numerator over denominator */
export interface FactsRatio {
    readonly numerator: number;
    readonly denominator: number;
}

/** How well a figure stands, best first (entities/traits/trait-basis.ts) */
export type FactsStanding = "measured" | "game-rule" | "game-data" | "config" | "derived" | "assumed" | "label";

// ---------------------------------------------------------------------------------------------------------------------
// Node traits, as entities/traits/ builds them
// ---------------------------------------------------------------------------------------------------------------------

export interface ProductionFacts {
    readonly kind: "recipe" | "resource";
    readonly recipe_or_resource: string;
    readonly prototype: string | null;
    readonly prototype_type: string | null;
    readonly speed: number;
    readonly energy_required: number;
    readonly ticks_per_craft: number;
    readonly crafts_per_tick: number;
    readonly productivity: number;
    readonly bonus_per_craft: number | null;
    readonly ticks_per_bonus: number | null;
    readonly inputs: readonly { readonly item: string; readonly per_craft: number; readonly per_second: number; readonly per_tick: number }[];
    readonly insertion_duration_ticks: number | null;
}

export interface YieldFacts {
    readonly results: readonly {
        readonly item: string;
        readonly amount: number;
        readonly probability: number;
        readonly extra_count_fraction: number;
        readonly ignored_by_productivity: number;
        readonly expected_per_craft: number;
        readonly per_second: FactsRatio;
        readonly main: boolean;
        readonly stochastic: boolean;
    }[];
    readonly carry: "expected-with-carry" | "whole-items";
    readonly payouts_count_as_finishes: boolean | null;
}

export interface InputLimitsFacts {
    readonly overload_multiplier: number;
    readonly limits: readonly { readonly item: string; readonly limit: number; readonly kind: "ingredient" | "fuel" | "silo-input" }[];
}

export interface OutputBlockFacts {
    readonly rule: "overload" | "stack";
    readonly per_result: readonly {
        readonly item: string;
        readonly rule: "overload" | "stack";
        readonly ingredients_blocked_at: number;
        readonly held_limit: number;
        readonly stack: number;
    }[];
}

/** Where a result a placer places lands in its target; null where the target takes none (it stays in the placer) */
export type PlacementLandsIn = "ingredients" | "storage" | "input-slots";

export interface PlacementFacts {
    readonly mechanism: "result-placement" | "mining-drop";
    readonly vector_to_place_result: readonly [number, number];
    readonly target: string | null;
    readonly per_result: readonly { readonly item: string; readonly lands_in: PlacementLandsIn | null; readonly into_machine_stop: number | null }[];
    readonly into_container: "room";
    readonly phase: "before-mining" | "before-and-after-craft";
    readonly stops_while_stack_waits: boolean;
}

export interface StorageFacts {
    readonly kind: "single-item" | "slots" | "weight" | "constant";
    readonly chest_type: string;
    readonly capacity_by_item: readonly { readonly item: string; readonly capacity: number | null }[];
    readonly accepts: "any" | readonly string[];
    readonly gives: readonly string[];
    readonly items_put_in: readonly string[];
    readonly never_refuses: boolean;
    readonly constant_supply: boolean;
    readonly slots: number | null;
    readonly input_slots: InputLimitsFacts | null;
}

export interface LaneFacts {
    readonly key: string;
    readonly belt: string;
    readonly lane: 1 | 2;
    readonly listed: boolean;
    /** The item the lane carries; "" for a listed lane that carries nothing, null for the unlisted second side: both are no item */
    readonly item: string | null;
    readonly stack: number;
    readonly belt_prototype: string;
    readonly tiles_per_tick: number;
    readonly belt_speed: number;
    readonly items_per_second_ceiling: FactsRatio;
    readonly supply: "moving" | "backed_up";
    /**
     * What consumers outside the config take off this lane a second. The demand to check is per belt and item: the sum
     * over the belt's lanes that carry the item, filled by every edge onto any of those lanes (crafting/export-delivery.ts)
     */
    readonly export_per_second: number | null;
}

export interface EnergyFacts {
    readonly source: "electric" | "burner" | "heat" | "fluid" | "void" | null;
    readonly energy_usage_kw: number | null;
    readonly energy_bonus: number;
    readonly burner: {
        readonly fuel_categories: readonly string[];
        readonly effectivity: number;
        readonly fuel_inventory_size: number;
        readonly fuels: readonly { readonly item: string; readonly fuel_value_mj: number }[];
    } | null;
    readonly fuel_modelled: boolean;
    readonly fuel: {
        readonly item: string;
        readonly fuel_value_mj: number;
        readonly per_craft: number;
        readonly per_second: number;
        readonly per_tick: number;
        readonly slot_limit: number;
        readonly energy_per_craft_mj: number;
    } | null;
}

export interface SpoilageFacts {
    readonly items: readonly {
        readonly item: string;
        readonly spoil_ticks: number;
        readonly quality_affects_spoil_ticks: boolean;
        readonly spoil_result: string | null;
    }[];
    readonly loss_limit_share: number;
}

export interface LoopFacts {
    readonly self_ingredients: readonly string[];
    readonly looping_ingredients: readonly string[];
    readonly seeded: boolean;
}

// ---------------------------------------------------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------------------------------------------------

/**
 * A machine's or a drill's production, with the most crafts it makes a second: speed / energy required, exact in the
 * configured float (a speed of 112.244 is the float's 112.244...001, not the decimal the config wrote)
 */
export interface NodeProductionFacts extends ProductionFacts {
    readonly crafts_per_second: FactsRatio;
}

/** A crafting machine, "machine:3" */
export interface MachineNode {
    readonly key: string;
    readonly kind: "machine";
    readonly entity: string;
    readonly production: NodeProductionFacts;
    readonly yield: YieldFacts;
    readonly input_limits: InputLimitsFacts;
    readonly output_block: OutputBlockFacts;
    readonly recipe_selection: "fixed" | "by-input";
    /** Only for a machine that places its results itself */
    readonly placement: PlacementFacts | null;
    readonly energy: EnergyFacts;
    readonly spoilage: SpoilageFacts;
    readonly loop: LoopFacts;
}

/** A mining drill, "drill:1": a source that places what it mines */
export interface DrillNode {
    readonly key: string;
    readonly kind: "drill";
    readonly entity: string;
    readonly production: NodeProductionFacts;
    readonly yield: YieldFacts;
    readonly placement: PlacementFacts;
    readonly energy: EnergyFacts;
}

/** One side of a belt, "belt:2/lane:1"; `entity` is the belt. A belt that lists one lane has a second side too */
export interface LaneNode {
    readonly key: string;
    readonly kind: "lane";
    readonly entity: string;
    readonly lane: LaneFacts;
    readonly spoilage: SpoilageFacts;
}

/** A chest, buffer, infinity chest, car, tank, wagon or rocket silo, "chest:4" */
export interface ContainerNode {
    readonly key: string;
    readonly kind: "container";
    readonly entity: string;
    readonly storage: StorageFacts;
    readonly spoilage: SpoilageFacts;
}

export type PlannerNode = MachineNode | DrillNode | LaneNode | ContainerNode;

// ---------------------------------------------------------------------------------------------------------------------
// Edges
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Where an inserter's item lands in its sink: a machine's ingredients or fuel slot, a container, a silo's input slots, a
 * lane. An item that is both an ingredient and the machine's fuel is "ingredients", and it feeds the fuel too: fuel
 * comes by edge wherever an in-edge carries the machine's `energy.fuel.item`, whatever its `lands_in`.
 */
export type InserterLandsIn = "ingredients" | "fuel" | "storage" | "input-slots" | "lane";

/** An inserter's hand of one item it carries, beside the inserter's other hands (P3 2.3) */
export interface EdgeHandFacts {
    readonly prototype: string;
    readonly quality: string;
    /** The hand the simulator moves of this item: the nominal hand cut to its stack, rounded to whole belt stacks on a drop */
    readonly by_item: number;
    /** The config's `stack_size`, else the research hand: what the game reads as the inserter's stack size */
    readonly nominal: number;
    /** 1, plus the prototype's bonus, plus the research of its kind */
    readonly research: number;
    /** Every item the inserter carries, in the order it takes them */
    readonly items: readonly string[];
    readonly full_hand: { readonly at_placing_source: boolean; readonly elsewhere: boolean };
    readonly wait_for_full_hand: boolean;
    readonly grab_less_to_match_belt_stack: boolean;
    readonly max_belt_stack_size: number;
}

/** Ticks of a swing of the item as today's strategies plan it, and what that moves a second */
export interface EdgePlannedFacts {
    readonly pickup: number;
    readonly drop: number;
    readonly cycle: number;
    readonly pickup_to_drop: number;
    /** hand x 60 / the planned cycle */
    readonly per_second: FactsRatio;
}

/** The fewest ticks the pickup, drop and swing of the item take; null where no sound bound is known */
export interface EdgeFloorFacts {
    readonly pickup: number | null;
    readonly drop: number | null;
    readonly cycle: number | null;
}

/** The standing of each floor figure (trait-basis.ts); a floor below "measured" is null */
export interface EdgeFloorStanding {
    readonly pickup: FactsStanding;
    readonly drop: FactsStanding;
    readonly cycle: FactsStanding;
}

/** An inserter and one item it carries, "inserter:5/iron-plate"; the edges of one inserter share its capacity group */
export interface InserterEdge {
    readonly key: string;
    readonly via: "inserter";
    /** The inserter, "inserter:5" */
    readonly entity: string;
    /** The capacity group: the edges of one inserter swing for one item at a time */
    readonly group: string;
    readonly item: string;
    /** The node it takes from: a machine, a container, or the lane of its source belt that carries the item */
    readonly from: string;
    /** The node it drops into: a machine, a container, or the lane of its sink belt it drops on */
    readonly to: string;
    /** Every lane of its source belt that carries the item (`from` is one of them); empty for a machine or container source */
    readonly from_lanes: readonly string[];
    /** Where the item lands in the sink; null where the sink takes none of it */
    readonly lands_in: InserterLandsIn | null;
    readonly hand: EdgeHandFacts;
    readonly rotation_ticks: number;
    readonly planned: EdgePlannedFacts;
    readonly floor: EdgeFloorFacts;
    readonly floor_standing: EdgeFloorStanding;
    /** The most of the item it moves a second: hand x 60 / floor cycle, exact; null where the floor cycle is */
    readonly ceiling: FactsRatio | null;
    readonly belt_pickup_calibrated: boolean;
    readonly enable_latency_ticks: number;
}

/**
 * A placer (a machine that places its results itself, or a drill) and one result, "placement:drill:1/iron-ore". It has
 * no bound of its own: the source's production bounds it.
 */
export interface PlacementEdge {
    readonly key: string;
    readonly via: "placement";
    /** The placer */
    readonly entity: string;
    readonly item: string;
    readonly from: string;
    /** The machine or container it places into */
    readonly to: string;
    readonly lands_in: PlacementLandsIn | null;
    /** Into a machine: the stop it fills the ingredient to; null elsewhere */
    readonly into_machine_stop: number | null;
    readonly mechanism: "result-placement" | "mining-drop";
    readonly ceiling: null;
}

export type PlannerEdge = InserterEdge | PlacementEdge;

/**
 * The swing budget of one inserter (P3 2.2 item 5): its edges together obey
 * sum over edges of rate x floor_cycle / (60 x hand) <= 1
 */
export interface CapacityGroup {
    readonly group: string;
    readonly edges: readonly { readonly edge: string; readonly item: string; readonly hand: number; readonly floor_cycle: number | null }[];
}

/** What the build's target rate counts, of which item, in all and per copy */
export interface PlannerTarget {
    readonly item: string;
    readonly counts: "made" | "destroyed";
    readonly items_per_second: number;
    readonly copies: number;
    readonly per_copy: FactsRatio;
}

export interface PlannerFacts {
    readonly schema: 1;
    readonly target: PlannerTarget;
    /**
     * Lanes (by belt), machines, containers and drills: the entity registry's order (crafting/sequence/simulation-context.ts)
     * with the inserters, which are edges, left out. Ties are broken by this order
     */
    readonly nodes: readonly PlannerNode[];
    /** Inserter edges in the config's order, each inserter's in the order it takes its items; then placement edges */
    readonly edges: readonly PlannerEdge[];
    /** One per inserter, in the order of the edges */
    readonly capacity_groups: readonly CapacityGroup[];
}
