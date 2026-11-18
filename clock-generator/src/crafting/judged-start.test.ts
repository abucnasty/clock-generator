import { describe, expect, it } from "vitest";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import type { Config } from "../config/schema";
import { OpenRange } from "../data-types";
import { Entity } from "../entities";
import { readControls } from "../../tests/game/builds/clock-controls";
import { runClockOnBuild } from "./trial";
import { SimulationContext } from "./sequence/simulation-context";
import { BackpressureFillStep, fillStateKey, lanePhaseTicks, observeFills, type FillReport } from "./runner/steps/backpressure-fill-step";
import { EntityState } from "../state";
import { SimulationTick } from "./runner/simulation-tick";
import { withTickPurpose } from "./tick-ledger";
import { startDependenceSummary } from "./alternatives";

// docs/stability.md, "How a clock is started": `overrides.judged_start` "backpressure" runs the part of the build that no
// clock controls until it settles, and the clock starts there (the default); "cold" starts it on an empty build
const quiet = { log() { }, info() { }, warn() { }, error() { }, debug() { } };

// the over-the-hood turbo build of the lane phase controls: one machine, an output inserter and an input inserter that takes
// from an independent moving lane (a turbo belt, whose stacks stand in the same place every 2 ticks)
const { over_hood_turbo_trace: native } = readControls<{ over_hood_turbo_trace: { config: Config; period: number; terminal_swings: number;
    clock_windows: Record<string, { start: number; end: number }[]> } }>("lane-phase-controls.json");

const windowsOf = (...ids: string[]) => new Map(Object.entries(native.clock_windows).filter(([id]) => ids.includes(id))
    .map(([id, ranges]) => [id, ranges.map(range => OpenRange.from(range.start, range.end))]));
const BOTH = windowsOf("inserter:1", "inserter:2");

const configOf = (judged_start?: "cold" | "backpressure", belt_type?: string): Config => ({
    ...native.config,
    ...(belt_type !== undefined && { belts: native.config.belts.map(belt => ({ ...belt, type: belt_type })) as Config["belts"] }),
    overrides: { ...native.config.overrides, terminal_swing_count: native.terminal_swings, ...(judged_start !== undefined && { judged_start }) },
});

/** The first window cycle of the clock on `windows`, with no warm-up of its own, and the fills the run made */
function firstWindowCycle(config: Config, windows: ReturnType<typeof windowsOf>, extra: Parameters<typeof runClockOnBuild>[4] = {}) {
    const reports: FillReport[] = [];
    const stop = observeFills(report => reports.push(report));
    try {
        const run = runClockOnBuild(config, windows, native.period, quiet, { warmup_window_cycles: 0, simulate_window_cycles: 1, machine_stock: true, factorio_states: false, ...extra });
        return { stock: run.machine_stock!, reports, output: run.stability_check.actual_output_items };
    } finally {
        stop();
    }
}

describe("a clock-only run from the backpressure start", () => {
    it("fills the machine an unclocked inserter feeds before the clock starts, and the cold start does not", () => {
        const only_output = windowsOf("inserter:1");
        const cold = firstWindowCycle(configOf("cold"), only_output);
        const filled = firstWindowCycle(configOf("backpressure"), only_output);
        const ingredients = (stock: typeof cold.stock) => Object.values(stock.machines[0].inputs).map(series => series[0]);
        expect(ingredients(cold.stock).every(count => count === 0)).toBe(true);
        expect(ingredients(filled.stock).every(count => count > 0)).toBe(true);
        expect(filled.reports).toHaveLength(1);
        expect(filled.reports[0].fill?.end).toBe("repeat");
    });

    it("is the backpressure start where the config names no start", () => {
        const only_output = windowsOf("inserter:1");
        const named = firstWindowCycle(configOf("backpressure"), only_output);
        const by_default = firstWindowCycle(configOf(), only_output);
        expect(by_default.reports).toHaveLength(1);
        expect(by_default.reports).toEqual(named.reports);
        expect(by_default.stock).toEqual(named.stock);
        expect(by_default.output).toBe(named.output);
    });

    it("is the cold start where the config asks for it", () => {
        const only_output = windowsOf("inserter:1");
        const cold = firstWindowCycle(configOf("cold"), only_output);
        expect(cold.reports).toEqual([]);
        expect(Object.values(cold.stock.machines[0].inputs).every(series => series[0] === 0)).toBe(true);
    });

    it("starts exactly as from the cold start where every inserter is clocked", () => {
        const cold = firstWindowCycle(configOf("cold"), BOTH);
        const filled = firstWindowCycle(configOf("backpressure"), BOTH);
        expect(filled.reports).toHaveLength(1);
        expect(filled.reports[0].held_off).toBe(2);
        expect(filled.stock).toEqual(cold.stock);
        expect(filled.output).toBe(cold.output);
    });

    it("keeps the cold start for a run that makes windows", () => {
        const only_output = windowsOf("inserter:1");
        const cold = firstWindowCycle(configOf("cold"), only_output);
        const made = withTickPurpose("window_derivation", () => firstWindowCycle(configOf("backpressure"), only_output));
        expect(made.reports).toEqual([]);
        expect(made.stock).toEqual(cold.stock);
        const judged = withTickPurpose("long_run", () => firstWindowCycle(configOf("backpressure"), only_output));
        expect(judged.reports).toHaveLength(1);
    });

    it("fills a run with an `on_context` reader too, and ends at a whole number of window cycles, the tick the reader sees", () => {
        const ticks_seen: number[] = [];
        const read = firstWindowCycle(configOf("backpressure"), BOTH, { on_context: context => context.after_inserters.push({ tick() { ticks_seen.push(context.tick_provider.getCurrentTick()); } }) });
        expect(read.reports).toHaveLength(1);
        expect(read.reports[0].fill!.ticks % native.period).toBe(0);
        // the reader sees the fill's ticks as it sees a warm-up, and the clock's window cycle ends on a multiple of the window cycle
        expect(ticks_seen).toHaveLength(read.reports[0].fill!.ticks + native.period);
        expect(ticks_seen[ticks_seen.length - 1] % native.period).toBe(0);
    });

    it("keeps the cold start where nothing is clocked: the run is its own fill", () => {
        const none = firstWindowCycle(configOf("backpressure"), new Map());
        expect(none.reports).toHaveLength(1);
        expect(none.reports[0].kept_cold).toBe("nothing_clocked");
        expect(none.stock).toEqual(firstWindowCycle(configOf("cold"), new Map()).stock);
    });
});

describe("the result's start sentence", () => {
    it("names the start the clocks were judged from, and how to choose the other", () => {
        const by_default = startDependenceSummary(configOf(), []).start_dependence_note;
        expect(by_default).toContain("judged from the backpressure start alone");
        expect(by_default).toContain("overrides.judged_start");
        expect(startDependenceSummary(configOf("backpressure"), []).start_dependence_note).toBe(by_default);
        expect(startDependenceSummary(configOf("cold"), []).start_dependence_note).toContain("judged from the cold start of the scaffold alone");
    });
});

describe("the fill step", () => {
    const contextOf = (belt_type?: string) => SimulationContext.fromConfig(configOf(undefined, belt_type));
    const everyone = new Set(["inserter:1", "inserter:2"]);
    const beltKeys = (context: SimulationContext) => context.state_registry.getAllStates().filter(EntityState.isBelt)
        .map(belt => belt.stateKey(context.tick_provider.getCurrentTick()));

    it("ends at the lane phase the cold start has at its tick 0, whatever the belt's speed", () => {
        for (const [belt, phase_ticks] of [["turbo-transport-belt", 2], ["express-transport-belt", 8], ["transport-belt", 8]] as const) {
            const context = contextOf(belt);
            expect(lanePhaseTicks(context)).toBe(phase_ticks);
            const fill = new BackpressureFillStep(context, everyone).execute();
            expect(fill.end, belt).toBe("repeat");
            expect(context.tick_provider.getCurrentTick() % phase_ticks, belt).toBe(0);
            // every belt, each lane's place in its stack spacing included, is as the cold start has it at tick 0
            expect(beltKeys(context), belt).toEqual(beltKeys(contextOf(belt)));
        }
    });

    it("ends where the lane stands as it did at tick 0 and not after a fixed pad: a basic belt takes more ticks than a turbo belt", () => {
        const ends = ["turbo-transport-belt", "transport-belt"].map(belt => {
            const context = contextOf(belt);
            new BackpressureFillStep(context, everyone).execute();
            return context.tick_provider.getCurrentTick();
        });
        expect(ends[0] % 2).toBe(0);
        expect(ends[1] % 8).toBe(0);
    });

    it("ends a build whose unclocked part keeps flowing at its steady state, and not at the first still tick", async () => {
        const context = SimulationContext.fromConfig(await loadConfigFromFile(ConfigPaths.PROCESSING_UNIT_15_CHEST_FED));
        const fill = new BackpressureFillStep(context, new Set()).execute();
        expect(fill.end).toBe("repeat");
        expect(fill.period).toBeGreaterThan(1);
        // from there on it repeats: the state comes again after `period` ticks and in no tick before
        const at_the_end = fillStateKey(context);
        const states = new Set<string>();
        const tick = new SimulationTick(context);
        for (let step = 0; step < fill.period!; step++) {
            states.add(fillStateKey(context));
            tick.executeForTick();
        }
        expect(fillStateKey(context)).toBe(at_the_end);
        expect(states.size).toBe(fill.period);
    });

    it("compares the state exactly: a build that never repeats is stopped at the cap and named, not rounded into a repeat", async () => {
        const context = SimulationContext.fromConfig(await loadConfigFromFile(ConfigPaths.LOGISTIC_SCIENCE_240));
        const fill = new BackpressureFillStep(context, new Set()).execute();
        expect(fill.end).toBe("cap");
        expect(fill.period).toBeNull();
        expect(fill.changing!.length).toBeGreaterThan(0);
    });

    it("starts a machine that no inserter feeds full: a casting foundry on fluid has made all it holds", async () => {
        const config = await loadConfigFromFile(ConfigPaths.PROCESSING_UNIT_80_CIRCUIT_EXPORT);
        const context = SimulationContext.fromConfig(config);
        const registry = context.entity_registry;
        const fed = new Set(registry.getAll().filter(Entity.isInserter).map(inserter => inserter.sink.entity_id.id));
        const unfed = context.machines.filter(({ machine_state }) => !fed.has(machine_state.entity_id.id));
        expect(unfed.length).toBeGreaterThan(0);
        const made = () => unfed.map(({ machine_state }) => machine_state.machine.outputs
            .map(output => machine_state.inventoryState.getQuantity(output.item_name)));
        expect(made().flat().every(count => count === 0)).toBe(true);
        const everything = new Set(config.inserters.map((inserter, index) => `inserter:${inserter.id ?? index + 1}`));
        const fill = new BackpressureFillStep(context, everything).execute();
        expect(fill.end).toBe("repeat");
        expect(made().every(counts => counts.some(count => count > 0))).toBe(true);
    });
});
