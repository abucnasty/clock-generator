import { beforeAll, describe, expect, it, vi } from "vitest";
import { InserterUpdates, TakerOrder, takerOrderName, takerOrdersToCheck } from "./competing-takers";
import { SimulationContext } from "../../crafting/sequence/simulation-context";
import { loadConfigFromFile } from "../../config/loader";
import { ConfigPaths } from "../../config/config-paths";
import { MachineState } from "../../state";

describe("the orders a clock is checked under", () => {
    it("is the default alone where no machine has two takers of one product", () => {
        expect(takerOrdersToCheck(0)).toEqual(["descending"]);
        expect(takerOrdersToCheck(1)).toEqual(["descending"]);
    });

    it("is both ways round for two takers", () => {
        expect(takerOrdersToCheck(2)).toEqual(["descending", "ascending"]);
    });

    // two orders would leave the middle taker of three never first and never last
    it("is the descending order and each of its rotations for more, so every taker is first once and last once", () => {
        expect(takerOrdersToCheck(3)).toEqual(["descending", { rotation: 1 }, { rotation: 2 }]);
        expect(takerOrdersToCheck(3).map(takerOrderName)).toEqual(["descending", "rotated by 1", "rotated by 2"]);
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

    /** The order the inserters of the foundries 3 and 10 are updated in a tick, with each foundry holding `held` low density structures */
    const order = (taker_order: TakerOrder | undefined, held: number) => {
        for (const id of [3, 10]) {
            foundry(id).inventoryState.setQuantity("low-density-structure", held);
        }
        updated.length = 0;
        new InserterUpdates(context.inserters, context.state_registry, taker_order).executeForTick();
        return updated.filter(id => [5, 7, 22, 25].includes(id));
    };

    // the game serves them in one fixed order on every tick, whatever the machine holds (#100's supercapacitor plant)
    it("serves the one built last first on every tick, whatever the machine holds, for the descending order", () => {
        expect(order("descending", 0)).toEqual([7, 5, 25, 22]);
        expect(order("descending", 4)).toEqual([7, 5, 25, 22]);
        expect(order("descending", 15)).toEqual([7, 5, 25, 22]);
        expect(order("descending", 16)).toEqual([7, 5, 25, 22]);
    });

    it("serves the one built first first for the ascending order, and the default is descending", () => {
        expect(order("ascending", 4)).toEqual([5, 7, 22, 25]);
        expect(order(undefined, 4)).toEqual([7, 5, 25, 22]);
    });

    it("turns each group round for a rotation: by one, two takers are served in ascending order", () => {
        expect(order({ rotation: 1 }, 4)).toEqual([5, 7, 22, 25]);
        expect(order({ rotation: 2 }, 4)).toEqual([7, 5, 25, 22]);
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

    it("keeps the order a reused updater has, tick after tick", () => {
        const updates = new InserterUpdates(context.inserters, context.state_registry);
        const tick = (held: number) => {
            for (const id of [3, 10]) foundry(id).inventoryState.setQuantity("low-density-structure", held);
            updated.length = 0;
            updates.executeForTick();
            return updated.filter(id => [5, 7, 22, 25].includes(id));
        };
        expect([tick(16), tick(15), tick(4), tick(0)]).toEqual(new Array(4).fill([7, 5, 25, 22]));
    });

    it("keeps each foundry's inserters in the places they have in the list", () => {
        const drawn = order({ seed: 3 }, 4);
        expect([drawn[0], drawn[1]].sort((a, b) => a - b)).toEqual([5, 7]);
        expect([drawn[2], drawn[3]].sort((a, b) => a - b)).toEqual([22, 25]);
    });
});
