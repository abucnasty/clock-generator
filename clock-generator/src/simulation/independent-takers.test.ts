import fs from "node:fs";
import path from "node:path";
import {expect, test} from "vitest";
import {loadConfigFromFile} from "../config/loader";
import {ConfigPaths} from "../config/config-paths";
import {otherTakerOrdersOf} from "../crafting/trial";
import {SimulationContext} from "../crafting/sequence/simulation-context";
import {World} from "./world";
import {DEFAULT_TAKER_ORDER} from "./competing-takers";

interface NativeAllocation {
    period: number;
    observed_source_allocations: {source: number; item: string; stock_before: number; takes: Record<string, number>}[];
    machines_before: {id: number; input: Record<string, number>; output: Record<string, number>; progress: number; bonus: number}[];
    hands_before: {id: number; held: number}[];
}
const native: NativeAllocation = JSON.parse(fs.readFileSync(path.join(__dirname,
    "../../tests/game/builds/independent-source-allocations.json"), "utf8"));

test("robustness covers the independently mixed native shared-source allocation", async () => {
    // Recorded ordinary scaffold trace, not a debugger dependency: three sources exhaust17 LDS in the same tick.
    // Source3 serves7 before5, source4 serves6 before8, source11 serves26 before23. No global ascending/descending
    // order represents all three. Only local pickups from measured inventories are replayed here, not the whole tick.
    const config = await loadConfigFromFile(ConfigPaths.REAL_THAELN_CELL09);
    const orders = [DEFAULT_TAKER_ORDER, ...otherTakerOrdersOf(config, new Map(), native.period)];
    const hands = native.hands_before.map(it => it.id).sort((a, b) => a - b);
    expect(native.hands_before.every(it => it.held === 0)).toBe(true);
    const expected = hands.map(id => native.observed_source_allocations.find(it => String(id) in it.takes)!.takes[id]);
    const allocations = orders.map(order => {
        const context = SimulationContext.fromConfig(config);
        context.competing_takers_order = order;
        for (const machine of context.machines) {
            const state = machine.machine_state;
            const measured = native.machines_before.find(it => it.id === state.entity_id.number)!;
            state.inventoryState.clear();
            for (const [item, quantity] of Object.entries({...measured.input, ...measured.output})) {
                state.inventoryState.setQuantity(item, quantity);
            }
            state.craftingProgress.progress = measured.progress;
            state.bonusProgress.progress = measured.bonus;
        }
        const world = World.of(context);
        for (const hand of world.inserters) {
            if (hands.includes(hand.entity_id.number)) hand.hand.pickup.pickup();
        }
        return hands.map(id => context.inserters.find(it => it.entity_id.number === id)!.inserter_state.held_item?.quantity ?? 0);
    });
    expect(allocations).toContainEqual(expected);
});
