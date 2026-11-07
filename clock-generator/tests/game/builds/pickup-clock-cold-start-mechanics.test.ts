import {createHash} from "crypto";
import {describe, expect, test} from "vitest";
import {clockFromWindows, runClockOnBuild} from "../../../src/crafting/trial";
import {OpenRange} from "../../../src/data-types";
import {clockHash, readControls} from "./clock-controls";
import {reversedDeciders} from "./reversed-deciders";
import {coldStart as controls, configOf, perWindowCycle, physicalColdClockOf} from "./pickup-clock-cold-start-runs";

/**
 * The clocked cold starts (`pickup-clock-start-controls.json`, `cold_start`: the turbo runs, each recorded from placement until
 * the plant has made its target over a minute and a minute more), checked without generating a clock. The clock of a run is stored as its windows, so the simulator
 * runs it from the cold start and is held to the game's counts, and the windows build the clock whose hash the run was
 * recorded on. That the generator's selection still makes that clock is checked on the runs
 * started at the window cycle's beginning against the record (clock-controls.test.ts).
 */

const quiet = {log() {}, info() {}, warn() {}, error() {}, debug() {}};
const sha = (series: number[]) => createHash("sha256").update(JSON.stringify(series)).digest("hex");
const names = Object.keys(controls.runs);
const recordedCases = [
    ...names.map(name => ({name, run: controls.runs[name]})),
    ...Object.entries(controls.historical_runs ?? {}).map(([name, run]) => ({name: `historical ${name}`, run})),
];

/**
 * Runs the simulator does not follow tick for tick, with the reason; their output is held all the same. The one: a hand
 * that comes back from its swing in the tick the output inserter takes the machine's products off its output block
 * waits a tick in the game and not in the simulator (once in 16 window cycles, 5 input ticks; ROADMAP section 7).
 */
const KNOWN_INPUT_DIFFERENCES: Record<string, string> = {
    "turbo-underground-entrance-backed-l1-rot1021": "the hand back from its swing as the output block is lifted, held 1143",
};

// Clocked cold starts of the side pickup fixtures (4 tiers × 2 near sides × 3 topologies × 2 supplies, on the
// generator's selected clock) and of two over-hood clocks, recorded in Factorio 2.1.21 from the harness's staged start
// with the game's own lane phase at placement (tests/game/builds/README.md, "Clocked cold starts"); some started
// inside an input window, with the deciders built in reverse, the inserters built in reverse or the build moved. From
// the clock's start the simulator has to hold what the game's input and output inserters held in every tick: no arrival
// or phase but the lane phase at placement is given to it. Several start where a window the circuit latency carries over
// the end of the window cycle would enable the input in the first two ticks, which no window reaches yet in the game.
describe("clocked cold starts from placement", () => {
    test.each(recordedCases)("$name", async ({name, run}) => {
        const clock = controls.clocks[run.clock];
        const config = await configOf(run.case);
        const windows = new Map(Object.entries(clock.clock_windows).map(([id, ranges]) =>
            [id, ranges.map(range => OpenRange.from(range.start, range.end))]));
        const physical = physicalColdClockOf(clock, run);
        const runConfig = physical ? config : {...config, overrides: {...config.overrides, terminal_swing_count: clock.terminal_swings}};
        const result = runClockOnBuild(runConfig,
            windows, clock.period, quiet, {
                cold_start: true, warmup_window_cycles: 0, simulate_window_cycles: Math.ceil(run.ticks / clock.period), machine_stock: true, factorio_states: false,
                decider_order: run.decider_order,
                ...(run.model_phases && {moving_pickup_phases: new Map([["inserter:2", run.model_phases]])}),
            });
        const inserters = result.machine_stock!.inserters;
        const ticks = run.ticks - controls.frame_offset;
        const output = inserters.find(it => it.inserter_id === "inserter:1")!.held.slice(0, ticks);
        const input = inserters.find(it => it.inserter_id === "inserter:2")!.held.slice(0, ticks);
        expect(perWindowCycle(output, clock.period).drops, "output per period").toEqual(run.output);
        expect(sha(output), "output inserter held, tick for tick").toBe(run.output_held_sha256);
        if (KNOWN_INPUT_DIFFERENCES[name] !== undefined) return;
        expect(perWindowCycle(input, clock.period).pickups, "input pickups per period").toEqual(run.pickups);
        expect(sha(input), "input inserter held, tick for tick").toBe(run.input_held_sha256);
    });
});

describe("the stored windows build the clock each run was recorded on", () => {
    async function builtFromWindows(record: typeof recordedCases[number]) {
        const {run} = record;
        const clock = controls.clocks[run.clock];
        const config = await configOf(run.case);
        if (clock.kind === "physical") throw new Error("Physical controls are checked by their exact encoding, not guessed planning metadata");
        const built = () => clockFromWindows(
            {...config, overrides: {...config.overrides, terminal_swing_count: clock.terminal_swings}}, clock.clock_windows, clock.period, quiet);
        return {run, clock, built};
    }

    test.each(recordedCases.filter(({run}) => controls.clocks[run.clock].kind !== "physical"))("$name", async record => {
        const {run, clock, built} = await builtFromWindows(record);
        let exported: {blueprint: any; schedule: any} = built();
        exported = (exported as any).subtick ?? exported;
        if (run.decider_order === "reversed") exported = reversedDeciders(exported.blueprint, exported.schedule);
        expect(clockHash(exported), "the windows no longer build the clock these runs were recorded on").toBe(clock.clock_sha256);
    });

});

describe("the cold-start controls state themselves", () => {
    const pins = readControls("pickup-clock-controls.json").cases;
    const sideRuns = names.filter(name => !controls.runs[name].case.startsWith("over-hood-"));

    test("the matrix is 12 runs of the turbo side pickup fixtures, and 3 more decide the rule that a clock's first two ticks are dark", () => {
        expect(names).toHaveLength(15);
        expect(sideRuns.filter(name => name === controls.runs[name].case)).toHaveLength(12);
        expect(names.filter(name => controls.runs[name].rotate !== 0 || controls.runs[name].decider_order !== "built"
            || controls.runs[name].case.startsWith("over-hood-") || name !== controls.runs[name].case)).toHaveLength(3);
    });

    test.each(names)("%s: names a clock of the controls, with a lane phase only where the supply moves", name => {
        const run = controls.runs[name];
        expect(controls.clocks[run.clock], "the clock the run was recorded on").toBeDefined();
        // from placement to steady state and a minute more, never over the cap
        expect(run.ticks).toBe(run.steady + 3600);
        expect(run.output).toHaveLength(Math.ceil((run.ticks - controls.frame_offset) / controls.clocks[run.clock].period));
        expect(run.pickups).toHaveLength(run.output.length);
        const moving = run.case.includes("-moving-");
        expect({native: run.native_phases !== null, model: run.model_phases !== null}).toEqual({native: moving, model: moving});
    });

    test("every clock of the controls is the clock of some run, and was recorded as it is pinned", () => {
        const used = new Set(recordedCases.map(({run}) => run.clock));
        for (const [id, clock] of Object.entries(controls.clocks)) {
            expect(used.has(id), `${id} is the clock of no run`).toBe(true);
            expect(clock.recorded_clock_sha256, id).toBe(clock.clock_sha256);
        }
    });

    // A run started at the window cycle's beginning (rotate 0) on a clock built in the game's order is on the selection of its
    // config, which pickup-clock-controls.json pins for the near lane 1 fixture and the generation test checks.
    const onTheSelection = sideRuns.filter(name => controls.runs[name].rotate === 0 && controls.runs[name].decider_order === "built");
    test.each(onTheSelection)("%s: the clock is the pinned selection of its fixture", name => {
        const run = controls.runs[name];
        const fixture = `electromagnetic-${run.case.replace(/-l[12]$/, "")}`;
        const pin = pins[fixture]?.generation;
        expect(controls.clocks[run.clock].clock_sha256).toBe(pin!.clock_sha256);
    });
});
