import fs from "fs";
import path from "path";
import { expect, test } from "vitest";
import type { Config } from "../config";
import type { SerializableClockWindows } from "../crafting/generate-blueprint";

/*
 * The new dispatch and its wake-up rule are read from the environment once, as their modules load (simulation/dispatch.ts):
 * set for the imports of this file alone, then set back, so that no other test file in this worker sees it.
 */
async function underTheNewDispatch() {
    const before = process.env.CLOCK_NEW_DISPATCH;
    process.env.CLOCK_NEW_DISPATCH = "1";
    try {
        return {
            ...await import("../crafting/generate-blueprint"), ...await import("../crafting/inserter-counters"),
            ...await import("../crafting/wake-ups"), ...await import("../verification/simulated-recording"), ...await import("./dispatch"),
        };
    } finally {
        if (before === undefined) delete process.env.CLOCK_NEW_DISPATCH;
        else process.env.CLOCK_NEW_DISPATCH = before;
    }
}

/**
 * The clock of the period recorded in Factorio 2.1.24 (crafting/fixtures/wake-ups-capture-2.1.24.json), run in the
 * simulator under the new dispatch: the clock positions at which its machine wakes each inserter, a period's worth, laid
 * against the positions at which the game delivered a wake-up by the machine.
 */
test("under the new dispatch the simulator wakes the inserters of the recorded period where the game does", async () => {
    const { simulateClockOnly, inserterEnds, wakeUpsOfStock, SIMULATED_TICK_TO_CLOCK_POSITION, DEFAULT_INSERTER_DISPATCH } = await underTheNewDispatch();
    expect(DEFAULT_INSERTER_DISPATCH).not.toBe("configured-order");
    const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "crafting", "fixtures", "wake-ups-capture-2.1.24.json"), "utf8")) as {
        clock: { config: Config; windows: SerializableClockWindows; period: number };
        inserters: Record<string, { woken_by_machine: number[] }>;
    };
    const { config, windows, period } = fixture.clock;
    const quiet = { log() { }, warn() { }, error() { }, debug() { } };
    const periods = 12;
    const stock = simulateClockOnly(config, windows, period, periods, quiet);
    // the last two periods, settled
    const from = (periods - 2) * period;
    const woken = new Map<string, Set<number>>();
    wakeUpsOfStock(stock, inserterEnds(config), from, (inserter_id, tick) => {
        if (!woken.has(inserter_id)) woken.set(inserter_id, new Set());
        woken.get(inserter_id)!.add((tick + SIMULATED_TICK_TO_CLOCK_POSITION) % period);
    });
    const game = (id: string) => fixture.inserters[id].woken_by_machine;
    // 23 and 279 (asleep and woken in one tick), 287, 686 and 1071 (switched off asleep on the list) among them; 61 is one
    // the game lacks (its inserter is already switched off there), which the simulator had before these two cases too
    expect([...woken.get("inserter:1")!].sort((a, b) => a - b)).toEqual([...game("inserter:1"), 61].sort((a, b) => a - b));
    expect([...woken.get("inserter:2")!].sort((a, b) => a - b)).toEqual(game("inserter:2"));
});
