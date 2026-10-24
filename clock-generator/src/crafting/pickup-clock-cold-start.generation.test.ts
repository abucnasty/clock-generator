import {createHash} from "crypto";
import fs from "node:fs";
import path from "node:path";
import {describe, expect, test} from "vitest";
import {clockFromWindows, runClockOnBuild} from "./trial";
import {generateClockAlternatives} from "./generate-blueprint";
import {SerializableClockWindows} from "./clock";
import {OpenRange} from "../data-types";
import {Config} from "../config";
import {pickupClockConfig, pickupClockSpeedCases} from "../../tests/game/builds/pickup-clock-speed-coverage";
import {overHoodClockCases, overHoodClockConfig} from "../../tests/game/builds/over-hood-clock-fixtures";
import {clockHash, readControls} from "../../tests/game/builds/clock-controls";
import {reversedDeciders} from "../../tests/game/builds/reversed-deciders";
import {beltPickupVariantOf} from "../../tests/game/builds/pickup-clock-cold-start-runs";

interface ColdStartClock {
    period: number;
    terminal_swings: number;
    clock_windows: SerializableClockWindows;
    /** sha256 of the exported clock's identity (`clockIdentity`: no text or metadata), as the blast and the other pins hash it */
    clock_sha256: string;
    /** The same hash of the clock the runs were recorded on (the game test refuses another); a unit test requires the two equal */
    recorded_clock_sha256: string;
}
interface ColdStartRun {
    /** The fixture: `<tier>-<geometry>-<supply>-l<near lane>` for a side pickup, an over-hood clock case's name */
    case: string;
    /** Key of `clocks` */
    clock: string;
    /** Ticks the clock was started into its period (`rotateRanges`): its windows above are already rotated */
    rotate: number;
    /** The order the clock's deciders were built in the game */
    decider_order: "built" | "reversed";
    /** The game's lane phases at the clock's start, read off the pickup tile (moving supply only) */
    native_phases: [number, number] | null;
    /** The same in the model's frame: native - frame_offset × the tier's speed in 1/32 tile a tick, mod 8 */
    model_phases: [number, number] | null;
    /** What the game's output and input inserters moved in each period, in the model's frame */
    output: number[];
    pickups: number[];
    /** sha256 of the game's held count of each in every tick of the model's frame, as JSON */
    output_held_sha256: string;
    input_held_sha256: string;
}
interface ColdStartControls {
    /** Model `held[i]` is native sample i + frame_offset */
    frame_offset: number;
    periods: number;
    clocks: Record<string, ColdStartClock>;
    runs: Record<string, ColdStartRun>;
}

const controls = readControls<{cold_start: ColdStartControls}>("pickup-clock-start-controls.json").cold_start;
const quiet = {log() {}, info() {}, warn() {}, error() {}, debug() {}};
const sha = (series: number[]) => createHash("sha256").update(JSON.stringify(series)).digest("hex");

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

/** The config of a run's fixture; near lane 2 is the reflected side cell, whose near lane keeps its item */
async function configOf(name: string): Promise<Config> {
    const overHood = overHoodClockCases("different-items").find(it => it.name === name);
    if (overHood) return overHoodClockConfig(overHood);
    const [, tier, geometry, supply, near] = /^(\w+)-(.+)-(moving|backed)-l([12])$/.exec(name)!;
    const variant = pickupClockSpeedCases("electromagnetic")
        .find(it => it.speed.name === tier && it.geometry === geometry && it.backed === (supply === "backed"))!;
    const config = await pickupClockConfig(variant);
    if (near === "2") {
        const input = config.inserters.find(inserter => inserter.source.type === "belt")!;
        if (input.source.type !== "belt") throw new Error("Expected a belt-fed input");
        input.source.near_lane = 2;
        config.belts.find(belt => belt.id === input.source.id)!.lanes.reverse();
    }
    return config;
}

// Clocked cold starts of the side pickup fixtures (4 tiers × 2 near sides × 3 topologies × 2 supplies, on the
// generator's selected clock) and of two over-hood clocks, recorded in Factorio 2.1.21 from the harness's staged start
// with the game's own lane phase at placement (tests/game/builds/README.md, "Clocked cold starts"); some started
// inside an input window, with the deciders built in reverse, the inserters built in reverse or the build moved. From
// the clock's start the simulator has to hold what the game's input and output inserters held in every tick: no arrival
// or phase but the lane phase at placement is given to it. Several start where a window the circuit latency carries over
// the end of the period would enable the input in the first two ticks, which no window reaches yet in the game.
describe("clocked cold starts from placement", () => {
    test.each(Object.keys(controls.runs))("%s", async name => {
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

// The clock each run was recorded on is the one it names: the generator's selection for a run started at the period's
// beginning (`rotate` 0), the pinned windows built into a clock for the others, with the deciders in the mirror order where
// the run was. The game test checks this hash against the clock it builds; nothing else did, so a selection that moved
// left these runs pinned to the old one (#275).
// The runs of a side pickup fixture on near lane 1 name the selection of a config that belt-pickup-clock.generation.test.ts
// generates too; they are checked there, on that generation (expectColdStartRunsOnSelection).
describe("cold start runs name the clock they were recorded on", () => {
    const selected = new Map<string, Promise<{blueprint: any; schedule: any}>>();
    test("the runs on the selection of a side pickup fixture are checked on the generation of belt-pickup-clock.generation.test.ts", () => {
        const variants = pickupClockSpeedCases("electromagnetic").map(it => it.name);
        let shared = 0;
        for (const [name, run] of Object.entries(controls.runs)) {
            const variant = beltPickupVariantOf(run);
            if (variant === undefined) continue;
            shared++;
            expect(variants, `${name} names ${variant}, which belt-pickup-clock.generation.test.ts does not generate`).toContain(variant);
        }
        expect(shared).toBeGreaterThan(0);
        expect(fs.readFileSync(path.join(__dirname, "belt-pickup-clock.generation.test.ts"), "utf8"),
            "belt-pickup-clock.generation.test.ts no longer checks these runs").toContain("expectColdStartRunsOnSelection(variant.name,");
    });
    test.each(Object.keys(controls.runs).filter(name => beltPickupVariantOf(controls.runs[name]) === undefined))("%s", async name => {
        const run = controls.runs[name];
        const clock = controls.clocks[run.clock];
        const config = await configOf(run.case);
        let exported: {blueprint: any; schedule: any};
        if (run.rotate === 0) {
            if (!selected.has(run.case)) selected.set(run.case, Promise.resolve().then(() => {
                const generated = generateClockAlternatives(config, {logger: quiet});
                const chosen = generated.alternatives[generated.selected_index].result;
                return chosen.subtick ?? chosen;
            }));
            exported = await selected.get(run.case)!;
        } else {
            exported = clockFromWindows({...config, overrides: {...config.overrides, terminal_swing_count: clock.terminal_swings}},
                clock.clock_windows, clock.period, quiet);
        }
        if (run.decider_order === "reversed") exported = reversedDeciders(exported.blueprint, exported.schedule);
        expect(clockHash(exported), "the selection (or the pinned windows) no longer make the clock these runs were recorded on").toBe(clock.clock_sha256);
    });
});
