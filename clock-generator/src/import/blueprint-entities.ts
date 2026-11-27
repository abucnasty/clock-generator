/**
 * What the import reads from a pasted blueprint's entities, with the game's own key names and value types.
 * Defaults the game leaves out are filled (a direction, a quality, an empty list); a key the game leaves out and that
 * has no default stays out. Nothing here knows what kind of entity a name is: that comes from the game data.
 */

/** One item the blueprint asks for, in one slot of one inventory of an entity */
export type RequestRead = {
    item: string;
    quality: string;
    inventory: number;
    stack: number;
    count?: number;
};

/**
 * One filter row of an inserter, a loader or an inventory: the game numbers the rows with `index`. The game allows a
 * row with no `name` (only a quality and a comparator), so `item` may be missing.
 */
export type FilterRead = {
    index: number;
    item?: string;
    quality: string;
    comparator?: string;
};

/** One filter row of an infinity chest: the game always writes `name` here, so `item` is always there */
export type InfinityFilterRead = {
    index?: number;
    item: string;
    quality: string;
    count?: number;
    mode?: string;
};

export type InfinityRead = {
    filters: InfinityFilterRead[];
    remove_unfiltered_items: boolean;
};

/** The filtered slots of a car's trunk or a wagon */
export type InventoryRead = {
    filters: FilterRead[];
    bar?: number;
};

/** A splitter's filter; the game allows one with no `name`, so `item` may be missing */
export type SplitterFilterRead = {
    item?: string;
    quality: string;
    comparator?: string;
};

export type BlueprintEntityRead = {
    entity_number: number;
    name: string;
    /** The centre of the entity, as the blueprint gives it */
    position: { x: number; y: number };
    /** 0 when the blueprint leaves it out (north) */
    direction: number;
    mirror: boolean;
    /** "normal" when the blueprint leaves it out */
    quality: string;
    recipe?: string;
    recipe_quality?: string;
    /** One row for each slot of each request, sorted by inventory, stack and item */
    requests: RequestRead[];
    /** Sorted by index */
    filters: FilterRead[];
    use_filters: boolean;
    filter_mode?: string;
    override_stack_size?: number;
    bar?: number;
    /** Only for the chest shape of `infinity_settings`: the fluid shape of an infinity pipe is not read */
    infinity?: InfinityRead;
    /** A car's `trunk_inventory` or a wagon's `inventory`, when the blueprint holds one */
    inventory?: InventoryRead;
    orientation?: number;
    /** The game's `type` key of an underground belt or a loader (`input` or `output`), with no default here */
    type?: string;
    input_priority?: string;
    output_priority?: string;
    filter?: SplitterFilterRead;
    /** Kept as the blueprint gives it, for the circuit notes */
    control_behavior?: Record<string, unknown>;
};
