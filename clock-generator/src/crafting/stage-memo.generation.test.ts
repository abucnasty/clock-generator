import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { ConfigPaths } from "../config/config-paths";
import { loadConfigFromFile } from "../config/loader";
import { generateQuietClockAlternatives } from "./alternatives";
import { canonicalKey, RunMemo } from "./plan/run-memo";
import { observeFills } from "./runner/steps/backpressure-fill-step";
import { SimulationTick } from "./runner/simulation-tick";

// A derived clock with a window cycle time of 216 ticks: the quick and strict checks both ask from offset 18.
// The key holds the sample's text, so it moves when the sample does (the automation example states the direction of its output inserter).
const shared_start_key = "7b46b970ae42f5185d783dc94aeb7e7ca53dbf2dc92d1ce7cca00f94963a58b2";

it("reuses the measured start when a strict confirmation sees the quick trial's offset", async () => {
    const configuration = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE_240);
    const run = RunMemo.prototype.run;
    const executeForTick = SimulationTick.prototype.executeForTick;
    const generate = () => {
        const shared: { requested: number; executed: number }[] = [];
        let executed = 0;
        SimulationTick.prototype.executeForTick = function () {
            executed++;
            return executeForTick.call(this);
        };
        RunMemo.prototype.run = function (configuration, options, simulate) {
            const { logger, debug, debug_steps, fractional_swings, ...read } = options;
            if (read.window_cycle_ticks !== 216 || read.factorio_states !== false) return run.call(this, configuration, options, simulate);
            const key = canonicalKey([configuration, read, fractional_swings === true]);
            if (key === null || createHash("sha256").update(key).digest("hex") !== shared_start_key) {
                return run.call(this, configuration, options, simulate);
            }
            return run.call(this, configuration, options, () => {
                const before = executed;
                const measured = simulate();
                shared.push({ requested: measured.ticks_simulated, executed: executed - before });
                return measured;
            });
        };
        try {
            const result = generateQuietClockAlternatives(configuration);
            return { result, shared, executed };
        } finally {
            RunMemo.prototype.run = run;
            SimulationTick.prototype.executeForTick = executeForTick;
        }
    };

    let fills = 0;
    const stopObserving = observeFills(() => { fills++; });
    let observed: ReturnType<typeof generate>;
    try {
        observed = generate();
    } finally {
        stopObserving();
    }
    const unobserved = generate();
    const sharedRun = { requested: 2376, executed: 2332 };
    expect(fills).toBeGreaterThan(0);
    expect(unobserved.result).toEqual(observed.result);
    expect(observed.shared).toEqual([sharedRun, sharedRun]);
    expect(unobserved.shared).toEqual([sharedRun]);
    expect(unobserved.executed).toBeLessThan(observed.executed);
});
