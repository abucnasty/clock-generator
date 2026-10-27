import { describe, expect, it } from "vitest";
import { ConfigPaths } from "../config/config-paths";
import { loadConfigFromFile } from "../config/loader";
import { StockRecorder } from "./machine-stock";
import { SimulationContext } from "./sequence/simulation-context";
import { runBuild } from "./plan/plan-run";

const quiet = { log() { }, info() { }, warn() { }, error() { }, debug() { } };

/** The arrays of a recording: every series of every machine and inserter */
function seriesOf(recording: ReturnType<StockRecorder["recording"]>): (string[] | number[])[] {
    return [
        ...recording.machines.flatMap(m => [...Object.values(m.inputs), ...Object.values(m.outputs), m.fuel, m.status, m.products_finished, m.crafts_started, m.results_placed, m.crafting_progress, m.bonus_progress]),
        ...recording.inserters.flatMap(i => [i.held, i.held_item, i.status, i.factorio_state]),
    ].filter((series): series is string[] | number[] => series !== undefined);
}

describe("the stock recorder", () => {
    it("records the same series whether they are made for the ticks of the run or grown, however many ticks it records", async () => {
        const config = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE);
        const context = SimulationContext.fromConfig(config);
        const machines = context.machines.map(it => it.machine_state);
        const inserters = context.inserters.map(it => ({ state: it.inserter_state, sink: it.sink_state }));
        const recorded = (ticks: number, expected_ticks?: number) => {
            const recorder = new StockRecorder(machines, inserters, expected_ticks);
            for (let tick = 0; tick < ticks; tick++) {
                recorder.record();
            }
            return recorder.recording();
        };
        const grown = recorded(20);
        expect(grown.ticks).toBe(20);
        expect(seriesOf(grown).length).toBeGreaterThan(0);
        // exactly the ticks made for, fewer (a run that ended at a repeat) and more (cannot happen, but is still recorded)
        // and a length that is no count of ticks (a fraction, a negative, not a number) is grown as before, not refused
        for (const expected_ticks of [20, 50, 8, 20.5, 0.5, -3, Number.NaN, Infinity]) {
            const made = recorded(20, expected_ticks);
            expect(made).toEqual(grown);
            for (const series of seriesOf(made)) {
                expect(series).toHaveLength(20);
                // no hole is left in a series
                expect(Object.keys(series)).toHaveLength(20);
            }
        }
    });

    it("hands a run every series at the length of the run, with nothing missing, when it records the whole of its request", async () => {
        const config = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE);
        const run = runBuild(config, { logger: quiet, machine_stock: true, factorio_states: false, simulate_periods: 2 });
        const stock = run.machine_stock!;
        expect(stock.ticks).toBe(run.recorded_duration.ticks);
        for (const series of seriesOf(stock)) {
            expect(series).toHaveLength(stock.ticks);
            expect(Object.keys(series)).toHaveLength(stock.ticks);
        }
    });
});
