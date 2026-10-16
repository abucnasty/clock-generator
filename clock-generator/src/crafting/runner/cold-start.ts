import { SimulationContext } from "../sequence";

/**
 * Items of its own product a machine whose recipe makes its own ingredient (pentapod eggs) is given when a staged
 * scaffold starts: a loop cannot start itself, so the scaffold's egg machines are seeded by hand with this many, once
 * (the harness gives 200). `overrides.loop_seed_items` sets it.
 */
export const DEFAULT_LOOP_SEED_ITEMS = 200;

/** Gives every machine that makes its own ingredient `items` of it, once, as a player seeds a loop by hand */
export function seedLoopingRecipes(simulation_context: SimulationContext, items: number): void {
    for (const { machine_state } of simulation_context.machines) {
        for (const item_name of machine_state.machine.self_ingredients) {
            machine_state.selfIngredients.setQuantity(item_name, items);
        }
    }
}
