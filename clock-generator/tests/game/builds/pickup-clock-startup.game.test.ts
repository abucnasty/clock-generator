import fs from "fs";
import path from "path";
import {expect, test} from "vitest";
import {clockFromWindows} from "../../../src/crafting/trial";
import {rotateRanges, SerializableClockWindows} from "../../../src/crafting/clock";
import {OpenRange} from "../../../src/data-types";
import {encodeBlueprintFile} from "../../../src/blueprints/serde";
import {recordInFactorio} from "../../../src/harness/factorio-harness";
import {composeProbeSource} from "../helpers/probe-source";
import {speedCapture} from "../helpers/belt-speed-fixtures";
import {pickupClockConfig, pickupClockScaffold, pickupClockSpeedCases} from "./pickup-clock-speed-coverage";
import {assertPickupClockHardware} from "./pickup-clock-speed-hardware";
import {readControls} from "./clock-controls";

interface Stack {at: number; count: number; item: string}
interface Lane {length: number; stacks: Stack[] | Record<string, Stack>}
interface Control {
    period: number;
    expected: number;
    terminal_swings: number;
    saturation_ticks: number;
    clock_windows: SerializableClockWindows;
    phases: {offset: number; items_per_period: number[]; initial_stacks: {position: number; count: number; item: string}[][]}[];
}
const controls = readControls<{backed_up_start: {cases: Record<string, Control>}}>("pickup-clock-start-controls.json").backed_up_start.cases;
const quiet = {log() {}, info() {}, warn() {}, error() {}, debug() {}};
const stockOf = (lanes: Lane[]) => lanes.map(lane => Object.values(lane.stacks).map(stack =>
    ({position: Math.round(stack.at * 256), count: stack.count, item: stack.item})));

for (const [name, control] of Object.entries(controls)) for (const phase of control.phases) {
    test(`fully backed-up cold start: ${name}, offset ${phase.offset}`, async context => {
        const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
        context.skip(!factorio || !save || !fs.existsSync(save), "Factorio harness is not configured");
        const capture = speedCapture(`startup-${name}-${phase.offset}`);
        try {
            const variant = pickupClockSpeedCases("electromagnetic").find(variant => variant.name === name)!;
            const config = await pickupClockConfig(variant);
            config.overrides = {...config.overrides, terminal_swing_count: control.terminal_swings};
            const windows = Object.fromEntries(Object.entries(control.clock_windows).map(([id, ranges]) =>
                [id, rotateRanges(ranges.map(range => OpenRange.from(range.start, range.end)), phase.offset, control.period)
                    .map(range => ({start: range.start_inclusive, end: range.end_inclusive}))]));
            const generated = clockFromWindows(config, windows, control.period, quiet);
            const blueprint = pickupClockScaffold(variant);
            const ticks = phase.items_per_period.length * control.period;
            const result = await recordInFactorio({factorio: factorio!, save: save!, config, blueprint,
                clock: {blueprint: encodeBlueprintFile({blueprint: generated.blueprint}), schedule: generated.schedule},
                out: path.join(capture.directory, "recording.json"), work_dir: path.join(capture.directory, "game"),
                ticks, warmup_ticks: 0, staged_start: {saturation_ticks: control.saturation_ticks}, seed: [],
                lua: composeProbeSource(path.join(__dirname, "pickup-clock-startup-probe.lua"), {ticks}),
                unclocked: false, game_speed: 1000, watch: false, timeout_seconds: 900, log() {},
            });
            const recording = result.recording;
            assertPickupClockHardware(recording, config, blueprint);
            expect(recording.start_game_tick).toBe(Number(result.start.tick));
            expect(recording.sample_count).toBe(ticks);
            const input = recording.inserters.find(inserter => inserter.source.type === "belt" && inserter.sink.type === "machine")!;
            expect(input.source.pickup_layout).toBe(variant.geometry === "underground-entrance" ? "side-entrance" : "side-exit");
            expect(recording.inserters.filter(inserter => inserter.source.type === "machine" || inserter.sink.type === "machine")
                .every(inserter => inserter.samples.held_count[0] === 0)).toBe(true);
            for (const machine of recording.machines) {
                expect(machine.samples.products_finished[0]).toBe(0);
                expect(Object.values(machine.samples.inputs).every(series => series[0] === 0)).toBe(true);
                expect(Object.values(machine.samples.outputs).every(series => series[0] === 0)).toBe(true);
            }
            const report = JSON.parse(fs.readFileSync(path.join(capture.directory, "game/script-output/clock-startup.json"), "utf8")) as
                {initial_lanes: Lane[]; samples: {tick: number; clock: number; lanes?: Lane[]}[]};
            expect(stockOf(report.initial_lanes)).toEqual(phase.initial_stacks);
            const firstGrab = recording.start_game_tick + input.samples.held_count.findIndex(count => count > 0);
            const before = report.samples.filter(sample => sample.tick < firstGrab);
            expect(before.length).toBeGreaterThan(0);
            for (const sample of before) {
                expect(sample.lanes).toBeDefined();
                expect(stockOf(sample.lanes!)).toEqual(phase.initial_stacks);
            }
            const output = recording.inserters.find(inserter => inserter.source.type === "machine")!;
            const items = new Array<number>(phase.items_per_period.length).fill(0);
            output.samples.held_count.forEach((held, tick, counts) => {
                items[Math.floor(tick / control.period)] += Math.max(0, (counts[tick - 1] ?? 0) - held);
            });
            fs.writeFileSync(path.join(capture.directory, "summary.json"), JSON.stringify({period: control.period,
                offset: phase.offset, items_per_period: items}) + "\n");
            expect(items).toEqual(phase.items_per_period);
        } finally {capture.cleanup();}
    }, 960_000);
}
