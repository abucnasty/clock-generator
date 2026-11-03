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

/**
 * Ten periods of agricultural science recorded in Factorio 2.1.24 (crafting/fixtures/wake-ups-capture-agricultural-
 * science-2.1.24.json, the clock 3450755e from its staged start, 84 eggs in each egg machine), run in the simulator under
 * the new dispatch from the same start. Its loop of eggs does not repeat each period, so the counts are laid against the
 * game's over the ten periods.
 */
test("under the new dispatch the simulator wakes the inserters of agricultural science where the game does, its biochambers taking fuel at the game's ticks", async () => {
    const modules = await underTheNewDispatch();
    const { simulateClockOnly, inserterEnds, wakeUpsOfStock, InserterScheduling, StockRecorder } = modules;
    const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "crafting", "fixtures", "wake-ups-capture-agricultural-science-2.1.24.json"), "utf8")) as {
        count_from: number; ticks: number; inserters: Record<string, { woken_by_machine: [number, string][] }>;
        machines: Record<string, { fuel_taken: number[] }>;
        clock: Fixture["clock"] & { sample_offset: number; first_sample: number };
    };
    const { config, windows, period, sample_offset, first_sample } = fixture.clock;
    // the simulator's tick t is the fixture's tick t + sample_offset - first_sample
    const fixtureTick = (tick: number) => tick + sample_offset - first_sample;
    const counted = (tick: number) => tick >= fixture.count_from && tick < fixture.ticks;
    let tick = 0;
    const own = new Map<string, number[]>();
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
                    if (event.event !== "Activation" || event.cause === "control-finish-enable-edge" || event.cause === "hand-transfer") return;
                    if (counted(fixtureTick(tick))) (own.get(event.entity) ?? own.set(event.entity, []).get(event.entity)!).push(fixtureTick(tick));
                });
            }
            begin.call(this);
        }),
    ];
    const quiet = { log() { }, warn() { }, error() { }, debug() { } };
    const ruled = new Map<string, number[]>();
    const fuel_taken = new Map<string, number[]>();
    try {
        const stock = simulateClockOnly(config, windows, period, Math.ceil((fixture.ticks + first_sample) / period) + 1, quiet, { warmup_periods: 0 });
        wakeUpsOfStock(stock, inserterEnds(config), 1, (inserter_id, at) => {
            if (counted(fixtureTick(at))) (ruled.get(inserter_id) ?? ruled.set(inserter_id, []).get(inserter_id)!).push(fixtureTick(at));
        });
        for (const machine of stock.machines) {
            const taken = machine.fuel_taken ?? [];
            fuel_taken.set(machine.machine_id, taken.flatMap((count, at) => at > 0 && count > taken[at - 1] && counted(fixtureTick(at)) ? [fixtureTick(at)] : []));
        }
    } finally {
        for (const spy of spies) spy.mockRestore();
    }
    let game_all = 0, same_all = 0;
    for (const [id, { woken_by_machine }] of Object.entries(fixture.inserters)) {
        const game = woken_by_machine.map(([at]) => at).filter(counted);
        const mine = own.get(id) ?? [], rule = ruled.get(id) ?? [];
        // per inserter within 3% of the game's count (2,792 in all), by its own lists and by the rule on its states
        expect(Math.abs(mine.length - game.length), `${id} own ${mine.length} game ${game.length}`).toBeLessThanOrEqual(Math.max(1, 0.03 * game.length));
        expect(Math.abs(rule.length - game.length), `${id} rule ${rule.length} game ${game.length}`).toBeLessThanOrEqual(Math.max(1, 0.03 * game.length));
        game_all += game.length;
        same_all += mine.filter(at => game.includes(at)).length;
    }
    // the inserters that carry nutrients, which are fuel, into the egg machines sleep there and are woken by its fuel takes
    for (const id of ["inserter:3", "inserter:4", "inserter:6", "inserter:7"]) {
        expect(own.get(id)?.length ?? 0, id).toBeGreaterThan(100);
    }
    // and all but 1 of the 2,792 at the game's ticks
    expect(game_all - same_all).toBeLessThanOrEqual(1);
    // every biochamber takes each fuel item at the game's tick (208 for each egg machine, 27 for each nutrient machine), a
    // full productivity bar holding the machine in the middle of its craft until its output has room for a craft
    for (const [id, machine] of Object.entries(fixture.machines)) {
        expect(fuel_taken.get(id), `${id} fuel taken`).toEqual(machine.fuel_taken.filter(counted));
    }
});

/**
 * Ten settled periods of metallurgic science recorded in Factorio 2.1.24 (crafting/fixtures/wake-ups-capture-metallurgic-
 * science-2.1.24.json, the clock cec15038), run in the simulator under the new dispatch from the game's machines and hands
 * at the first counted sample. Inserters 4 and 5 take ore from a backed-up turbo belt into a machine that refuses it at its
 * insertion limit: the game lets them sleep on its input list only while both lines of the belt are still (56 times each in
 * the ten periods, woken by its craft starts and an output taken); asleep at every refusal, the simulator woke them about
 * 100 times a period.
 */
test("under the new dispatch the simulator wakes the belt-fed inserters of metallurgic science where the game does, tick for tick", async () => {
    const modules = await underTheNewDispatch();
    const { simulateClockOnly, InserterScheduling, StockRecorder } = modules;
    const { loadConfigFromFile } = await import("../config/loader");
    const { ConfigPaths } = await import("../config/config-paths");
    const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "crafting", "fixtures", "wake-ups-capture-metallurgic-science-2.1.24.json"), "utf8")) as {
        ticks: number; count_from: number; inserters: Record<string, { woken_by_machine: [number, string][] }>;
        clock: { windows: SerializableClockWindows; period: number };
        seed: { sample: number; start_stock: never; start_hands: never; main_clock_shift: number };
    };
    const config = await loadConfigFromFile(ConfigPaths.METALLURGIC_SCIENCE_PACK);
    const { windows, period } = fixture.clock;
    const { sample, start_stock, start_hands, main_clock_shift } = fixture.seed;
    // the simulator's tick t is the fixture's tick sample + 1 + t; its first ten ticks are left out (the seed holds no lists)
    const fixtureTick = (tick: number) => tick + sample + 1;
    const counted = (at: number) => at >= fixture.count_from + 10 && at < fixture.ticks;
    let tick = 0;
    const own = new Map<string, number[]>();
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
                    if (event.event !== "Activation" || event.cause === "control-finish-enable-edge" || event.cause === "hand-transfer") return;
                    if (counted(fixtureTick(tick))) (own.get(event.entity) ?? own.set(event.entity, []).get(event.entity)!).push(fixtureTick(tick));
                });
            }
            begin.call(this);
        }),
    ];
    const quiet = { log() { }, warn() { }, error() { }, debug() { } };
    try {
        simulateClockOnly(config, windows, period, Math.ceil((fixture.ticks - sample) / period) + 1, quiet,
            { keep_output_buffers: true, warmup_periods: 0, start_stock, start_hands, main_clock_shift });
    } finally {
        for (const spy of spies) spy.mockRestore();
    }
    for (const id of ["inserter:4", "inserter:5"]) {
        const game = fixture.inserters[id].woken_by_machine.map(([at]) => at).filter(counted);
        expect(game.length, id).toBe(54);
        expect(own.get(id), id).toEqual(game);
    }
});
