import { describe, expect, it } from "vitest";
import { OpenRange } from "../../data-types";
import type { StockRecording } from "../machine-stock";
import type { GhostWakeUp } from "../wake-ups";
import { windowsWithoutGhostWakeUps } from "./ghost-windows";

const OFF = "disabled_by_control_behavior";
const PERIOD = 20;

/** Two periods of an inserter whose window 1-9 switches it off from the tick at position 10, as `held` and the state after each tick */
function stockOf(held: number[]): StockRecording {
    const factorio_state = Array.from({ length: 2 * PERIOD }, (_, tick) => tick % PERIOD >= 1 && tick % PERIOD <= 9 ? "working" : OFF);
    return { ticks: 2 * PERIOD, machines: [], inserters: [{ inserter_id: "inserter:1", held, held_item: [], status: [], factorio_state }] };
}

const windows = new Map([["inserter:1", [OpenRange.from(1, 9)]]]);
const ghost = (asleep_from: number): GhostWakeUp => ({ inserter_id: "inserter:1", tick: 33, end: "source", switched_off: 30, asleep_from });

describe("windowsWithoutGhostWakeUps", () => {
    it("closes the window before the inserter went to sleep with an empty hand: its last enabled update the tick before", () => {
        const shaped = windowsWithoutGhostWakeUps(windows, PERIOD, stockOf(new Array(2 * PERIOD).fill(0)), [ghost(27)], new Set(), 0);
        // last enabled update in tick 30 (position 10); to sleep in tick 27: the window closes 30 - 27 + 1 = 4 ticks earlier
        expect(shaped?.windows.get("inserter:1")).toEqual([OpenRange.from(1, 5)]);
        expect(shaped?.shaped).toEqual([{ inserter_id: "inserter:1", window: OpenRange.from(1, 9), shaped: OpenRange.from(1, 5), ghost_wake_ups: 1 }]);
    });

    it("closes it before the inserter took the hand it held at the switch-off", () => {
        const held = new Array(2 * PERIOD).fill(0);
        for (let tick = 29; tick <= 33; tick++) held[tick] = 6;
        const shaped = windowsWithoutGhostWakeUps(windows, PERIOD, stockOf(held), [ghost(30)], new Set(), 0);
        expect(shaped?.windows.get("inserter:1")).toEqual([OpenRange.from(1, 7)]);
    });

    it("drops a window that holds nothing else, and leaves the windows of a fixed inserter as they are", () => {
        const dropped = windowsWithoutGhostWakeUps(windows, PERIOD, stockOf(new Array(2 * PERIOD).fill(0)), [ghost(22)], new Set(), 0);
        expect(dropped?.windows.get("inserter:1")).toEqual([]);
        expect(dropped?.shaped[0].shaped).toBeNull();
        const told: string[] = [];
        expect(windowsWithoutGhostWakeUps(windows, PERIOD, stockOf(new Array(2 * PERIOD).fill(0)), [ghost(27)], new Set(["inserter:1"]), 0,
            (_, why) => told.push(why))).toBeNull();
        expect(told).toEqual(["its windows are fixed"]);
    });

    it("leaves the windows where the switch-offs do not line up with the clock's offset", () => {
        const told: string[] = [];
        expect(windowsWithoutGhostWakeUps(windows, PERIOD, stockOf(new Array(2 * PERIOD).fill(0)), [ghost(27)], new Set(), 3,
            (_, why) => told.push(why))).toBeNull();
        expect(told).toEqual(["its switch-offs do not line up with its windows"]);
    });
});
