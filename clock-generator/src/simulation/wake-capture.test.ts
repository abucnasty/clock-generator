import fs from "fs";
import path from "path";
import { expect, test, vi } from "vitest";
import type { Config } from "../config";
import type { SerializableClockWindows } from "../crafting/generate-blueprint";
import type { SchedulingEvent } from "./active-scheduler";

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
            ...await import("../crafting/wake-ups"), ...await import("../crafting/machine-stock"),
            ...await import("../verification/simulated-recording"), ...await import("./dispatch"), ...await import("./inserter-scheduling"),
        };
    } finally {
        if (before === undefined) delete process.env.CLOCK_NEW_DISPATCH;
        else process.env.CLOCK_NEW_DISPATCH = before;
    }
}

interface Fixture {
    clock: { config: Config; windows: SerializableClockWindows; period: number };
    inserters: Record<string, { states: [number, string][]; woken_by_machine: number[] }>;
}

/**
 * The clock of a period recorded in Factorio 2.1.24 (crafting/fixtures/wake-ups-capture-*.json), run in the simulator
 * under the new dispatch, the last two of 12 periods: per inserter, the clock positions at which its machine woke it by
 * the simulator's own lists (an alarm of the machine that put it back on the update list), the positions the rule
 * counts on its states, and the positions the clock switched it on at
 */
async function simulated(file: string): Promise<{ fixture: Fixture; own: Map<string, number[]>; ruled: Map<string, number[]>; switched_on: Map<string, number[]> }> {
    const modules = await underTheNewDispatch();
    const { simulateClockOnly, inserterEnds, wakeUpsOfStock, SIMULATED_TICK_TO_CLOCK_POSITION, DEFAULT_INSERTER_DISPATCH, InserterScheduling, StockRecorder } = modules;
    expect(DEFAULT_INSERTER_DISPATCH).not.toBe("configured-order");
    const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "crafting", "fixtures", file), "utf8")) as Fixture;
    const { config, windows, period } = fixture.clock;
    const quiet = { log() { }, warn() { }, error() { }, debug() { } };
    const periods = 12;
    const from = (periods - 2) * period;
    const position = (tick: number) => (tick + SIMULATED_TICK_TO_CLOCK_POSITION) % period;
    const add = (map: Map<string, number[]>, id: string, tick: number) => {
        if (tick < from) return;
        if (!map.has(id)) map.set(id, []);
        map.get(id)!.push(position(tick));
    };
    // the scheduling's events, by the tick the stock records next (its after-tick sample)
    let tick = 0;
    const own = new Map<string, number[]>(), switched_on = new Map<string, number[]>();
    const observed = new WeakSet<object>();
    const record = StockRecorder.prototype.record;
    const begin = InserterScheduling.prototype.beginUpdates;
    const spies = [
        vi.spyOn(StockRecorder.prototype, "record").mockImplementation(function (this: InstanceType<typeof StockRecorder>) {
            record.call(this);
            tick++;
        }),
        vi.spyOn(InserterScheduling.prototype, "beginUpdates").mockImplementation(function (this: InstanceType<typeof InserterScheduling>) {
            if (!observed.has(this)) {
                observed.add(this);
                this.observe((event: SchedulingEvent) => {
                    if (event.event !== "Activation") return;
                    if (event.cause === "control-finish-enable-edge") add(switched_on, event.entity, tick);
                    else if (event.cause !== "hand-transfer") add(own, event.entity, tick);
                });
            }
            begin.call(this);
        }),
    ];
    try {
        const stock = simulateClockOnly(config, windows, period, periods, quiet);
        const ruled = new Map<string, number[]>();
        wakeUpsOfStock(stock, inserterEnds(config), from, (inserter_id, at) => add(ruled, inserter_id, at));
        return { fixture, own, ruled, switched_on };
    } finally {
        for (const spy of spies) spy.mockRestore();
    }
}

/** The fixture's positions of a list of each inserter, once each, in order */
const positions = (map: Map<string, number[]>, id: string) => [...new Set(map.get(id) ?? [])].sort((a, b) => a - b);

/** The positions at which the game shows each inserter switched on: disabled after the tick before, not after it */
function switchOns(fixture: Fixture, id: string): number[] {
    const changes = fixture.inserters[id].states;
    return changes.flatMap(([at, state], index) => index > 0 && changes[index - 1][1] === "disabled_by_control_behavior"
        && state !== "disabled_by_control_behavior" ? [at % fixture.clock.period] : []).sort((a, b) => a - b);
}

test.each([
    ["front exit onto a belt", "wake-ups-capture-2.1.24.json"],
    ["two takers into chests", "wake-ups-capture-electromagnetic-science-2.1.24.json"],
])("under the new dispatch the simulator wakes the inserters of the recorded period where the game does: %s", async (_, file) => {
    const { fixture, own, ruled, switched_on } = await simulated(file);
    for (const id of Object.keys(fixture.inserters)) {
        // the events are read at the ticks the stock records them: the switch-ons fall where the game's do
        expect(positions(switched_on, id), `${id} switched on`).toEqual(switchOns(fixture, id));
        const game = [...fixture.inserters[id].woken_by_machine].map(tick => tick % fixture.clock.period).sort((a, b) => a - b);
        expect(positions(own, id), `${id} by its own lists`).toEqual(game);
        expect(positions(ruled, id), `${id} by the rule on its states`).toEqual(game);
        // the same in each of the two periods
        expect(own.get(id) ?? []).toHaveLength(2 * game.length);
        expect(ruled.get(id) ?? []).toHaveLength(2 * game.length);
    }
});
