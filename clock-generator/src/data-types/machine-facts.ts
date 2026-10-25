export interface SerializableMachineOutput {
    item_name: string;
    /** Expected effective yield, including productivity. */
    amount_per_craft: number;
    rate_per_second: number;
    rate_ratio: { numerator: number; denominator: number };
    output_block_size: number;
    /** The recipe has a probabilistic yield; simulation still uses expected yield with carry. */
    stochastic: boolean;
}

export interface SerializableMachineInput {
    item_name: string;
    consumption_rate_per_second: number;
    automated_insertion_limit: number;
    amount_per_craft: number;
}

export interface SerializableFuelConsumption {
    item_name: string;
    energy_consumption_bonus: number;
    consumption_rate_per_second: number;
    amount_per_craft: number;
}

export interface SerializableMachineFacts {
    /** Every item result, main product first. Older serialized facts may omit this vector. */
    outputs?: SerializableMachineOutput[];
    recipe: string;
    crafting_speed: number;
    productivity: number;
    type: string;
    output_item: string;
    output_per_craft: number;
    output_rate_per_second: number;
    /** Exact capacity for browser validation; optional for consumers of older serialized facts. */
    output_rate_ratio?: { numerator: number; denominator: number };
    output_block_size: number;
    overload_multiplier: number;
    ticks_per_craft: number;
    ticks_per_bonus_craft: number;
    insertion_duration_ticks: number;
    inputs: SerializableMachineInput[];
    fuel?: SerializableFuelConsumption;
}
