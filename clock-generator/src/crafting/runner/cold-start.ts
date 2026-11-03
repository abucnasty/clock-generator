import { SimulationContext } from "../sequence";
import { FactorioDataService } from "../../data";
import { directMachineStop } from "../../entities/drill/mining-drill-ext";
import { DEFAULT_INSERTER_DISPATCH, InserterDispatch } from "../../simulation/dispatch";

/**
 * Items of its own product a machine whose recipe makes its own ingredient (pentapod eggs) is asked to take when a staged
 * scaffold starts: a loop cannot start itself, so the scaffold's loop machines are seeded by hand, once (the harness asks
 * for 200). `overrides.loop_seed_items` sets it. The game puts in only what the input takes from outside an inserter, the
 * larger of the item's stack and its automated insertion limit, + 64, as a mining drill fills it (`loopSeedTaken`).
 */
export const DEFAULT_LOOP_SEED_ITEMS = 200;

/**
 * The seed a machine holds when `asked` of its looping ingredient, whose input has this automated insertion limit, is
 * put into it. Under the new dispatch, what the game takes: at most the larger of the item's stack and the input's automated insertion limit, + 64 (`directMachineStop`;
 * Factorio 2.1.24, staged starts asking for 200: 84 pentapod eggs, stack 20 and limit 7, and 114 iron bacteria, stack
 * 50 and limit 28). Under the configured order, everything asked (unchanged).
 */
export function loopSeedTaken(item_name: string, automated_insertion_limit: number, asked: number,
    dispatch: InserterDispatch = DEFAULT_INSERTER_DISPATCH): number {
    if (dispatch === "configured-order") return asked;
    return Math.min(asked, directMachineStop(FactorioDataService.findItemOrThrow(item_name).stack_size, automated_insertion_limit));
}

/** Gives every machine that makes its own ingredient `items` of it, once, as a player seeds a loop by hand (`loopSeedTaken`) */
export function seedLoopingRecipes(simulation_context: SimulationContext, items: number): void {
    for (const { machine_state } of simulation_context.machines) {
        for (const item_name of machine_state.machine.looping_ingredients) {
            const limit = machine_state.machine.inputs.getOrThrow(item_name).automated_insertion_limit.quantity;
            machine_state.selfIngredients.setQuantity(item_name, loopSeedTaken(item_name, limit, items, simulation_context.inserter_dispatch));
        }
    }
}
