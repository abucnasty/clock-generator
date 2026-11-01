import {ConfigSchema} from "../config/schema";
import {SimulationContext} from "../crafting/sequence/simulation-context";

/** The measured independent AM3 -> stack16 -> empty48-slot sink topology, with no injected held items. */
export function partialCells(): SimulationContext {
    return SimulationContext.fromConfig(ConfigSchema.parse({
        target_output: {recipe: "copper-cable", items_per_second: 5, copies: 3},
        machines: [1, 2, 3].map(id => ({id, recipe: "copper-cable", productivity: 0,
            crafting_speed: 1.25, prototype: "assembling-machine-3"})),
        inserters: [1, 2, 3].map(id => ({id, source: {type: "machine", id}, sink: {type: "chest", id},
            prototype: "stack-inserter", quality: "legendary", stack_size: 16, filters: ["copper-cable"]})),
        belts: [],
        chests: [1, 2, 3].map(id => ({id, type: "buffer-chest", storage_size: 4800,
            item_filter: "copper-cable", prototype: "steel-chest"})),
    }));
}

