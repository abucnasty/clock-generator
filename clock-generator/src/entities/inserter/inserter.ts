import { InserterConfig } from "../../config";
import { ItemName } from "../../data";
import { BeltStackSize, Lane, ReadableBeltRegistry } from "../belt";
import { EntityType } from "../entity-type";
import { ReadableMachineRegistry } from "../machine";
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
    animation: InserterAnimation;
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
            config.filters.forEach(it => {
                assert(sink_consumed_items.has(it), `Inserter filter ${it} is not a valid item for sink entity ${sink.id} of type ${sink.type}`);
            })
            filtered_items = new Set(config.filters);
        }

        // Calculate belt drop metadata if sink is a belt
        let beltDropMetadata: BeltDropMetadata | undefined;
        if (sink.type === EntityType.BELT) {
            const belt = this.entity_registry.getEntityByIdOrThrow(EntityId.forBelt(sink.id));
            assertIsBelt(belt);
            const selectedLane = this.selectLaneForDrop(belt.lanes, filtered_items);
            beltDropMetadata = {
                belt_speed: belt.belt_speed,
                belt_stack_size: selectedLane.stack_size as BeltStackSize,
                inserter_stack_size: config.stack_size
            };
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