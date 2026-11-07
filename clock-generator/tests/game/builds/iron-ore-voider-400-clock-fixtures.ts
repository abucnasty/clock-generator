import fs from "fs";
import os from "os";
import path from "path";
import {expect} from "vitest";
import {Config} from "../../../src/config";
import {ConfigPaths} from "../../../src/config/config-paths";
import {loadConfigFromFile} from "../../../src/config/loader";
import {generateClockAlternatives} from "../../../src/crafting/generate-blueprint";
import {encodeBlueprintFile} from "../../../src/blueprints/serde";
import {recordInFactorio} from "../../../src/harness/factorio-harness";
import {composeProbeSource} from "../helpers/probe-source";
import {clockHash, NativeRunSummary, readControls, runHolds} from "./clock-controls";
import {RUN_PROTOCOL, runSummary} from "./pickup-clock-capture";

/**
 * The ore voider's recycler cell (`recycling/iron-ore`), 400 iron ore a second destroyed, on its selected clock: four
 * inserters bring the ore in, the recycler places what it gives back (a quarter of its crafts, at random) into a car, two
 * inserters bring that back. One run under the game tests' protocol (helpers/lua/steady.lua). The recycler makes nothing that
 * counts, so the run counts what it takes in: the ore the four feed inserters drop into it, against the target x 60 s a minute.
 * The disturbances: the ore supply cut, and the output blocked (the car filled to capacity and its two inserters disabled
 * by script). What comes back is random in the game and at its expected amount in the simulator, so beside the protocol the
 * baseline is judged on the ore destroyed against the binomial's range, the share of crafts that gave ore back, and on the car
 * never being full and the recycler never waiting for room. Dropped with the hour (owner's protocol, 2026-11-03): the mean of
 * the ore brought in per window cycle, which the baseline's whole clock cycles now judge, and the backlog of 2000 ore put into the car.
 */
export interface OreVoiderCase {
    name: string;
    sample: "IRON_ORE_VOIDER_400_EXACT_SPEED" | "IRON_ORE_VOIDER_400_OVERBEACONED";
    /** The alternative recorded, in place of the selected one */
    alternative?: string;
}

export function oreVoiderCases(): OreVoiderCase[] {
    return [
        {name: "ore-voider-exact-speed", sample: "IRON_ORE_VOIDER_400_EXACT_SPEED"},
        {name: "ore-voider-overbeaconed", sample: "IRON_ORE_VOIDER_400_OVERBEACONED"},
    ];
}

/** What the probe writes into its report, beside steady.lua's `protocol` */
interface OreVoiderReport {
    initial: {period: number; capacity: number; car_contents: number};
    /** Counted over the baseline's ticks */
    baseline: {
        ticks: number;
        /** Crafts of the recycler (products_finished), ore it placed into the car, ore the two inserters dropped back into it */
        crafts: number; placed: number; taken: number;
        car_max: number; source_max: number;
        /** Ticks the recycler showed full output or waiting for space */
        full_ticks: number;
        recycler_status: Record<string, number>;
        /** What waited in the recycler's output after a tick while the car had room, by the count, in ticks */
        result_after_tick: Record<string, number>;
        wake: {alarms: number[]; woken: number[]; waiting_ticks: number[]; enabled_ticks: number[]};
    };
    events: {tick: number; action: string; inserted?: number}[];
    /** During the output block: whether the feeds still bring ore in while a stack of the recycler's result waits */
    blocked_input?: {started: number; filled: number; stopped?: number; result_waiting?: number; source_before?: number;
        source_max?: number; fresh_after?: number; watched: number; status?: string; result_waiting_end?: number};
    protocol: Parameters<typeof runSummary>[0];
    error?: string;
}

/** What the baseline shows beyond the protocol's verdict, as the controls keep it */
export interface OreVoiderObserved {
    clock: {id: string; period: number; expected: number; verdict: string; wake_ups_per_minute: number; taker_wake_ups_per_minute: number};
    baseline: {
        ticks: number; periods: number;
        crafts: number; placed: number;
        /** Ore destroyed over the baseline (each craft destroys the ore it takes, less what it gives back), its expectation at the target, and the range of 3 standard deviations of the returns over the window cycles */
        destroyed: number; destroyed_expected: number; destroyed_range: number;
        returned_share: number; returned_range: number;
        car_max: number; car_capacity: number; full_ticks: number;
        recycler_status: Record<string, number>;
        result_after_tick: Record<string, number>;
        taker_wake_ups_per_minute: number;
    };
    blocked_input: OreVoiderReport["blocked_input"];
}

/** A run under the protocol, with the figures this family still judges */
export type OreVoiderRun = NativeRunSummary & {observed: OreVoiderObserved};

const quiet = {log() {}, info() {}, warn() {}, error() {}, debug() {}};

function scaffoldOf(config_path: string): string {
    return fs.readFileSync(config_path.replace(/\.json$/, ".scaffold"), "utf8").trim();
}

/** The capture folder of a case: kept under ORE_VOIDER_CAPTURE_DIR when it is set, else a temporary one removed after */
function captureOf(name: string) {
    const root = process.env.ORE_VOIDER_CAPTURE_DIR;
    const directory = root ? path.resolve(root, name) : fs.mkdtempSync(path.join(os.tmpdir(), "ore-voider-"));
    if (root && fs.existsSync(directory) && fs.readdirSync(directory).length) throw new Error("Use a fresh ORE_VOIDER_CAPTURE_DIR");
    fs.mkdirSync(directory, {recursive: true});
    return {directory, cleanup: () => {if (!root) fs.rmSync(directory, {recursive: true, force: true});}};
}

function sum(values: number[]): number {
    return values.reduce((total, value) => total + value, 0);
}

/** The run's summary under the protocol, with the baseline's figures for the checks a clock for a random output has to meet */
export function summarize(report: OreVoiderReport, config: Config, clock: OreVoiderObserved["clock"], sigma_window_cycle: number, chance: number): OreVoiderRun {
    const run = runSummary(report.protocol, {generationVerdict: clock.verdict, target: config.setpoint.items_per_second, period: clock.period});
    const b = report.baseline;
    const window_cycles = b.ticks / clock.period;
    // each craft destroys the ore it takes, less what it gives back
    const destroyed = b.crafts - b.placed;
    return {
        ...run,
        observed: {
            clock,
            baseline: {
                ticks: b.ticks, periods: window_cycles, crafts: b.crafts, placed: b.placed,
                destroyed, destroyed_expected: config.setpoint.items_per_second * b.ticks / 60, destroyed_range: 3 * sigma_window_cycle * Math.sqrt(window_cycles),
                returned_share: b.crafts > 0 ? b.placed / b.crafts : 0,
                returned_range: b.crafts > 0 ? 3 * Math.sqrt(b.crafts * chance * (1 - chance)) / b.crafts : 0,
                car_max: b.car_max, car_capacity: report.initial.capacity, full_ticks: b.full_ticks,
                recycler_status: b.recycler_status, result_after_tick: b.result_after_tick,
                taker_wake_ups_per_minute: b.ticks > 0 ? sum(b.wake.alarms) * 3600 / b.ticks : 0,
            },
            blocked_input: report.blocked_input,
        },
    };
}

/** The conditions a clock for a random output meets in the game: the protocol (holds the target, recovers from the cut and the block), the car never full, the ore destroyed and returned as the chances give */
export function assertHolds(summary: OreVoiderRun): void {
    const {baseline} = summary.observed;
    expect(runHolds(summary), `the run holds the target and recovers from each disturbance (${summary.result})`).toBe(true);
    expect(baseline.ticks, "the baseline's ticks were counted").toBeGreaterThanOrEqual(RUN_PROTOCOL.baseline);
    expect(Math.abs(baseline.destroyed - baseline.destroyed_expected), "the ore destroyed over the baseline").toBeLessThanOrEqual(baseline.destroyed_range);
    expect(Math.abs(baseline.returned_share - 0.25), "the share of crafts that gave the ore back").toBeLessThanOrEqual(baseline.returned_range);
    expect(baseline.car_max, "the car is never full").toBeLessThan(baseline.car_capacity);
    expect(baseline.full_ticks, "the recycler never waits for room in the car").toBe(0);
}

export async function captureOreVoider(variant: OreVoiderCase): Promise<OreVoiderRun> {
    const capture = captureOf(variant.name);
    try {
        const config_path = ConfigPaths[variant.sample];
        const config = await loadConfigFromFile(config_path);
        const generated = generateClockAlternatives(config, {logger: quiet});
        const selected = variant.alternative === undefined ? generated.alternatives[generated.selected_index]
            : generated.alternatives.find(alternative => alternative.maker === variant.alternative);
        if (!selected) throw new Error(`No alternative ${variant.alternative} for ${variant.name}`);
        const exported = selected.result.subtick ?? selected.result;
        const window_cycle_ticks = selected.result.simulation_duration.ticks;
        const margin = selected.result.random_margins!.windows[0];
        const takers = new Set(margin.inserter_ids);
        const per_inserter = selected.result.stability_check.as_built?.wake_ups?.inserters ?? [];
        const clock = {id: selected.id, period: window_cycle_ticks, expected: config.setpoint.items_per_second * window_cycle_ticks / 60, verdict: selected.verdict,
            wake_ups_per_minute: selected.assessment.wake_ups_per_minute ?? 0,
            taker_wake_ups_per_minute: sum(per_inserter.filter(it => takers.has(it.inserter_id)).map(it => it.wake_ups_per_minute))};
        const sha = clockHash(exported);
        const controls = readControls<{cases: Record<string, {recorded: {clock_sha256: string}}>}>("iron-ore-voider-400-clock-controls.json");
        const recorded = controls.cases[variant.name]?.recorded.clock_sha256;
        if (recorded && process.env.ORE_VOIDER_CALIBRATE !== "1") {
            expect(sha, `the clock ${variant.name} runs is not the one its summary in iron-ore-voider-400-clock-controls.json was recorded on: record it again`).toBe(recorded);
        }
        fs.writeFileSync(path.join(capture.directory, "clock.json"), JSON.stringify({...clock, sha256: sha}) + "\n");
        // the baseline is the protocol's minute: the clock's cycle is its window cycle, which a minute holds whole
        expect(RUN_PROTOCOL.baseline % window_cycle_ticks, "a whole number of the clock's periods in the baseline").toBe(0);
        const expectedPerWindow = Math.round(config.setpoint.items_per_second * RUN_PROTOCOL.window / 60 * 1e6) / 1e6;
        const {recording} = await recordInFactorio({factorio: process.env.FACTORIO_PATH!, save: process.env.FACTORIO_HARNESS_SAVE!, config,
            clock: {blueprint: encodeBlueprintFile({blueprint: exported.blueprint}), schedule: exported.schedule}, blueprint: scaffoldOf(config_path),
            out: path.join(capture.directory, "recording.json"), work_dir: path.join(capture.directory, "game"),
            ticks: 3600, record_at_once: true, warmup_ticks: 600, settle_ticks: RUN_PROTOCOL.cap + 1, seed: [], unclocked: false,
            lua: composeProbeSource(path.join(__dirname, "iron-ore-voider-400-clock-probe.lua"),
                {period: window_cycle_ticks, window: RUN_PROTOCOL.window, expected: expectedPerWindow, baseline: RUN_PROTOCOL.baseline, cap: RUN_PROTOCOL.cap}),
            game_speed: 1000, watch: false, timeout_seconds: 900, log() {}});
        // the build as Sidecar exports it: the recycler puts its results into the car
        const exported_config = recording.config as {machines?: {result_target?: unknown}[]; chests?: {type: string; id: number}[]};
        const car = exported_config.chests?.find(chest => chest.type === "car");
        expect(exported_config.machines?.[0]?.result_target, "Sidecar exports the car as the recycler's result target").toEqual({type: "chest", id: car?.id});
        const report = JSON.parse(fs.readFileSync(path.join(capture.directory, "game/script-output/ore-voider.json"), "utf8")) as OreVoiderReport;
        expect(report.error ?? report.protocol.error, "the probe ran to its end").toBeUndefined();
        expect(report.protocol.result, "the run did not end before the recording: over the cap").toBeDefined();
        const summary = summarize(report, config, clock, margin.sigma_items, margin.expected_items / margin.crafts);
        fs.writeFileSync(path.join(capture.directory, "summary.json"), JSON.stringify(summary, null, 1) + "\n");
        fs.writeFileSync(path.join(capture.directory, "report.json"), JSON.stringify(report) + "\n");
        return summary;
    } finally {capture.cleanup();}
}
