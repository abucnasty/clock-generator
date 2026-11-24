import { describe, expect, it, vi } from "vitest";
import { ConfigSchema } from "../config/schema";
import { generateClockAlternatives } from "./generate-blueprint";
import { timeStudyWindowsClock } from "./candidates/time-study-windows";
import { unclockedRun } from "./plan/unclocked-run";
import type { SimulationStabilityCheck } from "./plan/unclocked-run";

const quiet = { log() {}, warn() {}, error() {}, debug() {} };

/**
 * The run Time-Study Windows reads its windows off (the build under its output windows alone, every other inserter
 * free), caught as the maker makes it: its warm-up can be set longer, and its stability check is kept. Nothing else of
 * the run changes.
 */
const outputOnlyRun = vi.hoisted(() => ({
    inside: false,
    warmup_window_cycles: undefined as number | undefined,
    checks: [] as SimulationStabilityCheck[],
}));

vi.mock("./tick-ledger", async importOriginal => {
    const actual = await importOriginal<typeof import("./tick-ledger")>();
    return {
        ...actual,
        withTickPurpose: <T>(...args: Parameters<typeof actual.withTickPurpose<T>>): T => {
            const [purpose, work, options] = args;
            if (purpose !== "window_derivation") return actual.withTickPurpose(purpose, work, options);
            return actual.withTickPurpose(purpose, () => {
                outputOnlyRun.inside = true;
                try {
                    return work();
                } finally {
                    outputOnlyRun.inside = false;
                }
            }, options);
        },
    };
});

vi.mock("./trial", async importOriginal => {
    const actual = await importOriginal<typeof import("./trial")>();
    return {
        ...actual,
        runClockOnBuild: (...args: Parameters<typeof actual.runClockOnBuild>) => {
            if (!outputOnlyRun.inside) return actual.runClockOnBuild(...args);
            const [config, windows, window_cycle, logger, options = {}, fuel_clocks] = args;
            const warmup = outputOnlyRun.warmup_window_cycles;
            const run = actual.runClockOnBuild(config, windows, window_cycle, logger,
                warmup === undefined ? options : { ...options, warmup_window_cycles: warmup }, fuel_clocks);
            outputOnlyRun.checks.push(run.stability_check);
            return run;
        },
    };
});

/** A full, standing lane of iron plates in stacks of 4, ending at a dead end */
const LANE = { ingredient: "iron-plate", stack_size: 4, lane_end: { kind: "dead_end" } };

/**
 * Electronic circuits from an assembling machine 3 whose iron plates come from a belt through a steel chest with a slot
 * limit: one legendary stack inserter takes from the belt into the chest, another from the chest into the machine. The
 * copper cable comes from an infinity chest by a hand of 6, and the circuits go out into an infinity chest that takes them.
 */
const beltThroughChest = (storage_size: number) => ConfigSchema.parse({
    setpoint: { item: "electronic-circuit", items_per_second: 2, copies: 1 },
    machines: [{ id: 1, recipe: "electronic-circuit", prototype: "assembling-machine-3", crafting_speed: 1.25, productivity: 0 }],
    belts: [{ id: 1, type: "turbo-transport-belt", lanes: [LANE, LANE] }],
    inserters: [
        { id: 1, source: { type: "belt", id: 1, near_lane: 1, pickup_length: 1, pickup_layout: "side-straight" },
            sink: { type: "chest", id: 1 }, prototype: "stack-inserter", quality: "legendary", stack_size: 16, filters: ["iron-plate"] },
        { id: 2, source: { type: "chest", id: 1 }, sink: { type: "machine", id: 1 }, prototype: "stack-inserter", quality: "legendary", stack_size: 16 },
        { id: 3, source: { type: "chest", id: 2 }, sink: { type: "machine", id: 1 }, prototype: "stack-inserter", quality: "legendary",
            stack_size: 6, filters: ["copper-cable"] },
        { id: 4, source: { type: "machine", id: 1 }, sink: { type: "chest", id: 3 }, prototype: "stack-inserter", quality: "legendary",
            stack_size: 16, filters: ["electronic-circuit"] },
    ],
    chests: [
        { id: 1, type: "buffer-chest", storage_size, item_filter: "iron-plate", prototype: "steel-chest" },
        { id: 2, type: "infinity-chest", item_filter: [{ item_name: "copper-cable", request_count: 192 }] },
        { id: 3, type: "infinity-chest", item_filter: [], remove_unfiltered_items: true },
    ],
});

/** The output-only run of Time-Study Windows on a config, with the warm-up given in window cycles (undefined: its own) */
function outputOnlyCheck(storage_size: number, warmup_window_cycles: number | undefined): SimulationStabilityCheck {
    outputOnlyRun.warmup_window_cycles = warmup_window_cycles;
    outputOnlyRun.checks = [];
    try {
        timeStudyWindowsClock(beltThroughChest(storage_size), { logger: quiet }, "always");
    } finally {
        outputOnlyRun.warmup_window_cycles = undefined;
    }
    expect(outputOnlyRun.checks.length).toBeGreaterThan(0);
    return outputOnlyRun.checks[0];
}

/** What the run moves a window cycle over the window cycles its state repeats over, or over its one judged window cycle */
function itemsPerWindowCycle(check: SimulationStabilityCheck): number {
    return check.repeat_output_items !== undefined && check.repeat_window_cycles !== undefined
        ? check.repeat_output_items / check.repeat_window_cycles
        : check.actual_output_items;
}

describe("a belt that feeds a machine through a steel chest with a slot limit of 4", () => {
    // red today: the selected clock is the unstable 0.75 a second clock
    it("clocks: the selected clock is stable at 2 a second", () => {
        const result = generateClockAlternatives(beltThroughChest(4), { logger: quiet });
        const selected = result.alternatives[result.selected_index];
        expect({ verdict: selected.verdict, items_per_second: selected.assessment.items_per_second })
            .toEqual({ verdict: "stable", items_per_second: 2 });
    });

    // red today: inserter 4 drops 48 circuits in the 11 window cycles of the planning run, a hand of 16 every third
    // window cycle: its window opens for 12 ticks a window cycle, and the machine holds no more than 6 circuits
    it("plans its output: the planning run's output inserter drops its 16 circuits a window cycle", () => {
        const plan = unclockedRun(beltThroughChest(4), { logger: quiet });
        const { run } = plan;
        // the ticks the warm-up and the recorded run ran: a warm-up that stops at a repeated state runs fewer
        const window_cycles = ((run.clock_tick_at_start ?? 0) + run.recorded_duration.ticks) / run.duration.ticks;
        const output = run.simulation_context.inserters.map(it => it.inserter_state).find(it => it.entity_id.id === "inserter:4")!;
        // one hand short at most: the first window cycle of the warm-up starts with an empty hand
        expect(output.items_dropped).toBeGreaterThanOrEqual(16 * (window_cycles - 1));
    });
});

describe("Time-Study Windows on a steel chest of 36 slots", () => {
    // red today: with its own warm-up of 10 window cycles the run holds on its one judged window cycle (no repeat seen);
    // with 40 the state repeats every 4 window cycles with 80 circuits, 20 a window cycle against 16
    it("judges its output-only run the same with a warm-up of 10 and of 40 window cycles, at 16 a window cycle", () => {
        const ten = outputOnlyCheck(36, undefined);
        const forty = outputOnlyCheck(36, 40);
        const judged = (check: SimulationStabilityCheck) => ({
            holds: check.holds, repeat_window_cycles: check.repeat_window_cycles, repeat_output_items: check.repeat_output_items,
        });
        expect(judged(ten)).toEqual(judged(forty));
        expect(forty.holds).toBe(true);
        expect(forty.repeat_window_cycles).toBeDefined();
        expect(itemsPerWindowCycle(forty)).toBe(16);
    });
});
