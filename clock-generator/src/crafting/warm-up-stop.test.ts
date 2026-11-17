import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Config } from "../config";
import type { EnableControlOverrideConfig } from "../config/schema";
import { ConfigPaths } from "../config/config-paths";
import { loadConfigFromFile } from "../config/loader";
import { OpenRange } from "../data-types";
import { quiet } from "./generate-blueprint-test-helpers";
import type { StockRecording } from "./machine-stock";
import { runBuild, unclockedRun } from "./plan/unclocked-run";
import * as state from "./runner/steady-state";
import * as repeat from "./runner/warm-up-repeat";
import { WarmupStep } from "./runner/steps/warmup-step";
import { buildAsBuiltConfig } from "./trial";

/** The controls' key as the run makes it, kept before any spy on it */
const controlsKeyOf = repeat.controlsKeyOf;

/** The metallurgic science clock of 640/3 ticks as built (fixture): it repeats in 640 whole ticks, 3 window cycles */
async function metallurgic(): Promise<{ built: Config; window_cycle_ticks: number }> {
    const controls = JSON.parse(readFileSync(path.join(__dirname, "fixtures/metallurgic-subtick-controls.json"), "utf8")) as {
        lcm: number; terminal_swing_count: number; window_cycle_ticks: number; clock_windows: Record<string, { start: number; end: number }[]>;
    };
    const sample = await loadConfigFromFile(ConfigPaths.METALLURGIC_SCIENCE_45);
    const config = { ...sample, overrides: { ...sample.overrides, lcm: controls.lcm, terminal_swing_count: controls.terminal_swing_count } };
    const windows = new Map(Object.entries(controls.clock_windows).map(([id, ranges]) => [id, ranges.map(range => OpenRange.from(range.start, range.end))]));
    return { built: buildAsBuiltConfig(config, windows, controls.window_cycle_ticks), window_cycle_ticks: controls.window_cycle_ticks };
}

/** The build with its output inserter (machine 3 into the chest) on a control of its own instead of its clock */
function withOutputOn(built: Config, enable_control: EnableControlOverrideConfig): Config {
    const output = built.inserters.findIndex(inserter => inserter.source.type === "machine" && inserter.sink.type === "chest");
    expect(output).toBeGreaterThanOrEqual(0);
    return { ...built, inserters: built.inserters.map((inserter, index) => index === output ? { ...inserter, overrides: { ...inserter.overrides, enable_control } } : inserter) };
}
const always_true = { operator: "AND" as const, rules: [{ left: { type: "CONSTANT" as const, value: 1 }, operator: ">" as const, right: { type: "CONSTANT" as const, value: 0 } }] };
const never_true = { operator: "AND" as const, rules: [{ left: { type: "CONSTANT" as const, value: 0 }, operator: ">" as const, right: { type: "CONSTANT" as const, value: 1 } }] };

/**
 * A cold run of the build after a warm-up of `warmup` window cycles, its clocks running on through the recorded run; with
 * `unstopped`, every state key differs, so the warm-up never stops and runs in full
 */
function run(built: Config, window_cycle_ticks: number, warmup: number, unstopped = false) {
    const spy = unstopped ? vi.spyOn(state, "simulationStateKey").mockImplementation(context => `tick ${context.tick_provider.getCurrentTick()}`) : undefined;
    try {
        return runBuild(built, { logger: quiet, cold_start: true, window_cycle_ticks, warmup_window_cycles: warmup, counter_runs_through: true,
            machine_stock: true, factorio_states: false });
    } finally {
        spy?.mockRestore();
    }
}

/** The counts "so far" of a stock from the start of its run: they count from the cold start, which a stopped warm-up is fewer ticks from */
function fromItsStart(stock: StockRecording | undefined): StockRecording | undefined {
    const counts = ["products_finished", "crafts_started", "results_placed", "fuel_taken", "fuel_put_in"] as const;
    return stock && { ...stock, machines: stock.machines.map(machine => ({ ...machine, ...Object.fromEntries(counts.flatMap(count => {
        const series = machine[count];
        return series === undefined ? [] : [[count, series.map(value => value - series[0])]];
    })) })) };
}

/** The warm-up stopped where `ticks` says, and the run recorded after it is the one recorded after the full warm-up */
function expectStoppedExactly(built: Config, window_cycle_ticks: number, warmup: number,
    ticks: { full: number; ran: number | { before: number; whole_repeats_of: number }; repeat_window_cycles?: number }) {
    const stopped = run(built, window_cycle_ticks, warmup);
    const full = run(built, window_cycle_ticks, warmup, true);
    expect(full.clock_tick_at_start).toBe(ticks.full);
    if (typeof ticks.ran === "number") {
        expect(stopped.clock_tick_at_start).toBe(ticks.ran);
    } else {
        expect(stopped.clock_tick_at_start).toBeLessThan(ticks.ran.before);
        expect((ticks.full - stopped.clock_tick_at_start!) % ticks.ran.whole_repeats_of).toBe(0);
    }
    expect(fromItsStart(stopped.machine_stock)).toEqual(fromItsStart(full.machine_stock));
    // the stability check reads the repeat the warm-up found only on a build clocked throughout on the run's window
    // cycle, as before; the warm-ups that stop now leave it as the full warm-up does
    const { repeat_window_cycles, repeat_output_items: _items, ...check } = stopped.stability_check;
    const { repeat_window_cycles: _cycles, repeat_output_items: _full_items, ...full_check } = full.stability_check;
    expect(repeat_window_cycles).toBe(ticks.repeat_window_cycles);
    expect(check).toEqual(full_check);
}

/**
 * The planning run of a config (every inserter on the plan's controls): the ticks its warm-up ran, and the plan read off
 * it (the transfers of every inserter and the stability check). Every state key differs with "every key differs", so
 * the warm-up runs in full; the controls' line of the key counts up at every boundary with "the controls' count grows".
 */
function planning(config: Config, keys: "every key differs" | "the controls' count grows" | "as built" = "as built") {
    const spies = [
        keys === "every key differs" ? vi.spyOn(state, "simulationStateKey").mockImplementation(context => `tick ${context.tick_provider.getCurrentTick()}`) : undefined,
        keys === "the controls' count grows" ? vi.spyOn(repeat, "controlsKeyOf").mockImplementation(controls => {
            const key = controlsKeyOf(controls);
            let count = 0;
            return () => `${key()};${count++}`;
        }) : undefined,
    ];
    const warm_ups: number[] = [];
    const execute = WarmupStep.prototype.execute;
    const spy = vi.spyOn(WarmupStep.prototype, "execute").mockImplementation(function (this: WarmupStep) {
        execute.call(this);
        warm_ups.push(this.ticks_run);
    });
    try {
        const { run } = unclockedRun(config, { logger: quiet });
        const transfers = [...run.final_history.getAllTransfers().entries()].map(([id, list]) => [id.id, list]);
        const { repeat_window_cycles: _cycles, repeat_output_items: _items, ...check } = run.stability_check;
        return { ran: warm_ups[0], plan: { transfers, check } };
    } finally {
        spy.mockRestore();
        spies.forEach(it => it?.mockRestore());
    }
}

describe("the warm-up's stop on a repeated state", () => {
    it("stops a window cycle of p/q ticks only on its whole-tick repeat, in the state the full warm-up ends in", async () => {
        const { built, window_cycle_ticks } = await metallurgic();
        // 80 window cycles of 640/3 ticks run 17,067 whole ticks; the state at 7,467 is 15 repeats of 640 ticks before that
        expectStoppedExactly(built, window_cycle_ticks, 80, { full: 17067, ran: 7467 });
        expect((17067 - 7467) % 640).toBe(0);
    });

    it("stops a build with an inserter that is not clocked, on a condition of what the key holds, where its state repeats", async () => {
        const { built, window_cycle_ticks } = await metallurgic();
        expectStoppedExactly(withOutputOn(built, { mode: "CONDITIONAL", rule_set: always_true }), window_cycle_ticks, 80, { full: 17067, ran: 7467 });
        // a condition that turns on and off with what the machine holds: the inserter's wakes, which the key holds, carry it
        // from one tick to the next
        const four_packs = { operator: "AND" as const, rules: [{ left: { type: "INVENTORY_ITEM" as const, entity: "SOURCE" as const, item_name: "metallurgic-science-pack" },
            operator: ">=" as const, right: { type: "CONSTANT" as const, value: 4 } }] };
        expectStoppedExactly(withOutputOn(built, { mode: "CONDITIONAL", rule_set: four_packs }), window_cycle_ticks, 80,
            { full: 17067, ran: { before: 17067, whole_repeats_of: 640 } });
    });

    it("stops a build with a latched condition, whose latch the controls' key holds, where its state repeats", async () => {
        const { built, window_cycle_ticks } = await metallurgic();
        const latched = withOutputOn(built, { mode: "CONDITIONAL", rule_set: always_true, latch: { release: never_true } });
        expectStoppedExactly(latched, window_cycle_ticks, 80, { full: 17067, ran: { before: 17067, whole_repeats_of: 640 } });
    });

    it("runs the full warm-up where the state has not repeated", async () => {
        const { built, window_cycle_ticks } = await metallurgic();
        // 40 window cycles (8,534 ticks) end before the state repeats
        expect(run(withOutputOn(built, { mode: "CONDITIONAL", rule_set: always_true }), window_cycle_ticks, 40).clock_tick_at_start).toBe(8534);
    });

    it("stops a planning run where its state and its controls' counts and latches repeat, with the plan the full warm-up gives", async () => {
        const config = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE_240);
        const stopped = planning(config);
        const full = planning(config, "every key differs");
        expect(full.ran).toBe(1440);
        expect(stopped.ran).toBe(1008);
        expect(stopped.plan).toEqual(full.plan);
    });

    it("runs a planning run in full where its controls' counts do not repeat, though the simulation's state does", async () => {
        const config = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE_240);
        expect(planning(config, "the controls' count grows").ran).toBe(1440);
    });

    it("stops a build clocked throughout on a whole-tick window cycle where it stopped before", async () => {
        // automation science 240's recommended clock of 216 ticks (the record at c507b0f1)
        const config = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE_240);
        const windows = new Map(Object.entries({ "inserter:1": "28-51 100-123 172-195", "inserter:2": "1-12 37-48 73-84 109-120 145-156 181-192" })
            .map(([id, text]) => [id, text.split(" ").map(range => range.split("-").map(Number)).map(([start, end]) => OpenRange.from(start, end))]));
        // the state repeats every 5 window cycles: 8,640 ticks are 6 repeats after 2,160
        expectStoppedExactly(buildAsBuiltConfig(config, windows, 216), 216, 40, { full: 8640, ran: 2160, repeat_window_cycles: 5 });
    });
});
