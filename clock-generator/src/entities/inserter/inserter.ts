import { InserterConfig } from "../../config";
import { FactorioDataService, ItemName } from "../../data";
import { BeltStackSize, Lane } from "../belt";
import { EntityType } from "../entity-type";
import { InserterMetadata } from "./metadata/inserter-metadata";
import { InserterAnimation } from "./inserter-animation";
import assert from "../../common/assert";
import { assertIsBelt, assertIsChest, assertIsMachine, Entity } from "../entity";
import { EntityId } from "../entity-id";
import { EntityRegistry } from "../entity-registry";
import { BeltDropMetadata } from "./metadata/animation";

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
}

/**
 * Items an inserter moves per swing of an item. A hand never holds more than the item stacks to, and an inserter
 * dropping on a belt unloads early rather than wait for a count that would leave a partial stack on the belt: an
 * item that stacks to 10 on a belt lane of 4 moves 8 per swing, not 10 (it would drop 4, 4 and 2).
 */
export function handSizeFor(inserter: Inserter, item_name: ItemName): number {
    return inserter.hand_sizes?.get(item_name) ?? inserter.metadata.stack_size;
}

function effectiveHandSize(inserter_stack_size: number, item_name: ItemName, belt_lane_stack_size?: number): number {
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
 * and the processing units first once the two lanes were swapped, with the same filters both times. The pickup mode
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
    ) { }


    public fromConfig(id: number, config: InserterConfig): Inserter {
        const source = config.source
        const sink = config.sink

        if (sink.type === EntityType.BELT && source.type === EntityType.BELT) {
            throw new Error("Source and sink cannot both be a belt ya silly goose")
        }

        const source_provided_items: Set<ItemName> = new Set()
        const sink_consumed_items: Set<ItemName> = new Set()

        if (source.type === EntityType.BELT) {
            const belt = this.entity_registry.getEntityByIdOrThrow(EntityId.forBelt(source.id));
            assertIsBelt(belt)
            belt.lanes.forEach(lane => {
                source_provided_items.add(lane.ingredient_name)
            })
        }

        if (source.type === EntityType.MACHINE) {
            const machine = this.entity_registry.getEntityByIdOrThrow(EntityId.forMachine(source.id))
            assertIsMachine(machine)
            machine.outputs.forEach(output => source_provided_items.add(output.item_name))
        }

        if (source.type === EntityType.CHEST) {
            const chest = this.entity_registry.getEntityByIdOrThrow(EntityId.forChest(source.id))
            assertIsChest(chest)
            chest.getItemFilters().forEach(item => source_provided_items.add(item))
        }

        if (sink.type === EntityType.BELT) {
            source_provided_items.forEach(it => sink_consumed_items.add(it))
        }

        if (sink.type === EntityType.MACHINE) {
            const machine = this.entity_registry.getEntityByIdOrThrow(EntityId.forMachine(sink.id))
            assertIsMachine(machine)
            machine.inputs.forEach((input) => {
                sink_consumed_items.add(input.ingredient.name)
            })
            if (machine.fuel_slot) {
                sink_consumed_items.add(machine.fuel_slot.fuel.item_name)
            }
        }

        if (sink.type === EntityType.CHEST) {
            const chest = this.entity_registry.getEntityByIdOrThrow(EntityId.forChest(sink.id))
            assertIsChest(chest)
            chest.getItemFilters().forEach(item => sink_consumed_items.add(item))
        }


        let filtered_items = new Set(Array.from(sink_consumed_items).filter(it => source_provided_items.has(it)))

        if(config.filters && config.filters.length > 0) {
            // a machine takes only its ingredients and fuel; a belt or a chest takes any item the filter names, such as
            // the spoilage an inserter clears off a machine, which no recipe lists
            config.filters.forEach(it => {
                if (sink.type === EntityType.MACHINE) {
                    assert(sink_consumed_items.has(it), `Inserter filter ${it} is not a valid item for sink entity ${sink.id} of type ${sink.type}`);
                } else {
                    // it has to be an item of the game, or the inserter would never fire
                    assert(FactorioDataService.hasItem(it), `Inserter filter ${it} is not an item of the game (sink entity ${sink.id} of type ${sink.type})`);
                }
            })
            filtered_items = new Set(config.filters);
        }

        if (source.type === EntityType.BELT && source.near_lane !== undefined) {
            const belt = this.entity_registry.getEntityByIdOrThrow(EntityId.forBelt(source.id));
            assertIsBelt(belt);
            filtered_items = nearestLaneFirst(filtered_items, belt.lanes, source.near_lane);
        }

        // Calculate belt drop metadata if sink is a belt
        let beltDropMetadata: BeltDropMetadata | undefined;
        const hand_sizes = new Map<ItemName, number>();
        if (sink.type === EntityType.BELT) {
            const belt = this.entity_registry.getEntityByIdOrThrow(EntityId.forBelt(sink.id));
            assertIsBelt(belt);
            const selectedLane = this.selectLaneForDrop(belt.lanes, filtered_items);
            filtered_items.forEach(item_name => {
                const lane = belt.lanes.find(it => it.ingredient_name === item_name) ?? selectedLane;
                hand_sizes.set(item_name, effectiveHandSize(config.stack_size, item_name, lane.stack_size));
            });
            beltDropMetadata = {
                belt_speed: belt.belt_speed,
                belt_stack_size: selectedLane.stack_size as BeltStackSize,
                inserter_stack_size: hand_sizes.get(selectedLane.ingredient_name)
                    ?? Math.min(config.stack_size, ...Array.from(hand_sizes.values()))
            };
        } else {
            filtered_items.forEach(item_name => hand_sizes.set(item_name, effectiveHandSize(config.stack_size, item_name)));
        }

        const metadata = InserterMetadata.create(
            config.source.type,
            config.sink.type,
            config.stack_size,
            config.filters ?? [],
            config.overrides?.animation ?? {},
            beltDropMetadata
        )

        return {
            entity_id: EntityId.forInserter(id),
            metadata: metadata,
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
            animation: InserterAnimation.fromMetadata(metadata.animation)
        }
    }

    /**
     * Select the lane to use for dropping items.
     * Prefers the lane matching a filtered item if found,
     * otherwise returns the lane with the maximum stack_size.
     */
    private selectLaneForDrop(lanes: readonly Lane[], filteredItems: Set<ItemName>): Lane {
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
}