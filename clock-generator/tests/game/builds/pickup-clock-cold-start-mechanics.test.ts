import {createHash} from "crypto";
import {describe, expect, test} from "vitest";
import {clockFromWindows, runClockOnBuild} from "../../../src/crafting/trial";
import {OpenRange} from "../../../src/data-types";
import {clockHash, readControls} from "./clock-controls";
import {reversedDeciders} from "./reversed-deciders";
import {coldStart as controls, configOf} from "./pickup-clock-cold-start-runs";

/**
 * The clocked cold starts (`pickup-clock-start-controls.json`, `cold_start`: 57 runs recorded in Factorio 2.1.21, README
 * "Clocked cold starts"), checked without generating a clock. The clock of a run is stored as its windows, so the simulator
 * runs it from the cold start and is held to the game's counts, and the windows build the clock whose hash the run was
 * recorded on. That the generator's selection still makes that clock is checked on a few runs by
 * pickup-clock-cold-start.generation.test.ts (pickup-clock-cold-start-cases.ts).
 */

const quiet = {log() {}, info() {}, warn() {}, error() {}, debug() {}};
const sha = (series: number[]) => createHash("sha256").update(JSON.stringify(series)).digest("hex");
const names = Object.keys(controls.runs);

/**
 * Runs the simulator does not follow tick for tick, with the reason; their output is held all the same. The one: a hand
 * that comes back from its swing in the tick the output inserter takes the machine's products off its output block
 * waits a tick in the game and not in the simulator (once in 16 periods, 5 input ticks; ROADMAP section 7).
 */
const KNOWN_INPUT_DIFFERENCES: Record<string, string> = {
    "turbo-underground-entrance-backed-l1-rot1021": "the hand back from its swing as the output block is lifted, held 1143",
};

/** What the inserter moved in each period: drops (held count falling) and pickups (rising), from an empty hand */
function perPeriod(held: number[], period: number, periods: number) {
    const drops = new Array<number>(periods).fill(0);
    const pickups = new Array<number>(periods).fill(0);
    held.forEach((count, tick) => {
        const before = held[tick - 1] ?? 0;
        drops[Math.floor(tick / period)] += Math.max(0, before - count);
        pickups[Math.floor(tick / period)] += Math.max(0, count - before);
    });
    return {drops, pickups};
}

// Clocked cold starts of the side pickup fixtures (4 tiers × 2 near sides × 3 topologies × 2 supplies, on the
// generator's selected clock) and of two over-hood clocks, recorded in Factorio 2.1.21 from the harness's staged start
// with the game's own lane phase at placement (tests/game/builds/README.md, "Clocked cold starts"); some started
// inside an input window, with the deciders built in reverse, the inserters built in reverse or the build moved. From
// the clock's start the simulator has to hold what the game's input and output inserters held in every tick: no arrival
// or phase but the lane phase at placement is given to it. Several start where a window the circuit latency carries over
// the end of the period would enable the input in the first two ticks, which no window reaches yet in the game.
describe("clocked cold starts from placement", () => {
    test.each(names)("%s", async name => {
        const run = controls.runs[name];
        const clock = controls.clocks[run.clock];
        const config = await configOf(run.case);
        const windows = new Map(Object.entries(clock.clock_windows).map(([id, ranges]) =>
            [id, ranges.map(range => OpenRange.from(range.start, range.end))]));
        const result = runClockOnBuild({...config, overrides: {...config.overrides, terminal_swing_count: clock.terminal_swings}},
            windows, clock.period, quiet, {
                cold_start: true, warmup_periods: 0, simulate_periods: controls.periods, machine_stock: true, factorio_states: false,
                decider_order: run.decider_order,
                ...(run.model_phases && {moving_pickup_phases: new Map([["inserter:2", run.model_phases]])}),
            });
        const inserters = result.machine_stock!.inserters;
        const ticks = controls.periods * clock.period - controls.frame_offset;
        const output = inserters.find(it => it.inserter_id === "inserter:1")!.held.slice(0, ticks);
        const input = inserters.find(it => it.inserter_id === "inserter:2")!.held.slice(0, ticks);
        expect(perPeriod(output, clock.period, controls.periods).drops, "output per period").toEqual(run.output);
        expect(sha(output), "output inserter held, tick for tick").toBe(run.output_held_sha256);
        if (KNOWN_INPUT_DIFFERENCES[name] !== undefined) return;
        expect(perPeriod(input, clock.period, controls.periods).pickups, "input pickups per period").toEqual(run.pickups);
        expect(sha(input), "input inserter held, tick for tick").toBe(run.input_held_sha256);
    });
});

/**
 * The clock of the fast tier's moving underground entrance and exit runs (4 runs) is a fractional swing count (704 ticks
 * on a config planned on 2112): `clockFromWindows` builds a clock of the config's own period only, so these windows cannot
 * be built back into a clock. The generator's selection for the fast tier's moving underground is checked against the
 * clock's hash by pickup-clock-cold-start.generation.test.ts (the exit, near lane 1; the same clock as all four).
 */
const FRACTIONAL_CLOCK = "1c25f7fb528f";

describe("the stored windows build the clock each run was recorded on", () => {
    async function builtFromWindows(name: string) {
        const run = controls.runs[name];
        const clock = controls.clocks[run.clock];
        const config = await configOf(run.case);
        const built = () => clockFromWindows(
            {...config, overrides: {...config.overrides, terminal_swing_count: clock.terminal_swings}}, clock.clock_windows, clock.period, quiet);
        return {run, clock, built};
    }

    test.each(names.filter(name => controls.runs[name].clock !== FRACTIONAL_CLOCK))("%s", async name => {
        const {run, clock, built} = await builtFromWindows(name);
        let exported: {blueprint: any; schedule: any} = built();
        exported = (exported as any).subtick ?? exported;
        if (run.decider_order === "reversed") exported = reversedDeciders(exported.blueprint, exported.schedule);
        expect(clockHash(exported), "the windows no longer build the clock these runs were recorded on").toBe(clock.clock_sha256);
    });

    test.each(names.filter(name => controls.runs[name].clock === FRACTIONAL_CLOCK))("%s: a fractional clock the windows cannot rebuild", async name => {
        const {clock, built} = await builtFromWindows(name);
        expect(clock.period).toBe(704);
        expect(built).toThrow("The windows are of a clock of 704 ticks, and the config is planned on one of 2112");
    });
});

describe("the cold-start controls state themselves", () => {
    const pins = readControls("pickup-clock-controls.json").cases;
    const sideRuns = names.filter(name => !controls.runs[name].case.startsWith("over-hood-"));

    test("the matrix is 48 runs of the side pickup fixtures, and 9 more decide the rule that a clock's first two ticks are dark", () => {
        expect(names).toHaveLength(57);
        expect(sideRuns.filter(name => name === controls.runs[name].case)).toHaveLength(48);
        expect(names.filter(name => controls.runs[name].rotate !== 0 || controls.runs[name].decider_order !== "built"
            || controls.runs[name].case.startsWith("over-hood-") || name !== controls.runs[name].case)).toHaveLength(9);
    });

    test.each(names)("%s: names a clock of the controls, with a lane phase only where the supply moves", name => {
        const run = controls.runs[name];
        expect(controls.clocks[run.clock], "the clock the run was recorded on").toBeDefined();
        expect(run.output).toHaveLength(controls.periods);
        expect(run.pickups).toHaveLength(controls.periods);
        const moving = run.case.includes("-moving-");
        expect({native: run.native_phases !== null, model: run.model_phases !== null}).toEqual({native: moving, model: moving});
    });

    test("every clock of the controls is the clock of some run, and was recorded as it is pinned", () => {
        const used = new Set(names.map(name => controls.runs[name].clock));
        for (const [id, clock] of Object.entries(controls.clocks)) {
            expect(used.has(id), `${id} is the clock of no run`).toBe(true);
            expect(clock.recorded_clock_sha256, id).toBe(clock.clock_sha256);
        }
    });

    // A run started at the period's beginning (rotate 0) on a clock built in the game's order is on the selection of its
    // config, which pickup-clock-controls.json pins for the near lane 1 fixture and the generation test checks.
    const onTheSelection = sideRuns.filter(name => controls.runs[name].rotate === 0 && controls.runs[name].decider_order === "built");
    test.each(onTheSelection)("%s: the clock is the pinned selection of its fixture", name => {
        const run = controls.runs[name];
        const fixture = `electromagnetic-${run.case.replace(/-l[12]$/, "")}`;
        const pin = pins[fixture]?.generation;
        expect(controls.clocks[run.clock].clock_sha256).toBe(pin!.clock_sha256);
    });
});
