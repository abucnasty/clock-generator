import { ConfigSchema, type Config } from "../../src/config/schema";
import type { Ratio } from "../../src/entities/traits/ratio";

/** A single assembler with independent supply and room for its gears. */
export function gearSetpoint(rate: Ratio = { numerator: 16, denominator: 7 }, hand = 1, speed = 4): Config {
    return ConfigSchema.parse(JSON.parse(JSON.stringify({
        setpoint: { item: "iron-gear-wheel", items_per_second: rate, copies: 1 },
        machines: [{ id: 1, recipe: "iron-gear-wheel", prototype: "assembling-machine-3", productivity: 0, crafting_speed: speed }],
        inserters: [
            { id: 1, source: { type: "chest", id: 1 }, sink: { type: "machine", id: 1 }, stack_size: 2 },
            { id: 2, source: { type: "machine", id: 1 }, sink: { type: "chest", id: 2 }, stack_size: hand },
        ],
        belts: [],
        chests: [{ id: 1, type: "infinity-chest", item_filter: [{ item_name: "iron-plate", request_count: 100 }] },
            { id: 2, type: "buffer-chest", prototype: "steel-chest", item_filter: "iron-gear-wheel", storage_size: 4800 }],
        overrides: { terminal_swing_count: 1, lcm: 1 },
    })));
}
