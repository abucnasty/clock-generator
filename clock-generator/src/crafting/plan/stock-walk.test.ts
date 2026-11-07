import { describe, expect, it } from "vitest";
import { OpenRange } from "../../data-types";
import { StockWalkInput, walkMachineStock, WINDOW_LATENCY_TICKS } from "./stock-walk";

// A machine of one ingredient: 2 plates a craft, 1 gear a craft, 4 ticks a craft; the plates' insertion limit 6, the output
// block 4. Its inserters swing as a legendary stack inserter between machines does: 1 tick to pick up, 3 each way, 1 to drop.
const machine: StockWalkInput["machine"] = {
    inputs: [{ item_name: "plate", amount_per_craft: 2, automated_insertion_limit: 6, consumption_rate_per_second: 30 }],
    output_item: "gear", output_per_craft: 1, output_block_size: 4, ticks_per_craft: 4,
};
const swing = { pickup: 1, rotation: 3, drop: 1 };

describe("the stock walk", () => {
    it("walks a machine fed and emptied as it allows to the period that repeats, from a cold start", () => {
        const walk = walkMachineStock({
            machine, window_cycle_ticks: 64,
            fillers: [{ id: "in", items: ["plate"], hand: 8, swing }],
            takers: [{ id: "out", items: ["gear"], hand: 8, swing }],
        });
        expect(walk.converged).toBe(true);
        // a craft every 4 ticks: 16 gears and 32 plates a period, in two hands of 8 gears and four of 8 plates
        expect(walk.craft_starts).toHaveLength(16);
        expect(walk.hands.filter(hand => hand.id === "out").map(hand => hand.amount)).toEqual([8, 8]);
        expect(walk.hands.filter(hand => hand.id === "in")).toHaveLength(4);
        // the start of the period it repeats from is the surplus it carries
        expect(walk.start.inputs.plate).toBe(walk.input_stock.plate[63]);
        expect(walk.start.output).toBe(walk.output_stock[63]);
    });

    it("picks a hand up for the machine only under its insertion limit, and drops it whole over the limit", () => {
        const walk = walkMachineStock({
            machine, window_cycle_ticks: 64,
            fillers: [{ id: "in", items: ["plate"], hand: 8, swing }],
            takers: [{ id: "out", items: ["gear"], hand: 8, swing }],
        });
        for (const hand of walk.hands.filter(it => it.id === "in")) {
            expect(hand.stock_before).toBeLessThan(6);
            expect(hand.stock_after).toBe(hand.stock_before + 8);
        }
    });

    it("brings nothing into a machine at its output block until its output is taken under it", () => {
        // the gears are taken once a period, from position 32: the plates wait with the output at its block before it
        const walk = walkMachineStock({
            machine, window_cycle_ticks: 64,
            fillers: [{ id: "in", items: ["plate"], hand: 8, swing }],
            takers: [{ id: "out", items: ["gear"], hand: 16, swing, windows: [OpenRange.from(32, 40)] }],
        });
        expect(walk.converged).toBe(true);
        const plates = walk.hands.filter(hand => hand.id === "in");
        expect(plates.length).toBeGreaterThan(0);
        // no hand starts in a tick the output stood at its block through (the takers go first in a tick, then the fillers)
        for (const hand of plates) {
            expect(Math.min(walk.output_stock[(hand.pickup_tick + 63) % 64], walk.output_stock[hand.pickup_tick])).toBeLessThan(4);
        }
        // the output stands at its block until the take
        expect(walk.output_stock[31]).toBeGreaterThanOrEqual(4);
    });

    it("fills a taker's hand with what the machine holds and has it wait for the rest", () => {
        const walk = walkMachineStock({
            machine, window_cycle_ticks: 64,
            fillers: [{ id: "in", items: ["plate"], hand: 8, swing }],
            takers: [{ id: "out", items: ["gear"], hand: 16, swing }],
        });
        const taken = walk.hands.filter(hand => hand.id === "out");
        expect(taken).toHaveLength(1);
        // a gear every 4 ticks: a hand of 16 is full well after it began to fill
        expect(taken[0].ticks).toBeGreaterThan(8);
        expect(walk.waits.out).toBeGreaterThan(0);
    });

    it("lets an inserter act in the tick after the clock position of its window's tick", () => {
        const walk = walkMachineStock({
            machine, window_cycle_ticks: 64, start: { inputs: { plate: 0 }, output: 8, craft: null, made: 0 }, max_window_cycles: 1,
            fillers: [],
            takers: [{ id: "out", items: ["gear"], hand: 8, swing, windows: [OpenRange.from(10, 10)] }],
        });
        expect(walk.hands).toEqual([expect.objectContaining({ id: "out", pickup_tick: 10 + WINDOW_LATENCY_TICKS, amount: 8 })]);
    });

    it("gives a filler of two items from a chest the first in its order that the machine takes, else the one it holds least of", () => {
        const two: StockWalkInput["machine"] = {
            ...machine,
            inputs: [machine.inputs[0], { item_name: "wire", amount_per_craft: 1, automated_insertion_limit: 4, consumption_rate_per_second: 15 }],
        };
        const first = walkMachineStock({ machine: two, window_cycle_ticks: 32, max_window_cycles: 1,
            fillers: [{ id: "in", items: ["wire", "plate"], pick: "in-order", hand: 8, swing }], takers: [] });
        expect(first.hands[0].item).toBe("wire");
        const least = walkMachineStock({ machine: two, window_cycle_ticks: 32, max_window_cycles: 1, start: { inputs: { plate: 0, wire: 3 }, output: 0, craft: null, made: 0 },
            fillers: [{ id: "in", items: ["wire", "plate"], pick: "least-cover", hand: 8, swing }], takers: [] });
        expect(least.hands[0].item).toBe("plate");
    });

    it("starts no more hands of a part of the period than its quota", () => {
        const walk = walkMachineStock({
            machine, window_cycle_ticks: 64,
            fillers: [{ id: "in", items: ["plate"], hand: 8, swing, quota: [2, 2], quota_starts: [0, 32] }],
            takers: [{ id: "out", items: ["gear"], hand: 8, swing }],
        });
        const hands = walk.hands.filter(hand => hand.id === "in");
        expect(hands).toHaveLength(4);
        expect(hands.filter(hand => hand.pickup_tick < 32)).toHaveLength(2);
    });

    it("refuses a period that is not whole ticks", () => {
        expect(() => walkMachineStock({ machine, window_cycle_ticks: 63.5, fillers: [], takers: [] })).toThrow(/whole ticks/);
    });
});
