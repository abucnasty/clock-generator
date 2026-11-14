import { describe, expect, it } from "vitest";
import { OpenRange } from "../../data-types";
import type { StockRecording } from "../machine-stock";
import type { GhostWakeUp } from "../wake-ups";
import { windowsWithoutGhostWakeUps } from "./ghost-windows";

const OFF = "disabled_by_control_behavior";
const WINDOW_CYCLE = 20;

/** Two window cycles of an inserter whose window 1-9 switches it off from the tick at position 10, as `held` and the state after each tick */
function stockOf(held: number[]): StockRecording {
    const factorio_state = Array.from({ length: 2 * WINDOW_CYCLE }, (_, tick) => tick % WINDOW_CYCLE >= 1 && tick % WINDOW_CYCLE <= 9 ? "working" : OFF);
    return { ticks: 2 * WINDOW_CYCLE, machines: [], inserters: [{ inserter_id: "inserter:1", held, held_item: [], status: [], factorio_state }] };
}

const windows = new Map([["inserter:1", [OpenRange.from(1, 9)]]]);
const ghost = (asleep_from: number): GhostWakeUp => ({ inserter_id: "inserter:1", tick: 33, end: "source", switched_off: 30, asleep_from });

describe("windowsWithoutGhostWakeUps", () => {
    it("closes the window before the inserter went to sleep with an empty hand: its last enabled update the tick before", () => {
        const shaped = windowsWithoutGhostWakeUps(windows, WINDOW_CYCLE, stockOf(new Array(2 * WINDOW_CYCLE).fill(0)), [ghost(27)], new Set(), 0);
        // last enabled update in tick 30 (position 10); to sleep in tick 27: the window closes 30 - 27 + 1 = 4 ticks earlier
        expect(shaped?.windows.get("inserter:1")).toEqual([OpenRange.from(1, 5)]);
        expect(shaped?.shaped).toEqual([{ inserter_id: "inserter:1", window: OpenRange.from(1, 9), shaped: OpenRange.from(1, 5), ghost_wake_ups: 1 }]);
    });

    it("closes it before the inserter took the hand it held at the switch-off", () => {
        const held = new Array(2 * WINDOW_CYCLE).fill(0);
        for (let tick = 29; tick <= 33; tick++) held[tick] = 6;
        const shaped = windowsWithoutGhostWakeUps(windows, WINDOW_CYCLE, stockOf(held), [ghost(30)], new Set(), 0);
        expect(shaped?.windows.get("inserter:1")).toEqual([OpenRange.from(1, 7)]);
    });

    it("drops a window that holds nothing else where the inserter keeps another, and leaves the windows of a fixed inserter as they are", () => {
        // a second window 12-15, which switches the inserter off from the tick at position 16 and has no ghost wakeup after it
        const two = new Map([["inserter:1", [OpenRange.from(1, 9), OpenRange.from(12, 15)]]]);
        const stock = stockOf(new Array(2 * WINDOW_CYCLE).fill(0));
        stock.inserters[0].factorio_state = stock.inserters[0].factorio_state.map((state, tick) => tick % WINDOW_CYCLE >= 12 && tick % WINDOW_CYCLE <= 15 ? "working" : state);
        const dropped = windowsWithoutGhostWakeUps(two, WINDOW_CYCLE, stock, [ghost(22)], new Set(), 0);
        expect(dropped?.windows.get("inserter:1")).toEqual([OpenRange.from(12, 15)]);
        expect(dropped?.shaped).toEqual([{ inserter_id: "inserter:1", window: OpenRange.from(1, 9), shaped: null, ghost_wake_ups: 1 }]);
        const told: string[] = [];
        expect(windowsWithoutGhostWakeUps(windows, WINDOW_CYCLE, stockOf(new Array(2 * WINDOW_CYCLE).fill(0)), [ghost(27)], new Set(["inserter:1"]), 0,
            (_, why) => told.push(why))).toBeNull();
        expect(told).toEqual(["its enable windows are fixed"]);
    });

    it("leaves every window of an inserter whose windows would all be dropped, and shapes the others", () => {
        // inserter:1 takes from a machine (the stock reads no belt): its one window would be dropped; inserter:2's closes earlier.
        // An inserter with no window is not under the clock and runs all the time
        const stock = stockOf(new Array(2 * WINDOW_CYCLE).fill(0));
        stock.inserters.push({ ...stock.inserters[0], inserter_id: "inserter:2" });
        const both = new Map([["inserter:1", [OpenRange.from(1, 9)]], ["inserter:2", [OpenRange.from(1, 9)]]]);
        const told: string[] = [];
        const shaped = windowsWithoutGhostWakeUps(both, WINDOW_CYCLE, stock, [ghost(22), { ...ghost(27), inserter_id: "inserter:2" }], new Set(), 0,
            (id, why) => told.push(`${id}: ${why}`));
        expect(shaped?.windows.get("inserter:1")).toEqual([OpenRange.from(1, 9)]);
        expect(shaped?.windows.get("inserter:2")).toEqual([OpenRange.from(1, 5)]);
        expect(shaped?.shaped.map(it => it.inserter_id)).toEqual(["inserter:2"]);
        expect(told).toEqual(["inserter:1: shaping would leave it no enable window"]);
        // alone, nothing changes
        expect(windowsWithoutGhostWakeUps(windows, WINDOW_CYCLE, stockOf(new Array(2 * WINDOW_CYCLE).fill(0)), [ghost(22)], new Set(), 0)).toBeNull();
    });

    it("leaves the windows where the switch-offs do not line up with the clock's offset", () => {
        const told: string[] = [];
        expect(windowsWithoutGhostWakeUps(windows, WINDOW_CYCLE, stockOf(new Array(2 * WINDOW_CYCLE).fill(0)), [ghost(27)], new Set(), 3,
            (_, why) => told.push(why))).toBeNull();
        expect(told).toEqual(["its switch-offs do not line up with its enable windows"]);
    });
});
