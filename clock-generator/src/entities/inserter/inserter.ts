import { BeltPickupLayout, pickupLengthForLayout, pickupLayoutProblem } from "../../common/belt-pickup-layout";
import { assertPickupCaptureSupported } from "../../config/pickup-capture";
import { assertInserterInScope } from "../../config/inserter-scope";
import { InserterConfig } from "../../config";
import { FactorioDataService, ItemName } from "../../data";
import { BeltStackSize, Lane } from "../belt";
import { EntityType } from "../entity-type";
import { InserterMetadata } from "./metadata/inserter-metadata";
import { InserterAnimation } from "./inserter-animation";
import assert from "../../common/assert";
import { assertIsBelt, assertIsChest, assertIsMachine, Entity } from "../entity";
import { Chest } from "../chest";
import { EntityId } from "../entity-id";
import { EntityRegistry } from "../entity-registry";
import { BeltDropMetadata } from "./metadata/animation";
import { assertSupportedInserterKind, bendRightUpstreamCalibrated, configuredHandSize } from "./metadata/inserter-spec";
import { DEFAULT_INSERTER_QUALITY, InserterType } from "./metadata/inserter-type";
import { machineRecipeSelection } from "../machine/machine";

export interface InserterTarget {
    item_names: Set<ItemName>;
    entity_id: EntityId;
}


export interface Inserter extends Entity {
    metadata: InserterMetadata;
    sink: InserterTarget;
    source: InserterTarget;
    filtered_items: Set<ItemName>;
    /** Items per hand for each item it carries; see handSizeFor */
    hand_sizes?: ReadonlyMap<ItemName, number>;
    animation: InserterAnimation;
    /** Where it drops on a shared output lane; omitted geometry uses an independent local tile with retained stock */
    drop?: BeltDropSpot;
    /** Physical exposed length of a belt input, retained for both moving and backed-up supply. */
    pickup_length?: 0.5 | 1;
    pickup_layout?: BeltPickupLayout;
    /** Belt availability is independent of geometry; absent only for non-belt sources. */
    belt_supply?: "moving" | "backed_up";
    /** Physical input lane to try first, including when both lanes carry the same item. */
    near_lane?: 1 | 2;
}

/** Of an inserter that drops on a belt: the lane and the tiles along the belt (see InserterConfig) */
export interface BeltDropSpot {
    lane: 1 | 2;
    position: number;
}

/**
 * Items an inserter moves per swing of an item. A hand never holds more than the item stacks to, and an inserter
 * dropping on a belt unloads early rather than wait for a count that would leave a partial stack on the belt: an
 * item that stacks to 10 on a belt lane of 4 moves 8 per swing, not 10 (it would drop 4, 4 and 2).
 */
export function handSizeFor(inserter: Inserter, item_name: ItemName): number {
    return inserter.hand_sizes?.get(item_name) ?? inserter.metadata.stack_size;
}

export function effectiveHandSize(inserter_stack_size: number, item_name: ItemName, belt_lane_stack_size?: number): number {
    let item_stack_size = Number.POSITIVE_INFINITY;
    try {
        item_stack_size = FactorioDataService.findItemOrThrow(item_name).stack_size;
    } catch {
        // an item the data does not know has no stack size to limit the hand
    }
    const capacity = Math.min(inserter_stack_size, item_stack_size);
    if (belt_lane_stack_size === undefined || capacity < belt_lane_stack_size) {
        return capacity;
    }
    return Math.floor(capacity / belt_lane_stack_size) * belt_lane_stack_size;
}

/**
 * The items of an inserter in the order it takes them off a belt (GOALS.md, "What an inserter takes off a belt first").
 * As recorded in the game, an inserter with nothing in its hand takes from the lane nearest to it when its sink takes
 * what is on both lanes, and from the far lane only when the sink takes nothing more of the near one. The order of its
 * filters has no say in it. Recorded on the utility science scaffold in Factorio 2.1.21: the inserter that brings
 * processing units and low density structures took the low density structures first while they were on its near lane,
 * and the processing units first once the two lanes were swapped, with the same filters both times. The pickup phase
 * takes the first item of this order its sink still takes.
 */
export function nearestLaneFirst(items: Set<ItemName>, lanes: readonly Lane[], near_lane: 1 | 2): Set<ItemName> {
    const near_item = lanes[near_lane - 1]?.ingredient_name;
    if (near_item === undefined || !items.has(near_item)) {
        return items;
    }
    return new Set([near_item, ...items]);
}

export class InserterFactory {
    constructor(
        public readonly entity_registry: EntityRegistry,
        private readonly belt_supply: "moving" | "backed_up" = "moving",
    ) { }


    public fromConfig(id: number, config: InserterConfig): Inserter {
        const source = config.source
        const sink = config.sink
        assertPickupCaptureSupported(id, source);

        // its hand is the one that all the research gives its prototype unless the config sets the stack size
        const { prototype, quality } = inserterKindOf(config)
        assertSupportedInserterKind(prototype, quality)
        assertInserterInScope(id, config)
        const stack_size = configuredHandSize(config)

        if (sink.type === EntityType.BELT && source.type === EntityType.BELT) {
            throw new Error("Source and sink cannot both be a belt ya silly goose")
        }

        if (source.type === EntityType.BELT) {
            const belt = this.entity_registry.getEntityByIdOrThrow(EntityId.forBelt(source.id));
            assertIsBelt(belt)
            assert(source.pickup_layout !== "bend-right-upstream" || bendRightUpstreamCalibrated(belt.belt_speed),
                "Right-bend upstream pickup timing is calibrated for turbo belts only.");
        }

        const { source_items: source_provided_items, sink_items: sink_consumed_items } = inserterEndItems(source, sink, this.end_view);

        if (sink.type === EntityType.CHEST) {
            const chest = this.entity_registry.getEntityByIdOrThrow(EntityId.forChest(sink.id))
            assertIsChest(chest)
            assert(!Chest.isInfinityChest(chest) || chest.item_filters.length > 0 || chest.remove_unfiltered_items,
                `Chest ${sink.id}: enable Remove unfiltered items to use an empty infinity chest as an output, or configure a filter.`);
        }

        if(config.filters && config.filters.length > 0) {
            // a machine takes only its ingredients and fuel; a belt or a chest takes any item the filter names, such as
            // the spoilage an inserter clears off a machine, which no recipe lists
            config.filters.forEach(it => {
                if (sink.type === EntityType.MACHINE) {
                    const machine = this.entity_registry.getEntityByIdOrThrow(EntityId.forMachine(sink.id));
                    assertIsMachine(machine);
                    // a furnace (a recycler too) picks its recipe from what it is brought (its RecipeSelection trait, by its
                    // prototype's class): another item would switch it
                    assert(sink_consumed_items.has(it) || machineRecipeSelection(machine).mode !== "by-input",
                        `Inserter ${config.id} brings ${it} into Machine ${sink.id}, which makes ${machine.metadata.recipe.name} from `
                        + `${Array.from(machine.inputs.keys()).join(" and ")}. A furnace or a recycler picks its recipe from the items it is `
                        + "brought, so it would switch to another recipe for this one, with what the old one left in it: a build that "
                        + "brings it more than its recipe's items is not planned.");
                    assert(sink_consumed_items.has(it), `Inserter filter ${it} is not a valid item for sink entity ${sink.id} of type ${sink.type}`);
                } else {
                    // it has to be an item of the game, or the inserter would never fire
                    assert(FactorioDataService.hasItem(it), `Inserter filter ${it} is not an item of the game (sink entity ${sink.id} of type ${sink.type})`);
                }
            })
            if (sink.type === EntityType.CHEST) {
                const chest = this.entity_registry.getEntityByIdOrThrow(EntityId.forChest(sink.id));
                assertIsChest(chest);
                if (Chest.isInfinityChest(chest)) config.filters.forEach(item =>
                    assert(chest.acceptsItem(item), `Chest ${sink.id} does not accept ${item}. Enable Remove unfiltered items or configure that item in the chest.`));
            }
        }

        const filtered_items = carriedItems(source_provided_items, sink_consumed_items, config.filters,
            source.type === EntityType.BELT && source.near_lane !== undefined
                ? { lanes: this.end_view.beltLanes(source.id), near_lane: source.near_lane } : undefined);

        // Calculate belt drop metadata if sink is a belt
        let beltDropMetadata: BeltDropMetadata | undefined;
        let hand_sizes: Map<ItemName, number>;
        let drop_spot: BeltDropSpot | undefined;
        if (sink.type === EntityType.BELT) {
            const belt = this.entity_registry.getEntityByIdOrThrow(EntityId.forBelt(sink.id));
            assertIsBelt(belt);
            drop_spot = sink.drop;
            if (drop_spot !== undefined) {
                assert(drop_spot.lane <= belt.lanes.length, `Inserter ${id} drops on lane ${drop_spot.lane} of belt ${sink.id}, which has ${belt.lanes.length}`);
            }
            const hands = inserterHands(stack_size, filtered_items, belt.lanes);
            hand_sizes = hands.hand_sizes;
            beltDropMetadata = {
                belt_speed: belt.belt_speed,
                belt_stack_size: hands.belt_drop!.belt_stack_size,
                inserter_stack_size: hands.belt_drop!.inserter_stack_size,
            };
        } else {
            hand_sizes = inserterHands(stack_size, filtered_items).hand_sizes;
        }

        const metadata = InserterMetadata.create(
            config.source.type,
            config.sink.type,
            stack_size,
            config.filters ?? [],
            config.overrides?.animation ?? {},
            beltDropMetadata,
            { prototype, quality }
        )

        const inserter: Inserter = {
            entity_id: EntityId.forInserter(id),
            metadata,
            source: {
                entity_id: EntityId.forEntity(source.id, source.type),
                item_names: source_provided_items
            },
            sink: {
                entity_id: EntityId.forEntity(sink.id, sink.type),
                item_names: sink_consumed_items
            },
            filtered_items,
            hand_sizes,
            animation: InserterAnimation.fromMetadata(metadata.animation),
        }

        if (source.type === EntityType.BELT) {
            if (source.near_lane !== undefined) {
                inserter.near_lane = source.near_lane;
            }
            const layout_problem = pickupLayoutProblem(source);
            assert(layout_problem === null, layout_problem ?? "Invalid pickup layout");
            inserter.pickup_layout = source.pickup_layout ?? "side-straight";
            inserter.pickup_length = source.pickup_length ?? pickupLengthForLayout(inserter.pickup_layout);
            inserter.belt_supply = this.belt_supply;
        }

        if (drop_spot !== undefined) {
            inserter.drop = drop_spot;
        }

        return inserter;
    }

    /** The ends of an inserter as the entities of the registry give them */
    private readonly end_view: InserterEndView = {
        beltLanes: id => {
            const belt = this.entity_registry.getEntityByIdOrThrow(EntityId.forBelt(id));
            assertIsBelt(belt);
            return belt.lanes;
        },
        machineOutputs: id => {
            const machine = this.entity_registry.getEntityByIdOrThrow(EntityId.forMachine(id));
            assertIsMachine(machine);
            return machine.outputs.map(output => output.item_name);
        },
        machineInputs: id => {
            const machine = this.entity_registry.getEntityByIdOrThrow(EntityId.forMachine(id));
            assertIsMachine(machine);
            const items = Array.from(machine.inputs.values(), input => input.ingredient.name);
            return machine.fuel_slot ? [...items, machine.fuel_slot.fuel.item_name] : items;
        },
        chestGives: id => {
            const chest = this.entity_registry.getEntityByIdOrThrow(EntityId.forChest(id));
            assertIsChest(chest);
            return chest.getItemFilters();
        },
        chestAccepts: (id, item) => {
            const chest = this.entity_registry.getEntityByIdOrThrow(EntityId.forChest(id));
            assertIsChest(chest);
            return chest.acceptsItem(item);
        },
    };
}

/** The prototype and quality of an inserter of the config: the legendary stack inserter unless the config names another */
export function inserterKindOf(config: Pick<InserterConfig, "prototype" | "quality">): { prototype: InserterType; quality: NonNullable<InserterConfig["quality"]> } {
    return { prototype: config.prototype ?? InserterType.STACK_INSERTER, quality: config.quality ?? DEFAULT_INSERTER_QUALITY };
}

/**
 * What an inserter's ends give and take, by the id of each in the config: the factory reads them off the entities of the
 * registry, the traits (entities/traits) off theirs, and inserterEndItems works out the items from them for both
 */
export interface InserterEndView {
    beltLanes(id: number): readonly Lane[];
    /** The items a machine makes, its main product first */
    machineOutputs(id: number): readonly ItemName[];
    /** The items a machine takes: its ingredients, then the fuel it burns */
    machineInputs(id: number): readonly ItemName[];
    chestGives(id: number): readonly ItemName[];
    chestAccepts(id: number, item: ItemName): boolean;
}

/**
 * The items an inserter's source gives (a belt's lanes, a machine's products, a chest's items), and those of them its
 * sink takes: all of them onto a belt, a machine's ingredients and fuel (whatever the source gives), what a chest accepts
 */
export function inserterEndItems(
    source: Pick<InserterConfig["source"], "type" | "id">,
    sink: Pick<InserterConfig["sink"], "type" | "id">,
    view: InserterEndView,
): { source_items: Set<ItemName>; sink_items: Set<ItemName> } {
    const source_items: Set<ItemName> = new Set()
    const sink_items: Set<ItemName> = new Set()

    if (source.type === EntityType.BELT) {
        view.beltLanes(source.id).forEach(lane => source_items.add(lane.ingredient_name))
    }
    if (source.type === EntityType.MACHINE) {
        view.machineOutputs(source.id).forEach(item => source_items.add(item))
    }
    if (source.type === EntityType.CHEST) {
        view.chestGives(source.id).forEach(item => source_items.add(item))
    }

    if (sink.type === EntityType.BELT) {
        source_items.forEach(it => sink_items.add(it))
    }
    if (sink.type === EntityType.MACHINE) {
        view.machineInputs(sink.id).forEach(item => sink_items.add(item))
    }
    if (sink.type === EntityType.CHEST) {
        source_items.forEach(item => { if (view.chestAccepts(sink.id, item)) sink_items.add(item); })
    }
    return { source_items, sink_items };
}

/**
 * The items an inserter carries: those its sink takes of what its source gives, or its filters where it has any, in
 * the order it takes them off a belt when it names the lane nearest to it (nearestLaneFirst)
 */
export function carriedItems(
    source_items: ReadonlySet<ItemName>,
    sink_items: ReadonlySet<ItemName>,
    filters: readonly ItemName[] | undefined,
    near?: { lanes: readonly Lane[]; near_lane: 1 | 2 },
): Set<ItemName> {
    let filtered_items = new Set(Array.from(sink_items).filter(it => source_items.has(it)))
    if (filters && filters.length > 0) {
        filtered_items = new Set(filters);
    }
    if (near !== undefined) {
        filtered_items = nearestLaneFirst(filtered_items, near.lanes, near.near_lane);
    }
    return filtered_items;
}

/**
 * An inserter's hand for each item it carries (effectiveHandSize), and when it drops on a belt the lane its drop is
 * timed on with the hand it drops there, and the lane each item's hand is rounded to: the lane that carries the item,
 * else that one
 */
export function inserterHands(
    stack_size: number,
    filtered_items: ReadonlySet<ItemName>,
    sink_lanes?: readonly Lane[],
): {
    hand_sizes: Map<ItemName, number>;
    belt_drop?: { lane: Lane; belt_stack_size: BeltStackSize; inserter_stack_size: number; lane_of: Map<ItemName, Lane> };
} {
    const hand_sizes = new Map<ItemName, number>();
    if (sink_lanes === undefined) {
        filtered_items.forEach(item_name => hand_sizes.set(item_name, effectiveHandSize(stack_size, item_name)));
        return { hand_sizes };
    }
    const selectedLane = selectLaneForDrop(sink_lanes, filtered_items);
    const lane_of = new Map<ItemName, Lane>();
    filtered_items.forEach(item_name => {
        const lane = sink_lanes.find(it => it.ingredient_name === item_name) ?? selectedLane;
        lane_of.set(item_name, lane);
        hand_sizes.set(item_name, effectiveHandSize(stack_size, item_name, lane.stack_size));
    });
    return {
        hand_sizes,
        belt_drop: {
            lane: selectedLane,
            lane_of,
            belt_stack_size: selectedLane.stack_size as BeltStackSize,
            inserter_stack_size: hand_sizes.get(selectedLane.ingredient_name)
                ?? Math.min(stack_size, ...Array.from(hand_sizes.values())),
        },
    };
}

/**
 * Select the lane to use for dropping items.
 * Prefers the lane matching a filtered item if found,
 * otherwise returns the lane with the maximum stack_size.
 */
function selectLaneForDrop(lanes: readonly Lane[], filteredItems: ReadonlySet<ItemName>): Lane {
    // Try to find a lane matching any of the filtered items
    for (const lane of lanes) {
        if (filteredItems.has(lane.ingredient_name)) {
            return lane;
        }
    }

    // Fallback: return the lane with the maximum stack size
    return lanes.reduce((maxLane, lane) => 
        lane.stack_size > maxLane.stack_size ? lane : maxLane
    );
}
