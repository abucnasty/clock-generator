import { beforeAll, describe, expect, it } from "vitest";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import type { Config } from "../config/schema";
import { simulateClockOnly } from "./generate-blueprint";
import { generateClockAlternatives } from "./alternatives";
import { createEntityRegistryFromConfig } from "./sequence/simulation-context";
import { ruleCallsOfClock, ruleCallsOfSample } from "./rule-calls-of-sample";
import { ruleCount } from "./rule-count";
import { ruleCountInputOfStock } from "./rule-count-stock";
import { parseRecording } from "../verification/recording";
import { ruleCountInputOfRecording } from "../verification/recording-rule-count";
import { quiet } from "./generate-blueprint-test-helpers";

// The logistic science sample: one machine, three inserters, a clock of 264 ticks (3 output swings per cycle).
describe("the rule count of a simulated run", () => {
    let config: Config;
    let clock: ReturnType<typeof generateClockAlternatives>["alternatives"][number];

    beforeAll(async () => {
        config = await loadConfigFromFile(ConfigPaths.LOGISTIC_SCIENCE);
        const { alternatives, selected_index } = generateClockAlternatives(config, { logger: quiet });
        clock = alternatives[selected_index];
    });

    it("generates the clock itself when ruleCallsOfSample is not given the alternatives, and finds the same calls", () => {
        const given = ruleCallsOfClock(config, clock);
        const generated = ruleCallsOfSample(config, { logger: quiet });
        expect(generated.clock.id).toBe(given.clock.id);
        expect(generated.removal.w_removed_pooled).toBe(given.removal.w_removed_pooled);
    });

    const stockOf = (periods: number) => simulateClockOnly(
        { ...config, overrides: { ...config.overrides, terminal_swing_count: clock.result.used_terminal_swing_count } },
        clock.result.clock_windows, clock.result.simulation_duration.ticks, periods, quiet);

    // The simulator counts the crafts a machine starts; it reads them nowhere, so a run is what it was before. The
    // figures are those of the run before the counter existed (every series of the stock hashed alike, 40 periods).
    it("records the crafts a machine starts without changing the run", () => {
        expect(clock.id).toBe("swings-3");
        const stock = stockOf(40);
        expect(stock.ticks).toBe(10560);
        const machine = stock.machines[0];
        expect(machine.crafts_started).toHaveLength(stock.ticks);
        // a craft pays a product, and the productivity bar pays another for about each: 4082 finished for 2042 started
        expect(machine.products_finished.at(-1)).toBe(4082);
        expect(machine.crafts_started.at(-1)).toBe(2042);
        expect(machine.crafts_started.every((count, tick) => tick === 0 || count >= machine.crafts_started[tick - 1])).toBe(true);
        expect(clock.result.stability_check.as_built!.wake_ups!.wake_ups_per_minute).toBeCloseTo(177.27, 2);
    });

    it("turns a stock and the config's entities into the rule count's input", () => {
        const stock = stockOf(10);
        const registry = createEntityRegistryFromConfig(config);
        const input = ruleCountInputOfStock(stock, registry, id => id === "inserter:1");
        expect(input.machines).toHaveLength(1);
        expect(input.machines[0]).toMatchObject({ machine_id: "machine:1", recipe: "logistic-science-pack" });
        expect(input.machines[0].working).toHaveLength(stock.ticks);
        expect(input.machines[0].working.some(it => it) && input.machines[0].working.some(it => !it)).toBe(true);
        expect(input.machines[0].crafts_started).toBe(stock.machines[0].crafts_started);
        expect(input.inserters.map(it => it.inserter_id).sort()).toEqual(stock.inserters.map(it => it.inserter_id).sort());
        const kinds = input.inserters.map(it => `${it.source_kind} to ${it.sink_kind}`).sort();
        expect(kinds).toEqual(["belt to machine", "belt to machine", "machine to belt"]);
        expect(input.inserters.filter(it => it.wired).map(it => it.inserter_id)).toEqual(["inserter:1"]);
        const output = input.inserters.find(it => it.source_kind === "machine")!;
        expect(output).toMatchObject({ source_machine_id: "machine:1", sink_machine_id: null, items: ["logistic-science-pack"] });
        expect(output.states).toBe(stock.inserters.find(it => it.inserter_id === output.inserter_id)!.factorio_state);
    });

    it("gives each machine its true starts from the simulator's crafts_started", () => {
        const stock = stockOf(40);
        const input = ruleCountInputOfStock(stock, createEntityRegistryFromConfig(config), () => true);
        for (const [m, machine] of input.machines.entries()) {
            const started = stock.machines[m].crafts_started;
            expect(machine.true_starts?.filter(Boolean).length).toBe(started[started.length - 1] - started[0]);
        }
        const run = ruleCount(input.inserters, input.machines, Math.floor(stock.ticks / 3), stock.ticks);
        expect(run.true_start_unknown).toEqual([]);
    });

    it("works out the removal and the calls of a clock, over the ticks of its long run", () => {
        const calls = ruleCallsOfClock(config, clock);
        expect(calls.from_tick).toBe(Math.floor(calls.to_tick / 3));
        // the clocked run is the long run again: goal 2's count of it is the generator's own
        expect(calls.clocked_wake_ups_per_minute.here).toBeCloseTo(calls.clocked_wake_ups_per_minute.long_run, 9);
        expect(calls.unwired_run.ticks).toBe(calls.clocked_run.ticks);
        expect(calls.unwired_run.groups.every(group => group.wired === 0)).toBe(true);
        expect(calls.clocked_run.groups.reduce((sum, group) => sum + group.wired, 0)).toBe(3);
        expect(calls.removal.newly_wired_inserters).toBe(3);
        expect(calls.removal.w_removed_pooled).toBeCloseTo(549.7, 1);
        expect(calls.removal.call).toMatchObject({ call: "clock", firm: true, region: "above 175.7", count: "true starts" });
        expect(calls.removal.groups.map(group => group.status)).toEqual(["newly wired", "newly wired", "newly wired"]);
        // its sinks are fed from belts at +0%: the true starts are the inferred ones, and the two counts agree
        expect(calls.removal_original.w_removed_pooled).toBeCloseTo(calls.removal.w_removed_pooled!, 9);
        expect(calls.removal_original.call).toMatchObject({ call: "clock", firm: true, region: "above 207.6", count: "original" });
    });
});

describe("the rule count of a recording of the game", () => {
    // two samples of a machine that finishes at sample 3, and an inserter that waits for items and then picks up
    const recording = parseRecording({
        format: "clock-generator-recording", version: 1, start_game_tick: 0, sample_count: 6,
        config: { inserters: [], belts: [] },
        machines: [{
            id: 7, name: "assembling-machine-3", recipe: "gear",
            samples: {
                status: [[0, "working"], [3, "item_ingredient_shortage"]],
                crafting_progress: [0, 0, 0, 0, 0, 0], bonus_progress: [0, 0, 0, 0, 0, 0],
                products_finished: [0, 0, 0, 1, 1, 1], inputs: {}, outputs: {},
            },
        }],
        inserters: [{
            id: 2, name: "fast-inserter", source: { type: "machine", id: 7 }, sink: { type: "belt", id: 1 }, stack_size: 2,
            samples: {
                held_count: [0, 0, 0, 0, 2, 2], held_item: [[0, ""], [4, "gear"]],
                status: [[0, "working"], [1, "waiting_for_source_items"], [3, "working"]],
            },
        }],
    });

    it("reads the ends, the items in the hand, and the machine's working status", () => {
        const input = ruleCountInputOfRecording(recording, id => id === "inserter:2");
        expect(input.machines).toEqual([{
            machine_id: "machine:7", recipe: "gear", products_finished: [0, 0, 0, 1, 1, 1],
            working: [true, true, true, false, false, false],
        }]);
        expect(input.inserters).toEqual([{
            inserter_id: "inserter:2", source_kind: "machine", sink_kind: "belt", source_machine_id: "machine:7", sink_machine_id: null,
            items: ["gear"], wired: true,
            states: ["working", "waiting_for_source_items", "waiting_for_source_items", "working", "working", "working"],
            held: [0, 0, 0, 0, 2, 2],
        }]);
    });

    it("counts a wake-up for the finish after the wait, and the pickup it explains no further", () => {
        const input = ruleCountInputOfRecording(recording, () => false);
        const run = ruleCount(input.inserters, input.machines, 0, 6);
        // waited at 2, the machine finished at 3: one wake-up; the hand rose at 4, one index after it: explained
        expect(run.inserters[0]).toMatchObject({ source_wake_ups: 1, sink_wake_ups: 0, pickups: 0, true_wake_ups: 1 });
        expect(run.groups[0]).toMatchObject({ key: "machine to belt | gear | gear > ", wired: 0 });
    });
});
