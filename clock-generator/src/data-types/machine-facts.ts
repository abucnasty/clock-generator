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
    recipe: string;
    crafting_speed: number;
    productivity: number;
    type: string;
    output_item: string;
    output_per_craft: number;
    output_rate_per_second: number;
    output_block_size: number;
    overload_multiplier: number;
    ticks_per_craft: number;
    ticks_per_bonus_craft: number;
    insertion_duration_ticks: number;
    inputs: SerializableMachineInput[];
    fuel?: SerializableFuelConsumption;
}
