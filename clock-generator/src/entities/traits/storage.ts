import { Chest } from "../chest/chest";
import { isNeverBlockingSink } from "../chest/never-blocking-sink";
import { InputLimitsTrait, siloInputLimits } from "./input-limits";

/** The most of an item a container holds; null where it has no bound (an infinity chest) */
export interface StorageCapacity {
    readonly item: string;
    readonly capacity: number | null;
}

/** A container: what it holds of each item, takes and gives */
export interface StorageTrait {
    /** A buffer chest, a car, tank or cargo wagon, a rocket silo's rocket inventory, an infinity chest */
    readonly kind: "single-item" | "slots" | "weight" | "constant";
    /** The config's chest type */
    readonly chest_type: string;
    /** Of every item it gives, is filtered to or the build puts into it, as the chest computes it (`getCapacity`) */
    readonly capacity_by_item: readonly StorageCapacity[];
    /** "any" for any item of the game (a free slot, a silo, an infinity chest that removes unfiltered items) */
    readonly accepts: "any" | readonly string[];
    /** What it gives an inserter (`getItemFilters`) */
    readonly gives: readonly string[];
    /** The items the build's inserters, placers and drills put into it */
    readonly items_put_in: readonly string[];
    /** A sink that never refuses a hand (an infinity chest) */
    readonly never_refuses: boolean;
    /** A source whose contents stay as they are (an infinity chest) */
    readonly constant_supply: boolean;
    /** The slots of a car, tank or cargo wagon (its quality's for a wagon); null for another kind */
    readonly slots: number | null;
    /** A rocket silo's input slots; null for another kind */
    readonly input_slots: InputLimitsTrait | null;
}

function kindOf(chest: Chest): StorageTrait["kind"] {
    if (Chest.isBufferChest(chest)) return "single-item";
    if (Chest.isInfinityChest(chest)) return "constant";
    if (Chest.isRocketSilo(chest)) return "weight";
    return "slots";
}

function acceptsOf(chest: Chest): StorageTrait["accepts"] {
    if (Chest.isBufferChest(chest)) return [chest.item_filter];
    if (Chest.isInfinityChest(chest)) return chest.remove_unfiltered_items ? "any" : chest.item_filters.map(filter => filter.item_name);
    if (Chest.isSlotContainer(chest)) {
        return chest.slot_filters.includes(null) ? "any"
            : Array.from(new Set(chest.slot_filters.filter((filter): filter is string => typeof filter === "string")));
    }
    return "any";
}

/** A chest of the config as its class computes it (chest.ts), with the items put into it */
export function chestStorage(chest: Chest, items_put_in: readonly string[]): StorageTrait {
    const gives = chest.getItemFilters();
    const accepts = acceptsOf(chest);
    const input_slots = Chest.isRocketSilo(chest) ? siloInputLimits(chest) : null;
    const items = new Set([...gives, ...items_put_in, ...(accepts === "any" ? [] : accepts), ...(input_slots?.limits.map(limit => limit.item) ?? [])]);
    return {
        kind: kindOf(chest),
        chest_type: chest.chest_type,
        capacity_by_item: Array.from(items, item => {
            const capacity = chest.getCapacity(item);
            return { item, capacity: Number.isFinite(capacity) ? capacity : null };
        }),
        accepts,
        gives,
        items_put_in: [...items_put_in],
        never_refuses: isNeverBlockingSink(chest),
        constant_supply: Chest.isInfinityChest(chest),
        slots: Chest.isSlotContainer(chest) ? chest.slot_count : null,
        input_slots,
    };
}
