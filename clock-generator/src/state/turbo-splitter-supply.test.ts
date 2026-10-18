import {expect, it} from "vitest";
import {SplitterStack, TurboSplitterSupply} from "./turbo-splitter-supply";

const empty = (): SplitterStack[][] => Array.from({length: 8}, () => []);

it("conserves finite stock across accepted arrivals, departures and partial withdrawals", () => {
    const initial = empty();
    initial[4] = [{id: 1, position: 0, item: "iron-plate", count: 4}];
    initial[6] = [{id: 2, position: 0, item: "iron-plate", count: 4}];
    const supply = new TurboSplitterSupply(initial);
    const sum = () => supply.snapshot().flat().reduce((total, s) => total + s.count, 0);
    const before = sum();
    const boundary = supply.advance([[{id: 3, position: 0, item: "iron-plate", count: 4}], []]);
    expect(boundary.accepted).toEqual([3]);
    expect(boundary.departed).toEqual([[{id: 1, position: -32, item: "iron-plate", count: 4}], []]);
    expect(sum()).toBe(before + 4 - boundary.departed.flat().reduce((total, s) => total + s.count, 0));
    expect(supply.take("iron-plate", 2, 1)).toBe(2);
    expect(sum()).toBe(before - 2);
    expect(supply.snapshot()[6]).toEqual([{id: 2, position: 0, item: "iron-plate", count: 2}]);
    expect(initial[6][0].count).toBe(4);
});

it("selects the mirrored lane first and falls back to the other lane for the same item", () => {
    const initial = empty();
    initial[6] = [{id: 1, position: 0, item: "iron-plate", count: 4}];
    initial[7] = [{id: 2, position: 0, item: "iron-plate", count: 4}];
    const supply = new TurboSplitterSupply(initial);
    expect(supply.take("iron-plate", 16, 2)).toBe(4);
    expect(supply.snapshot()[6]).toHaveLength(1);
    expect(supply.snapshot()[7]).toEqual([]);
    expect(supply.take("iron-plate", 16, 2)).toBe(4);
    expect(supply.take("iron-plate", 16, 2)).toBe(0);
});

it("keeps stock and phase in repeat detection without depending on observation IDs", () => {
    const initial = empty();
    initial[6] = [{id: 1, position: 0, item: "iron-plate", count: 4}];
    initial[7] = [{id: 2, position: 32, item: "copper-cable", count: 4}];
    const first = new TurboSplitterSupply(initial);
    initial[6][0].id = 50;
    const renamed = new TurboSplitterSupply(initial);
    expect(first.stateKey()).toBe(renamed.stateKey());
    expect(first.availableItems(1)).toEqual(["iron-plate", "copper-cable"]);
    expect(first.availableItems(2)).toEqual(["copper-cable", "iron-plate"]);
    first.take("iron-plate", 2, 1);
    expect(first.stateKey()).not.toBe(renamed.stateKey());
    const resumed = new TurboSplitterSupply(first.snapshot());
    first.advance([[], []]);
    resumed.advance([[], []]);
    expect(first.stateKey()).toBe(resumed.stateKey());
    const snapshot = first.snapshot();
    snapshot[6][0].count = 1;
    expect(first.snapshot()[6][0].count).toBe(2);
});

it("refuses uncalibrated south input, overlapping stock and oversized stacks", () => {
    const south = empty();
    south[2] = [{id: 1, position: 0, item: "iron-plate", count: 4}];
    expect(() => new TurboSplitterSupply(south)).toThrow(/South-input/);
    const overlap = empty();
    overlap[0] = [0, 32].map((position, i) => ({id: i, position, item: "iron-plate", count: 4}));
    expect(() => new TurboSplitterSupply(overlap)).toThrow(/spacing/);
    const oversized = empty();
    oversized[0] = [{id: 1, position: 0, item: "iron-plate", count: 5}];
    expect(() => new TurboSplitterSupply(oversized)).toThrow(/at most four/);
});

it("clamps a congested arrival to 178 but holds it upstream if the landing would be 179", () => {
    for (const head of [18, 19]) {
        const initial = empty();
        initial[0] = [head, head + 64, head + 128].map((position, index) => ({id: index + 1, position, item: "iron-plate", count: 4}));
        initial[6] = [0, 64].map((position, index) => ({id: index + 4, position, item: "iron-plate", count: 4}));
        const supply = new TurboSplitterSupply(initial);
        const boundary = supply.advance([[{id: 6, position: 0, item: "iron-plate", count: 4}], []]);
        expect(boundary.accepted).toEqual(head === 18 ? [6] : []);
        expect(supply.snapshot()[0].map(stack => stack.position)).toEqual(head === 18 ? [50, 114, 178] : [51, 115]);
    }
});
