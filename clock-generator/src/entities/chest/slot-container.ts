import { SlotContainerType } from "../../common/entity-types";
import { isBlockedSlotFilter } from "../../common/slot-filter";
import { SlotContainerConfig, SlotContentConfig } from "../../config/schema";
import { FactorioDataService, ItemName } from "../../data";
import { EntityId } from "../entity-id";
import { Chest } from "./chest";

/**
 * A car, a tank or a cargo wagon standing still, taken as a chest: slots of the size the game data gives its prototype
 * (a cargo wagon's by its quality), each free or filtered to one item, holding mixed items. Its prototype is the one its
 * type names. An inserter's swing to and from it is the same as to any chest.
 */
export class SlotContainer implements Chest {
    public static fromConfig = fromConfig;

    constructor(
        public readonly entity_id: EntityId,
        public readonly chest_type: SlotContainerType,
        public readonly quality: string,
        /** One entry per slot: the item it is filtered to, or null for a free slot */
        public readonly slot_filters: readonly (ItemName | null)[],
        /** What it holds when the build starts, by slot (from 1) */
        public readonly contents: readonly SlotContentConfig[],
        /** The items the build's inserters put into it */
        public readonly items_put_in: readonly ItemName[],
    ) { }

    public get slot_count(): number {
        return this.slot_filters.length;
    }

    /** The most of the item it holds, the other items aside */
    public getCapacity(item?: ItemName): number {
        const capacity = (name: ItemName) => this.slot_filters.filter(filter => filter === null || filter === name).length
            * FactorioDataService.findItemOrThrow(name).stack_size;
        if (item !== undefined) {
            if (isBlockedSlotFilter(item)) return 0;
            return capacity(item);
        }
        return Math.max(0, ...this.getItemFilters().map(capacity));
    }

    /** The items it can give: what it starts with, what its slots are filtered to and what the build puts into it */
    public getItemFilters(): ItemName[] {
        const items = [
            ...this.contents.map(content => content.item),
            ...this.slot_filters.filter((filter): filter is ItemName => filter !== null),
            ...this.items_put_in,
        ];
        return Array.from(new Set(items)).filter(item => !isBlockedSlotFilter(item));
    }

    /** Any item of the game with a slot it may go into */
    public acceptsItem(item: ItemName): boolean {
        return !isBlockedSlotFilter(item) && FactorioDataService.hasItem(item) && this.slot_filters.some(filter => filter === null || filter === item);
    }

    public toString(): string {
        return `${this.chest_type}(${this.entity_id.id}, ${this.quality}, ${this.slot_count} slots)`;
    }
}

function fromConfig(config: SlotContainerConfig, items_put_in: readonly ItemName[] = []): SlotContainer {
    const quality = ("quality" in config ? config.quality : undefined) ?? "normal";
    const slots = FactorioDataService.containerSlots(config.type, quality);
    const where = `Chest ${config.id} (${config.type})`;
    const filters: (ItemName | null)[] = new Array(slots).fill(null);
    for (const filter of config.slot_filters ?? []) {
        if (filter.slot > slots) {
            throw new Error(`${where}: slot filter ${filter.slot} is past its ${slots} slots`);
        }
        if (filters[filter.slot - 1] !== null) {
            throw new Error(`${where}: slot ${filter.slot} is filtered twice`);
        }
        if (!isBlockedSlotFilter(filter.item)) FactorioDataService.findItemOrThrow(filter.item);
        filters[filter.slot - 1] = filter.item;
    }
    const seen = new Set<number>();
    for (const content of config.contents ?? []) {
        if (content.slot > slots) {
            throw new Error(`${where}: contents in slot ${content.slot}, past its ${slots} slots`);
        }
        if (seen.has(content.slot)) {
            throw new Error(`${where}: slot ${content.slot} is given contents twice`);
        }
        seen.add(content.slot);
        if (isBlockedSlotFilter(content.item)) {
            throw new Error(`${where}: ${content.item} blocks a slot and cannot be starting contents`);
        }
        const stack = FactorioDataService.findItemOrThrow(content.item).stack_size;
        if (content.count > stack) {
            throw new Error(`${where}: ${content.count} ${content.item} in slot ${content.slot}, more than a stack of ${stack}`);
        }
        const filter = filters[content.slot - 1];
        if (filter !== null && filter !== content.item) {
            throw new Error(`${where}: slot ${content.slot} is filtered to ${filter} and cannot hold ${content.item}`);
        }
    }
    return new SlotContainer(EntityId.forChest(config.id), config.type, quality, filters, config.contents ?? [], items_put_in);
}
