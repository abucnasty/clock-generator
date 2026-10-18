import {describe, expect, it} from "vitest";
import {BeltPickupMerge, MergeSnapshot, MergeStack} from "./belt-pickup-merge";
import {BeltPickupMergeConfig} from "../config/schema";

const config: BeltPickupMergeConfig = {lane: 2, outer: {ingredient: "iron-plate", stack_size: 4},
    inner: {ingredient: "copper-cable", stack_size: 4}, downstream_tiles: 3, outlet: "open"};
function seeded(shift: number) {
    let id = 0;
    const stack = (position: number, origin: "outer" | "inner"): MergeStack => ({id: ++id, position, origin, count: 4, item: config[origin].ingredient});
    const initial: MergeSnapshot = {tick: 0, stock: [shift - 61, shift + 3].map(p => stack(p, "outer")),
        outer: [0, 64, 128, 192].map(p => stack(p, "outer")), inner: [0, 64, 128, 192].map(p => stack(p, "inner"))};
    return new BeltPickupMerge(config, false, initial, false);
}

describe("turbo two-stream pickup supply", () => {
    it.each([89, 90, 91, 92, 93, 94, 95, 96])("matches the native calibrated entry at shift %i", shift => {
        const merge = seeded(shift);
        merge.advanceTo(1);
        expect(merge.snapshot().inner).toHaveLength(shift < 96 ? 3 : 4);
        expect(merge.snapshot().stock.find(s => s.origin === "inner")?.position).toBe(shift < 96 ? 67 + shift - 32 : undefined);
    });
    it("waits instead of moving a compressed follower backwards", () => {
        const merge = seeded(95);
        merge.advanceTo(1);
        const outer = merge.snapshot().stock.find(s => s.position === 156)!;
        merge.advanceTo(2);
        expect(merge.snapshot().stock.find(s => s.id === outer.id)?.position).toBe(156);
        merge.advanceTo(3);
        expect(merge.snapshot().stock.find(s => s.id === outer.id)?.position).toBe(130);
    });
    it("takes only the held item, caps partial grabs, and shares the one-grab limit", () => {
        const merge = seeded(89);
        merge.advanceTo(1);
        expect(merge.availableItems(1)).toEqual(["iron-plate", "copper-cable"]);
        expect(merge.take(1, "copper-cable", 2)).toBe(2);
        expect(merge.take(1, "iron-plate", 4)).toBe(0);
        expect(merge.snapshot().stock.find(s => s.origin === "inner")?.count).toBe(2);
        expect(merge.hasTakenAt(1)).toBe(true);
        expect(merge.take(2, "copper-cable", 16)).toBe(2);
    });
    it("keeps queues and finite downstream stock while blocked, then drains on reopening", () => {
        const merge = new BeltPickupMerge({...config, outlet: "closed"});
        merge.advanceTo(40, false);
        expect(merge.snapshot().stock.map(s => s.position)).toEqual(Array.from({length: 16}, (_, i) => -768 + i * 64));
        merge.advanceTo(41, true);
        expect(merge.snapshot().stock[0].position).toBe(-736);
    });
    it("advances identically across closed pickup windows and retains identity-independent repeat keys", () => {
        const lazy = new BeltPickupMerge(config), everyTick = new BeltPickupMerge(config);
        for (let tick = 1; tick <= 64; tick++) everyTick.advanceTo(tick);
        lazy.advanceTo(64);
        expect(lazy.snapshot()).toEqual(everyTick.snapshot());
        const first = lazy.stateKey(64);
        lazy.advanceTo(66);
        expect(lazy.stateKey(66)).toBe(first);
    });
});
