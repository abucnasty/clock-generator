import { beforeAll, describe, expect, it, vi } from "vitest";
import { InserterUpdates, orderIsOpen, TakerOrder } from "./competing-takers";
import { SimulationContext } from "../../crafting/sequence/simulation-context";
import { loadConfigFromFile } from "../../config/loader";
import { ConfigPaths } from "../../config/config-paths";
import { MachineState } from "../../state";

describe("whether the turn rule leaves the order open", () => {
    it("is closed for a machine with nothing to take", () => {
        expect(orderIsOpen(0, false, 16)).toBe(false);
    });

    it("is open while nobody has taken from the machine, whatever it holds", () => {
        expect(orderIsOpen(1, false, 16)).toBe(true);
    });

    it("is open for a machine that holds a hand for the biggest of the inserters, and closed under it once someone has taken", () => {
        expect(orderIsOpen(16, true, 16)).toBe(true);
        expect(orderIsOpen(15, true, 16)).toBe(false);
    });
});

// Thaeln's cell: the foundry 3 is taken from by inserters 5 and 7, the foundry 10 by 22 and 25, in the list in that order
describe("the order competing inserters are updated in", () => {
    let context: SimulationContext;
    const updated: number[] = [];
    const foundry = (id: number) => context.state_registry.getStateByEntityIdOrThrow<MachineState>(context.machines.find(it => it.machine_state.entity_id.number === id)!.machine_state.entity_id);

    beforeAll(async () => {
        context = SimulationContext.fromConfig(await loadConfigFromFile(ConfigPaths.REAL_THAELN_CELL09));
        for (const inserter of context.inserters) {
            vi.spyOn(inserter, "executeForTick").mockImplementation(() => { updated.push(inserter.inserter_state.entity_id.number); });
        }
    });

    /** The order the inserters of the foundries 3 and 10 are updated in a tick, with each foundry holding `held` low density structures and `taker` having taken last, if one has */
    const order = (taker_order: TakerOrder | undefined, held: number, taker?: string) => {
        for (const id of [3, 10]) {
            const state = foundry(id);
            state.inventoryState.setQuantity("low-density-structure", held);
            state.lastOutputTaker.clear();
            if (taker !== undefined) {
                state.lastOutputTaker.set("low-density-structure", taker);
            }
        }
        updated.length = 0;
        new InserterUpdates(context.inserters, context.state_registry, taker_order).executeForTick();
        return updated.filter(id => [5, 7, 22, 25].includes(id));
    };

    it("is the order of the list where nothing is there to take", () => {
        expect(order("descending", 0)).toEqual([5, 7, 22, 25]);
    });

    it("serves the one built last first where nobody has taken yet", () => {
        expect(order("descending", 4)).toEqual([7, 5, 25, 22]);
    });

    it("serves the one built last first where a hand or more is there, also with a taker before", () => {
        expect(order("descending", 16, "inserter:5")).toEqual([7, 5, 25, 22]);
    });

    it("leaves the turn rule to decide where less than a hand is there and someone has taken", () => {
        expect(order("descending", 15, "inserter:5")).toEqual([5, 7, 22, 25]);
    });

    it("serves the one built first first for the ascending order, and the default is descending", () => {
        expect(order("ascending", 4)).toEqual([5, 7, 22, 25]);
        expect(order(undefined, 4)).toEqual([7, 5, 25, 22]);
    });

    it("draws an order of its own from a seed, the same one every tick, and another from another seed", () => {
        const orders = [1, 2, 3, 4, 5, 6].map(seed => JSON.stringify(order({ seed }, 4)));
        expect(orders.map(it => JSON.parse(it).slice().sort((a: number, b: number) => a - b))).toEqual(new Array(6).fill([5, 7, 22, 25]));
        expect(order({ seed: 1 }, 4)).toEqual(order({ seed: 1 }, 4));
        expect(new Set(orders).size).toBeGreaterThan(1);
    });

    it("keeps the seeded choices of later groups when earlier groups need no reordering", () => {
        expect(order({seed: 1}, 4)).toEqual([7, 5, 25, 22]);
        expect(order({seed: 5}, 4)).toEqual([5, 7, 22, 25]);
    });

    it("restores the original order when a reused updater's turn rule closes", () => {
        const updates = new InserterUpdates(context.inserters, context.state_registry);
        const tick = (held: number, history: boolean) => {
            for (const id of [3, 10]) {
                const state = foundry(id);
                state.inventoryState.setQuantity("low-density-structure", held);
                state.lastOutputTaker.clear();
                if (history) state.lastOutputTaker.set("low-density-structure", "inserter:5");
            }
            updated.length = 0;
            updates.executeForTick();
            return updated.filter(id => [5, 7, 22, 25].includes(id));
        };
        expect(tick(16, true)).toEqual([7, 5, 25, 22]);
        expect(tick(16, true)).toEqual([7, 5, 25, 22]);
        expect(tick(15, true)).toEqual([5, 7, 22, 25]);
        expect(tick(4, false)).toEqual([7, 5, 25, 22]);
        expect(tick(0, false)).toEqual([5, 7, 22, 25]);
    });

    it("uses the stock at the start of the tick for every group's order", () => {
        for (const id of [3, 10]) {
            foundry(id).inventoryState.setQuantity("low-density-structure", id === 3 ? 16 : 0);
            foundry(id).lastOutputTaker.clear();
        }
        const trigger = vi.mocked(context.inserters.find(it => it.inserter_state.entity_id.number === 7)!.executeForTick);
        const original = trigger.getMockImplementation()!;
        trigger.mockImplementation(() => {
            updated.push(7);
            foundry(10).inventoryState.setQuantity("low-density-structure", 16);
        });
        try {
            const updates = new InserterUpdates(context.inserters, context.state_registry);
            updated.length = 0;
            updates.executeForTick();
            expect(updated.filter(id => [5, 7, 22, 25].includes(id))).toEqual([7, 5, 22, 25]);
            updated.length = 0;
            updates.executeForTick();
            expect(updated.filter(id => [5, 7, 22, 25].includes(id))).toEqual([7, 5, 25, 22]);
        } finally {
            trigger.mockImplementation(original);
        }
    });

    it("keeps each foundry's inserters in the places they have in the list", () => {
        const drawn = order({ seed: 3 }, 4);
        expect([drawn[0], drawn[1]].sort((a, b) => a - b)).toEqual([5, 7]);
        expect([drawn[2], drawn[3]].sort((a, b) => a - b)).toEqual([22, 25]);
    });
});
