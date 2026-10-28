import { Config, InserterConfig } from "../../config/schema";
import { fraction } from "../../data-types/fraction";
import {
    CapacityGroup,
    ContainerNode,
    DrillNode,
    EdgeFloorFacts,
    EdgeFloorStanding,
    FactsStanding,
    InserterEdge,
    InserterLandsIn,
    LaneNode,
    MachineNode,
    NodeProductionFacts,
    PlacementEdge,
    PlannerEdge,
    PlannerFacts,
    PlannerNode,
} from "../../data-types/planner-facts";
import { EntityId } from "../../entities/entity-id";
import { EntityType } from "../../entities/entity-type";
import { buildTraits, ChestTraits, ConfigTraits, DrillTraits, InserterTraits, LaneTraits, MachineTraits } from "../../entities/traits/build-traits";
import { laneKey } from "../../entities/traits/lane";
import { PlacementTrait } from "../../entities/traits/placement";
import { ProductionTrait } from "../../entities/traits/production";
import { ratioOf } from "../../entities/traits/ratio";
import { stacksOf } from "../../entities/traits/timing";
import { TRAIT_BASIS } from "../../entities/traits/trait-basis";

/** The standings, best first: a floor stands only from "measured" up (P3 2.2 item 4) */
const STANDINGS: readonly FactsStanding[] = ["measured", "game-rule", "game-data", "config", "derived", "assumed", "label"];

const FLOOR_STANDING: EdgeFloorStanding = {
    pickup: TRAIT_BASIS["timing.by_item.floor.pickup"].standing,
    drop: TRAIT_BASIS["timing.by_item.floor.drop"].standing,
    cycle: TRAIT_BASIS["timing.by_item.floor.cycle"].standing,
};

/** A floor's figure where its standing is "measured" or better, else null: nothing may refuse a build on it */
function standing(value: number | null, of: FactsStanding): number | null {
    return STANDINGS.indexOf(of) <= STANDINGS.indexOf("measured") ? value : null;
}

function productionOf(production: ProductionTrait): NodeProductionFacts {
    return { ...production, crafts_per_second: ratioOf(fraction(production.speed).divide(production.energy_required)) };
}

function machineNode(t: MachineTraits): MachineNode {
    return {
        key: t.entity, kind: "machine", entity: t.entity,
        production: productionOf(t.production),
        yield: t.yield,
        input_limits: t.input_limits,
        output_block: t.output_block,
        recipe_selection: t.recipe_selection.mode,
        placement: t.placement,
        energy: t.energy,
        spoilage: t.spoilage,
        loop: t.loop,
    };
}

function drillNode(t: DrillTraits): DrillNode {
    return {
        key: t.entity, kind: "drill", entity: t.entity,
        production: productionOf(t.production),
        yield: t.yield,
        placement: t.placement,
        energy: t.energy,
    };
}

function laneNode(t: LaneTraits): LaneNode {
    return { key: t.lane.key, kind: "lane", entity: t.entity, lane: t.lane, spoilage: t.spoilage };
}

function containerNode(t: ChestTraits): ContainerNode {
    return { key: t.entity, kind: "container", entity: t.entity, storage: t.storage, spoilage: t.spoilage };
}

/** The node key of an inserter's machine or chest end */
function endKey(end: { type: string; id: number }): string {
    return end.type === EntityType.MACHINE ? EntityId.forMachine(end.id).id : EntityId.forChest(end.id).id;
}

/** Where an item an inserter drops lands in its sink, by the sink's traits: the first input limit that names it */
function landsIn(sink: InserterConfig["sink"], item: string, traits: ConfigTraits): InserterLandsIn | null {
    if (sink.type === EntityType.BELT) return "lane";
    const node = traits[endKey(sink)];
    if (node?.kind === "machine") {
        const limit = node.input_limits.limits.find(it => it.item === item);
        return limit === undefined ? null : limit.kind === "fuel" ? "fuel" : "ingredients";
    }
    if (node?.kind === "chest") {
        const storage = node.storage;
        if (storage.input_slots?.limits.some(it => it.item === item) === true) return "input-slots";
        return storage.accepts === "any" || storage.accepts.includes(item) ? "storage" : null;
    }
    return null;
}

/**
 * The edges of an inserter, one per item it carries, in the order it takes them. The lane it takes an item from is the
 * lane of its source belt that carries the item, its nearest lane where both do; the lane it drops on is the config's
 * drop spot (`sink.drop.lane`) where it names one, else the lane its hand of the item is rounded to (timing.by_item's
 * sink lane). The floors and the ceiling are the trait's, except where the drop spot is not that lane: there the drop
 * floor is counted on the drop spot's lane, ceil(hand / the lane's stack), one stack a place, and the cycle and the
 * ceiling with it.
 */
function inserterEdges(config: InserterConfig, t: InserterTraits, traits: ConfigTraits): InserterEdge[] {
    const { source, sink } = config;
    return t.hand.by_item.map(({ item, hand }, index) => {
        const timing = t.timing.by_item[index];
        const near = source.type === EntityType.BELT && source.near_lane !== undefined ? laneKey(source.id, source.near_lane) : null;
        const from = source.type !== EntityType.BELT ? endKey(source)
            : near !== null && timing.source_lanes.includes(near) ? near
                : timing.source_lanes[0] ?? laneKey(source.id, source.near_lane ?? 1);
        const to = sink.type !== EntityType.BELT ? endKey(sink)
            : sink.drop !== undefined ? laneKey(sink.id, sink.drop.lane)
                : timing.sink_lane ?? laneKey(sink.id, 1);
        // a drop spot on another lane than the one the trait times the drop on
        const moved = sink.type === EntityType.BELT && to !== timing.sink_lane;
        const pickup = standing(timing.floor.pickup, FLOOR_STANDING.pickup);
        const drop = standing(moved ? stacksOf(hand, (traits[to] as LaneTraits).lane.stack) : timing.floor.drop, FLOOR_STANDING.drop);
        const floor: EdgeFloorFacts = {
            pickup,
            drop,
            cycle: standing(pickup === null || drop === null ? null : moved ? pickup + 2 * t.timing.rotation_ticks + drop : timing.floor.cycle,
                FLOOR_STANDING.cycle),
        };
        const { prototype, quality, nominal, research, items, full_hand, wait_for_full_hand, grab_less_to_match_belt_stack, max_belt_stack_size } = t.hand;
        return {
            key: `${t.entity}/${item}`,
            via: "inserter",
            entity: t.entity,
            group: t.throughput.capacity_group,
            item,
            from,
            to,
            from_lanes: [...timing.source_lanes],
            lands_in: landsIn(sink, item, traits),
            hand: { prototype, quality, by_item: hand, nominal, research, items, full_hand, wait_for_full_hand, grab_less_to_match_belt_stack, max_belt_stack_size },
            rotation_ticks: t.timing.rotation_ticks,
            planned: { ...t.timing.planned, per_second: t.throughput.by_item[index].planned_per_second },
            floor,
            floor_standing: { ...FLOOR_STANDING },
            ceiling: floor.cycle === null ? null
                : moved ? ratioOf(fraction(hand * 60).divide(floor.cycle)) : t.throughput.by_item[index].items_per_second_ceiling,
            belt_pickup_calibrated: t.timing.belt_pickup_calibrated,
            enable_latency_ticks: t.timing.enable_latency_ticks,
        };
    });
}

/** The edges of a placer into its target, one per result; none for a placer without a target, which keeps its results */
function placementEdges(entity: string, placement: PlacementTrait | null): PlacementEdge[] {
    if (placement === null || placement.target === null) return [];
    const target = placement.target;
    return placement.per_result.map(result => ({
        key: `placement:${entity}/${result.item}`,
        via: "placement",
        entity,
        item: result.item,
        from: entity,
        to: target,
        lands_in: result.lands_in,
        into_machine_stop: result.into_machine_stop,
        mechanism: placement.mechanism,
        ceiling: null,
    }));
}

/**
 * The planner facts of a config: its traits (buildTraits) as nodes and edges. A projection of the traits and of the
 * config's layout (which entity an inserter takes from and drops into, where it drops on a belt); it reads no entity or
 * component state, and nothing in a generation calls it yet.
 */
export function toPlannerFacts(config: Config): PlannerFacts {
    const traits = buildTraits(config);
    const nodes: PlannerNode[] = [
        ...config.belts.flatMap(belt => ([1, 2] as const).map(lane => laneNode(traits[laneKey(belt.id, lane)] as LaneTraits))),
        ...config.machines.map(machine => machineNode(traits[EntityId.forMachine(machine.id).id] as MachineTraits)),
        ...(config.chests ?? []).map(chest => containerNode(traits[EntityId.forChest(chest.id).id] as ChestTraits)),
        ...(config.drills?.configs ?? []).map(drill => drillNode(traits[EntityId.forDrill(drill.id).id] as DrillTraits)),
    ];

    const inserter_edges = config.inserters.map((inserter, index) =>
        inserterEdges(inserter, traits[EntityId.forInserter(inserter.id ?? index + 1).id] as InserterTraits, traits));
    const edges: PlannerEdge[] = [
        ...inserter_edges.flat(),
        ...nodes.flatMap(node => node.kind === "machine" || node.kind === "drill" ? placementEdges(node.entity, node.placement) : []),
    ];
    const capacity_groups: CapacityGroup[] = inserter_edges.filter(group => group.length > 0).map(group => ({
        group: group[0].group,
        edges: group.map(edge => ({ edge: edge.key, item: edge.item, hand: edge.hand.by_item, floor_cycle: edge.floor.cycle })),
    }));

    const target = config.target_output;
    return {
        schema: 1,
        target: {
            item: target.recipe,
            counts: target.counts ?? "made",
            items_per_second: target.items_per_second,
            copies: target.copies,
            per_copy: ratioOf(fraction(target.items_per_second).divide(target.copies)),
        },
        nodes,
        edges,
        capacity_groups,
    };
}
