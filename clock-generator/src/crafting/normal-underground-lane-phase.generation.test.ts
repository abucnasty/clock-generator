import {createHash} from "crypto";
import {describe, expect, test} from "vitest";
import {runClockOnBuild} from "./trial";
import {SerializableClockWindows} from "./clock";
import {OpenRange} from "../data-types";
import {pickupClockConfig, pickupClockSpeedCases} from "../../tests/game/builds/pickup-clock-speed-coverage";
import {readControls} from "../../tests/game/builds/clock-controls";

interface LanePhaseCell {
    /** Items the output inserter dropped in each clock period */
    output: number[];
    /** Items the input inserter picked up in each clock period */
    pickups: number[];
    /** sha256 of the output inserter's held count in every sample of the model's frame, as JSON */
    output_held_sha256: string;
}
interface LanePhaseControl {
    period: number;
    periods: number;
    terminal_swings: number;
    clock_windows: SerializableClockWindows;
    /** By the model's lane phases of the input belt, "<first lane>,<second lane>", each 0 to 7 */
    cells: Record<string, LanePhaseCell>;
    /** Cells the simulator does not follow tick for tick, with the reason; their settled periods are held all the same */
    known_differences: Record<string, string>;
}

/** The last periods of a cold start, by which every cell has settled into its long run, a cycle included */
const SETTLED_PERIODS = 8;

const controls = readControls<{normal_underground: {builds: Record<string, LanePhaseControl>}}>("lane-phase-controls.json").normal_underground;
const quiet = {log() {}, info() {}, warn() {}, error() {}, debug() {}};

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

// Every cold start of the normal moving underground pickups at each of the 64 lane-phase pairs, recorded in
// Factorio 2.1.21 under fixed windows (tests/game/builds/README.md, "Normal underground lane phases"). The
// simulator has to move what the game moved from each start, period by period, and its output inserter has to
// hold what the game's held in every tick. Five starts never settle in the game, among them a cycle of 143 a period
// against 176 at the exit's natural phase [3,3], which is why the generator does not say this clock holds.
for (const [name, control] of Object.entries(controls.builds)) describe(`cold lane-phase starts: ${name}`, () => {
    test.each(Object.keys(control.cells))(`lane phases [%s]`, async cell => {
        const variant = pickupClockSpeedCases("electromagnetic").find(it => it.name === name)!;
        const config = await pickupClockConfig(variant);
        config.overrides = {...config.overrides, terminal_swing_count: control.terminal_swings};
        const windows = new Map(Object.entries(control.clock_windows).map(([id, ranges]) =>
            [id, ranges.map(range => OpenRange.from(range.start, range.end))]));
        const phases = cell.split(",").map(Number) as [number, number];
        const run = runClockOnBuild(config, windows, control.period, quiet, {
            cold_start: true, warmup_periods: 0, simulate_periods: control.periods, machine_stock: true, factorio_states: false,
            moving_pickup_phases: new Map([["inserter:2", phases]]),
        });
        const inserters = run.machine_stock!.inserters;
        const output = inserters.find(it => it.inserter_id === "inserter:1")!.held;
        const input = inserters.find(it => it.inserter_id === "inserter:2")!.held;
        const expected = control.cells[cell];
        if (control.known_differences[cell] !== undefined) {
            expect(perPeriod(output, control.period, control.periods).drops.slice(-SETTLED_PERIODS), control.known_differences[cell])
                .toEqual(expected.output.slice(-SETTLED_PERIODS));
            return;
        }
        expect(perPeriod(output, control.period, control.periods).drops, "output per period").toEqual(expected.output);
        expect(perPeriod(input, control.period, control.periods).pickups, "input pickups per period").toEqual(expected.pickups);
        const ticks = control.period * control.periods;
        expect(createHash("sha256").update(JSON.stringify(output.slice(0, ticks - 4))).digest("hex"), "output inserter held, tick for tick")
            .toBe(expected.output_held_sha256);
    });
});
