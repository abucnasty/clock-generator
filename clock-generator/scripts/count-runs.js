// node scripts/count-runs.js <KEY> [on|off]
// How many runs of the build it takes to generate every potential clock of a sample, and how many ticks they simulate:
// the planning runs and every trial of a clock (clock-only checks from each start phase, long runs, loss trials, fuel
// views). One line: runs, ticks simulated, seconds. For comparing a change of the searches against the build before
// it: generation must not get slower. [on|off] is "Belts do not move"; SEARCH=1 turns "Search for fewer wake-ups" on.
// CLOCK_GENERATOR_ROOT names the build to count.
const [key, belts = "off"] = process.argv.slice(2);
const { dist, quiet, loadSample } = require("./lib");
const { generateClockAlternatives } = dist("crafting/generate-blueprint.js");
const { PrepareStep } = dist("crafting/runner/steps/prepare-step.js");
const { WarmupStep } = dist("crafting/runner/steps/warmup-step.js");
const { SimulateStep } = dist("crafting/runner/steps/simulate-step.js");

let runs = 0;
let ticks = 0;
// every run of the build prepares it once; the warm-up and simulate steps are the ticks it then runs
const prepare = PrepareStep.prototype.execute;
PrepareStep.prototype.execute = function () { runs++; return prepare.call(this); };
for (const Step of [WarmupStep, SimulateStep]) {
    const execute = Step.prototype.execute;
    Step.prototype.execute = function () {
        const before = this.simulation_context.tick_provider.getCurrentTick();
        const result = execute.call(this);
        ticks += this.simulation_context.tick_provider.getCurrentTick() - before;
        return result;
    };
}

(async () => {
    const started = Date.now();
    const config = await loadSample(key, belts === "on");
    let error = "";
    try {
        generateClockAlternatives(config, { logger: quiet });
    } catch (e) {
        error = ` error: ${String(e && e.message || e).slice(0, 120)}`;
    }
    console.log(`${key} runs ${runs} ticks ${ticks} seconds ${Math.round((Date.now() - started) / 1000)}${error}`);
})();
