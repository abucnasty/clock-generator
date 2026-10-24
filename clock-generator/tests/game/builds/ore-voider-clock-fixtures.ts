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
import {clockHash, readControls} from "./clock-controls";

/**
 * The ore voider's recycler cell (`real/owner/ore-voider`), 400 iron ore a second destroyed, on its selected clock: four
 * inserters bring the ore in, the recycler places what it gives back (a quarter of its crafts, at random) into a car, two
 * inserters bring that back. What comes back is random in the game and at its expected amount in the simulator, so a
 * period is not the same twice: the run is judged on its mean over an hour against the binomial's range, on the car never
 * being full, and on getting back to the target after a loss and after a backlog in the car.
 */
export interface OreVoiderCase {
    name: string;
    sample: "REAL_OWNER_ORE_VOIDER_EXACT_SPEED" | "REAL_OWNER_ORE_VOIDER_OVERBEACONED";
    /** The alternative recorded, in place of the selected one */
    alternative?: string;
}

export function oreVoiderCases(): OreVoiderCase[] {
    return [
        {name: "ore-voider-exact-speed", sample: "REAL_OWNER_ORE_VOIDER_EXACT_SPEED"},
        {name: "ore-voider-overbeaconed", sample: "REAL_OWNER_ORE_VOIDER_OVERBEACONED"},
    ];
}

/** The phases of a run, in clock periods of 144 ticks (2.4 s) */
export const ORE_VOIDER_PHASES = {
    settle_periods: 20,
    /** An hour: 1,500 periods of 2.4 s */
    baseline_periods: 1500,
    /** The ore supply stopped and emptied for 48 s */
    cut_periods: 20,
    after_cut_periods: 60,
    /** Ore put into the car at once, and the periods it is followed for */
    backlog: 2000,
    backlog_periods: 400,
    /** Ticks the last check watches the recycler's input for, with a stack of its result waiting */
    probe_ticks: 600,
    /** Periods of the baseline traced tick by tick */
    trace_periods: 3,
} as const;

export interface OreVoiderPeriod {
    start: number; end: number;
    /** Ore the four inserters dropped into the recycler */
    fresh: number;
    crafts: number;
    /** Ore the recycler placed into the car */
    placed: number;
    /** Ore the two inserters dropped back into the recycler */
    taken: number;
    car: number; car_min: number; car_max: number;
    source_max: number;
    /** Ticks the recycler showed full output or waiting for space */
    full_ticks: number;
}

interface OreVoiderReport {
    starts: number;
    period: number;
    phases: {baseline: number; cut: number; release: number; backlog: number; probe: number};
    backlog: number;
    capacity: number;
    periods: OreVoiderPeriod[];
    events: {tick: number; action: string; inserted?: number}[];
    wake: {alarms: number[]; woken: number[]; waiting_ticks: number[]; enabled_ticks: number[]};
    result_after_tick: Record<string, number>;
    recycler_status: Record<string, number>;
    blocked_input?: {stopped?: number; result_waiting: number; source_before?: number; source_max?: number; fresh_after?: number; status?: string};
    error?: string;
}

/** What a run shows, as the controls keep it */
export interface OreVoiderSummary {
    generationVerdict: string;
    /** Ore destroyed a second, the target */
    target: number;
    period: number;
    /** Ore brought in a period at the target */
    expected: number;
    clock: {id: string; period: number; expected: number; verdict: string; wake_ups_per_minute: number; taker_wake_ups_per_minute: number};
    baseline: {
        periods: number;
        /** Ore brought in a period on average, and the binomial's range of the mean: 3 standard deviations of a period's returns over √periods */
        fresh_mean: number; destroyed_mean: number; range: number;
        destroyed_per_second: number;
        crafts: number; placed: number; returned_share: number; returned_range: number;
        car_max: number; car_capacity: number; full_ticks: number;
        recycler_status: Record<string, number>;
        /** What waited in the recycler's output after a tick while the car had room, by the count, in ticks */
        result_after_tick: Record<string, number>;
        taker_wake_ups_per_minute: number;
    };
    cut: {during: number[]; first_back: number | null; car_after: number};
    /** The backlog put into the car: the periods until the car was back under its highest of the hour, and the ore brought in a period meanwhile and after (periods, and of them at the target) */
    backlog: {inserted: number; periods_to_drain: number | null; fresh_while_draining: number[]; after: {periods: number; at_target: number}};
    blocked_input: OreVoiderReport["blocked_input"];
}

const quiet = {log() {}, info() {}, warn() {}, error() {}, debug() {}};

function scaffoldOf(config_path: string): string {
    return fs.readFileSync(config_path.replace(/\.json$/, "-scaffold.txt"), "utf8").trim();
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

/** Judges a run: the summary, and an assertion for each condition a clock for a random output has to meet */
export function summarize(report: OreVoiderReport, config: Config, clock: OreVoiderSummary["clock"], sigma_period: number, chance: number): OreVoiderSummary {
    const {phases, periods} = report;
    const baseline = periods.slice(0, phases.cut);
    expect(baseline.length, "an hour of whole periods").toBe(phases.cut);
    const expected = clock.expected;
    const fresh = sum(baseline.map(it => it.fresh));
    const crafts = sum(baseline.map(it => it.crafts));
    const placed = sum(baseline.map(it => it.placed));
    // each craft destroys the ore it takes, less what it gives back
    const destroyed = crafts - placed;
    const range = 3 * sigma_period / Math.sqrt(baseline.length);
    const car_max = Math.max(...baseline.map(it => it.car_max));
    const ticks = baseline.length * clock.period;
    const wake = report.wake.alarms.reduce((total, alarms) => total + alarms, 0);
    const cut = periods.slice(phases.cut, phases.backlog);
    const after_release = periods.slice(phases.release, phases.backlog);
    const first_back = after_release.findIndex((_, index) => after_release.slice(index).every(it => it.fresh === expected));
    const drain = periods.slice(phases.backlog, phases.probe);
    const drained = drain.findIndex(it => it.car_max <= car_max);
    return {
        generationVerdict: clock.verdict, target: config.target_output.items_per_second, period: clock.period, expected,
        clock: {...clock, taker_wake_ups_per_minute: clock.taker_wake_ups_per_minute},
        baseline: {
            periods: baseline.length,
            fresh_mean: fresh / baseline.length, destroyed_mean: destroyed / baseline.length, range,
            destroyed_per_second: destroyed / (ticks / 60),
            crafts, placed, returned_share: placed / crafts, returned_range: 3 * Math.sqrt(crafts * chance * (1 - chance)) / crafts,
            car_max, car_capacity: report.capacity, full_ticks: sum(baseline.map(it => it.full_ticks)),
            recycler_status: report.recycler_status, result_after_tick: report.result_after_tick,
            taker_wake_ups_per_minute: wake * 3600 / ticks,
        },
        cut: {during: cut.slice(0, phases.release - phases.cut + 4).map(it => it.fresh), first_back: first_back < 0 ? null : first_back,
            car_after: after_release[after_release.length - 1]?.car ?? -1},
        backlog: {inserted: report.events.find(it => it.action === "backlog")?.inserted ?? 0,
            periods_to_drain: drained < 0 ? null : drained,
            fresh_while_draining: drain.slice(0, Math.max(0, drained)).map(it => it.fresh),
            after: {periods: drain.length - Math.max(0, drained), at_target: drain.slice(Math.max(0, drained)).filter(it => it.fresh === expected).length}},
        blocked_input: report.blocked_input,
    };
}

/** The conditions a clock for a random output meets in the game (holds, the car never full, recovers) */
export function assertHolds(summary: OreVoiderSummary): void {
    const {baseline, clock} = summary;
    expect(Math.abs(baseline.fresh_mean - clock.expected), "the ore brought in a period, on average over the hour").toBeLessThanOrEqual(baseline.range);
    expect(Math.abs(baseline.destroyed_mean - clock.expected), "the ore destroyed a period, on average over the hour").toBeLessThanOrEqual(baseline.range);
    expect(Math.abs(baseline.returned_share - 0.25), "the share of crafts that gave the ore back").toBeLessThanOrEqual(baseline.returned_range);
    expect(baseline.car_max, "the car is never full").toBeLessThan(baseline.car_capacity);
    expect(baseline.full_ticks, "the recycler never waits for room in the car").toBe(0);
    expect(summary.cut.first_back, "back at the target after the ore came back").not.toBeNull();
    expect(summary.cut.first_back!, "within 10 periods").toBeLessThanOrEqual(10);
    expect(summary.backlog.periods_to_drain, "the backlog in the car drained").not.toBeNull();
    expect(summary.backlog.after.at_target, "at the target once the backlog is gone").toBe(summary.backlog.after.periods);
}

export async function captureOreVoider(variant: OreVoiderCase): Promise<OreVoiderSummary> {
    const capture = captureOf(variant.name);
    try {
        const config_path = ConfigPaths[variant.sample];
        const config = await loadConfigFromFile(config_path);
        const generated = generateClockAlternatives(config, {logger: quiet});
        const selected = variant.alternative === undefined ? generated.alternatives[generated.selected_index]
            : generated.alternatives.find(alternative => alternative.id === variant.alternative);
        if (!selected) throw new Error(`No alternative ${variant.alternative} for ${variant.name}`);
        const exported = selected.result.subtick ?? selected.result;
        const period = selected.result.simulation_duration.ticks;
        const margin = selected.result.random_margins!.windows[0];
        const takers = new Set(margin.inserter_ids);
        const per_inserter = selected.result.stability_check.as_built?.wake_ups?.inserters ?? [];
        const clock = {id: selected.id, period, expected: config.target_output.items_per_second * period / 60, verdict: selected.verdict,
            wake_ups_per_minute: selected.assessment.wake_ups_per_minute ?? 0,
            taker_wake_ups_per_minute: sum(per_inserter.filter(it => takers.has(it.inserter_id)).map(it => it.wake_ups_per_minute))};
        const sha = clockHash(exported);
        const controls = readControls<{cases: Record<string, {recorded: {clock_sha256: string}}>}>("ore-voider-clock-controls.json");
        const recorded = controls.cases[variant.name]?.recorded.clock_sha256;
        if (recorded && process.env.ORE_VOIDER_CALIBRATE !== "1") {
            expect(sha, `the clock ${variant.name} runs is not the one its summary in ore-voider-clock-controls.json was recorded on: record it again`).toBe(recorded);
        }
        fs.writeFileSync(path.join(capture.directory, "clock.json"), JSON.stringify({...clock, sha256: sha}) + "\n");
        const phases = ORE_VOIDER_PHASES;
        const total_periods = phases.settle_periods + phases.baseline_periods + phases.cut_periods + phases.after_cut_periods + phases.backlog_periods + 10;
        const {recording} = await recordInFactorio({factorio: process.env.FACTORIO_PATH!, save: process.env.FACTORIO_HARNESS_SAVE!, config,
            clock: {blueprint: encodeBlueprintFile({blueprint: exported.blueprint}), schedule: exported.schedule}, blueprint: scaffoldOf(config_path),
            out: path.join(capture.directory, "recording.json"), work_dir: path.join(capture.directory, "game"),
            ticks: 2 * period, warmup_ticks: 600, settle_ticks: total_periods * period + phases.probe_ticks * 2, seed: [], unclocked: false,
            lua: composeProbeSource(path.join(__dirname, "ore-voider-clock-probe.lua"), {period, ...phases}),
            game_speed: 1000, watch: false, timeout_seconds: 3600, log() {}});
        // the build as Sidecar exports it: the recycler puts its results into the car
        const exported_config = recording.config as {machines?: {result_target?: unknown}[]; chests?: {type: string; id: number}[]};
        const car = exported_config.chests?.find(chest => chest.type === "car");
        expect(exported_config.machines?.[0]?.result_target, "Sidecar exports the car as the recycler's result target").toEqual({type: "chest", id: car?.id});
        const report = JSON.parse(fs.readFileSync(path.join(capture.directory, "game/script-output/ore-voider.json"), "utf8")) as OreVoiderReport;
        expect(report.error, "the probe ran to its end").toBeUndefined();
        const summary = summarize(report, config, clock, margin.sigma_items, margin.expected_items / margin.crafts);
        fs.writeFileSync(path.join(capture.directory, "summary.json"), JSON.stringify(summary, null, 1) + "\n");
        fs.writeFileSync(path.join(capture.directory, "report.json"), JSON.stringify(report) + "\n");
        return summary;
    } finally {capture.cleanup();}
}
