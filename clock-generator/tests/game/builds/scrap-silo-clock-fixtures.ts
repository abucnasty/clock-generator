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
import {FactorioDataService} from "../../../src/data";
import {RecipeMetadata, yieldOf} from "../../../src/entities";
import {composeProbeSource} from "../helpers/probe-source";
import {clockHash, readControls} from "./clock-controls";

/**
 * The scrap silo (`recycling/scrap-silo`): a recycler on scrap at +300% productivity destroys 2 scrap a second and places
 * its twelve results, each from 1% to 20% of a roll, into a rocket silo; filter stack inserters take them out. Its clocks
 * give each set of takers one window a period (result-windows.ts). What the recycler gives is random in the game, so the
 * run is judged on the rate in every period, each result's count over the baseline against its binomial, the silo never
 * full at a window's opening, the recycler never waiting, and the build back at its rate after each trial: windows
 * missed (takers disabled for whole periods) and the scrap cut.
 */
export interface ScrapSiloCase {
    name: string;
    /** The config, and its scaffold beside it (`-scaffold.txt`) */
    config_path: string;
    /** The alternative recorded, in place of the selected one */
    alternative?: string;
    /** Hours of baseline after the settle */
    baseline_hours?: number;
    /** Recorded and summarized only, not judged: a variant of the build looked at in the game */
    explore?: boolean;
}

/**
 * The cases: the sample on its clock, and with SCRAP_SILO_VARIANT set to a config beside its scaffold (and
 * SCRAP_SILO_VARIANT_ALTERNATIVE to an alternative, if not the selected one), that variant, recorded and not judged
 */
export function scrapSiloCases(): ScrapSiloCase[] {
    const variant = process.env.SCRAP_SILO_VARIANT;
    return [
        {name: "scrap-silo-results-in-turn", config_path: ConfigPaths.RECYCLING_SCRAP_SILO},
        ...(variant ? [{name: `variant-${path.basename(variant, ".json")}`, config_path: path.resolve(variant),
            alternative: process.env.SCRAP_SILO_VARIANT_ALTERNATIVE, explore: true}] : []),
    ];
}

export const SCRAP_SILO_PHASES = {
    settle_periods: 5,
    baseline_hours: 4,
    /** The trials after the baseline, in clock periods: windows missed by the takers of some results, or by all, and the scrap cut */
    trials: [
        {kind: "skip", takers_of: ["iron-gear-wheel"], periods: 1, after: 12},
        {kind: "skip", takers_of: ["holmium-ore"], periods: 4, after: 12},
        {kind: "skip", takers_of: ["copper-cable"], periods: 2, after: 12},
        {kind: "skip", takers_of: "all", periods: 1, after: 16},
        {kind: "skip", takers_of: "all", periods: 2, after: 20},
        {kind: "cut", periods: 4, after: 12},
    ],
} as const;

interface ScrapSiloPeriod {
    start: number; end: number;
    fresh: number; rolls: number;
    placed: Record<string, number>; taken: Record<string, number>;
    weight_max: number; open_weight_max: number;
    stuck_ticks: number; waiting_ticks: number;
    /** Window openings at which the silo had no room for the heaviest result */
    full_openings: number;
}

interface ScrapSiloReport {
    starts: number; period: number; baseline_periods: number; ends_at: number;
    items: string[]; weight: Record<string, number>;
    takers: {unit: number; items: string[]; hand: number; alarm_ticks: number; alarm_results: number; woken: number; waiting_ticks: number;
        enabled_ticks: number; openings: number; held_at_open: Record<string, number>}[];
    periods: ScrapSiloPeriod[];
    events: {tick: number; period: number; action: string}[];
    error?: string;
}

export interface ScrapSiloSummary {
    generationVerdict: string;
    /** Scrap destroyed a second, the target */
    target: number;
    period: number;
    /** Scrap brought in a period at the target */
    expected: number;
    clock: {id: string; label: string; period: number; expected: number; verdict: string; wake_ups_per_minute: number; sha256: string};
    baseline: {
        periods: number; minutes: number;
        /** Periods that brought the expected scrap, of all */
        at_target: number; fresh_mean: number;
        /** The recipe's rolls (crafts with their productivity payouts), and what products_finished counted */
        rolls: number; products_finished: number;
        /** By result: placed into the silo, its binomial expectation and standard deviation from the rolls, taken out */
        results: {item: string; chance: number; placed: number; expected: number; sigma: number; z: number; taken: number}[];
        lift: number; open_weight_max: number; weight_max: number;
        /** Openings at which the silo had no room for the heaviest result, of all openings */
        full_openings: number; openings: number;
        stuck_ticks: number; waiting_ticks: number;
        /** The wake-up stand-in: placings while a taker waited at the silo enabled, a minute (ticks, and results) */
        wake_ticks_per_minute: number; wake_results_per_minute: number;
        takers: {items: string[]; wake_ticks_per_minute: number; wake_results_per_minute: number; openings: number; held_at_open: Record<string, number>}[];
    };
    /** Each trial: the scrap brought a period from its start to the end of its after, the first period from which the rest are all at the target, the silo's weight at the openings meanwhile */
    trials: {trial: unknown; fresh: number[]; first_back: number | null; open_weight_max: number[]; stuck_ticks: number}[];
    /** The last periods of the run at the target */
    ends_at_target: boolean;
}

const quiet = {log() {}, info() {}, warn() {}, error() {}, debug() {}};
const LIFT = FactorioDataService.findRocketSiloOrThrow("rocket-silo").lift_weight;

function sum(values: number[]): number {
    return values.reduce((total, value) => total + value, 0);
}

/** The capture folder of a case: kept under SCRAP_SILO_CAPTURE_DIR when it is set, else a temporary one removed after */
function captureOf(name: string) {
    const root = process.env.SCRAP_SILO_CAPTURE_DIR;
    const directory = root ? path.resolve(root, name) : fs.mkdtempSync(path.join(os.tmpdir(), "scrap-silo-"));
    if (root && fs.existsSync(directory) && fs.readdirSync(directory).length) throw new Error("Use a fresh SCRAP_SILO_CAPTURE_DIR");
    fs.mkdirSync(directory, {recursive: true});
    return {directory, cleanup: () => {if (!root) fs.rmSync(directory, {recursive: true, force: true});}};
}

/** The chance of each result a roll, from the game data */
function chances(config: Config): Map<string, number> {
    const recipe = RecipeMetadata.fromRecipeName(config.machines[0].recipe);
    return new Map(recipe.outputs.map(output => [output.name, yieldOf(output).chance]));
}

export function summarize(report: ScrapSiloReport, config: Config, clock: ScrapSiloSummary["clock"], trials: readonly unknown[]): ScrapSiloSummary {
    const baseline = report.periods.slice(0, report.baseline_periods);
    expect(baseline.length, "the baseline's whole periods").toBe(report.baseline_periods);
    const minutes = baseline.length * clock.period / 3600;
    // the recipe's rolls: a craft and each productivity payout (products_finished counts more: 4.13 a scrap at +300%)
    const rolls = sum(baseline.map(it => it.fresh)) * (1 + (config.machines[0].productivity ?? 0) / 100);
    const products_finished = sum(baseline.map(it => it.rolls));
    const chance = chances(config);
    const results = report.items.map(item => {
        const p = chance.get(item) ?? 0;
        const placed = sum(baseline.map(it => it.placed[item] ?? 0));
        const expected = rolls * p;
        const sigma = Math.sqrt(rolls * p * (1 - p));
        return {item, chance: p, placed, expected, sigma, z: (placed - expected) / sigma, taken: sum(baseline.map(it => it.taken[item] ?? 0))};
    });
    const takers = report.takers.map(it => ({items: it.items, wake_ticks_per_minute: it.alarm_ticks / minutes, wake_results_per_minute: it.alarm_results / minutes,
        openings: it.openings, held_at_open: it.held_at_open}));
    let at = report.baseline_periods;
    const trial_summaries = trials.map(trial => {
        const {periods, after} = trial as {periods: number; after: number};
        const span = report.periods.slice(at, at + periods + after);
        at += periods + after;
        const fresh = span.map(it => it.fresh);
        const first_back = fresh.findIndex((_, index) => index >= periods && fresh.slice(index).every(value => value === clock.expected));
        return {trial, fresh, first_back: first_back < 0 ? null : first_back - periods, open_weight_max: span.map(it => it.open_weight_max),
            stuck_ticks: sum(span.map(it => it.stuck_ticks))};
    });
    const last = report.periods.slice(-4);
    return {
        generationVerdict: clock.verdict, target: config.target_output.items_per_second, period: clock.period, expected: clock.expected,
        clock,
        baseline: {
            periods: baseline.length, minutes, at_target: baseline.filter(it => it.fresh === clock.expected).length,
            fresh_mean: sum(baseline.map(it => it.fresh)) / baseline.length, rolls, products_finished, results, lift: LIFT,
            full_openings: sum(baseline.map(it => it.full_openings)), openings: sum(report.takers.map(it => it.openings)),
            open_weight_max: Math.max(...baseline.map(it => it.open_weight_max)), weight_max: Math.max(...baseline.map(it => it.weight_max)),
            stuck_ticks: sum(baseline.map(it => it.stuck_ticks)), waiting_ticks: sum(baseline.map(it => it.waiting_ticks)),
            wake_ticks_per_minute: sum(takers.map(it => it.wake_ticks_per_minute)), wake_results_per_minute: sum(takers.map(it => it.wake_results_per_minute)),
            takers,
        },
        trials: trial_summaries,
        ends_at_target: last.length === 4 && last.every(it => it.fresh === clock.expected),
    };
}

/** The conditions a clock of result windows meets in the game */
export function assertHolds(summary: ScrapSiloSummary): void {
    const {baseline} = summary;
    expect(baseline.at_target, "every period of the baseline brings the target's scrap").toBe(baseline.periods);
    for (const result of baseline.results) {
        // twelve results: 3.5 standard deviations each, 0.05% a result
        expect(Math.abs(result.z), `${result.item}: placed within the binomial's range of the rolls`).toBeLessThanOrEqual(3.5);
        expect(Math.abs(result.placed - result.taken), `${result.item}: taken out as it was placed`).toBeLessThanOrEqual(result.expected / baseline.periods * 2 + 32);
    }
    // the silo may be full at an opening in about 1 period in 740 (the windows' level): what it refuses waits in the
    // recycler's slots, a stack of each, and only a stack waiting stops it
    expect(baseline.stuck_ticks, "the recycler never stops").toBe(0);
    for (const trial of summary.trials) {
        expect(trial.first_back, `back at the target after ${JSON.stringify(trial.trial)}`).not.toBeNull();
    }
    expect(summary.ends_at_target, "at the target at the end of the run").toBe(true);
}

export async function captureScrapSilo(variant: ScrapSiloCase): Promise<ScrapSiloSummary> {
    const capture = captureOf(variant.name);
    try {
        const config = await loadConfigFromFile(variant.config_path);
        const generated = generateClockAlternatives(config, {logger: quiet});
        const selected = variant.alternative === undefined ? generated.alternatives[generated.selected_index]
            : generated.alternatives.find(alternative => alternative.id === variant.alternative);
        if (!selected) throw new Error(`No alternative ${variant.alternative} for ${variant.name}`);
        const exported = selected.result.subtick ?? selected.result;
        const period = selected.result.simulation_duration.ticks;
        const sha256 = clockHash(exported);
        const controls = readControls<{cases: Record<string, {recorded: {clock_sha256: string}}>}>("scrap-silo-clock-controls.json");
        const recorded = controls.cases[variant.name]?.recorded.clock_sha256;
        if (recorded && process.env.SCRAP_SILO_CALIBRATE !== "1") {
            expect(sha256, `the clock ${variant.name} runs is not the one its summary in scrap-silo-clock-controls.json was recorded on: record it again`).toBe(recorded);
        }
        const clock = {id: selected.id, label: selected.label, period, expected: config.target_output.items_per_second * period / 60,
            verdict: selected.verdict, wake_ups_per_minute: selected.assessment.wake_ups_per_minute ?? 0, sha256};
        fs.writeFileSync(path.join(capture.directory, "clock.json"), JSON.stringify({...clock, windows: selected.result.clock_windows,
            result_windows: selected.result.result_windows}) + "\n");
        const phases = SCRAP_SILO_PHASES;
        const baseline_periods = Math.ceil((variant.baseline_hours ?? phases.baseline_hours) * 216_000 / period);
        const trial_periods = sum(phases.trials.map(it => it.periods + it.after));
        const total_periods = phases.settle_periods + baseline_periods + trial_periods + 2;
        const {recording} = await recordInFactorio({factorio: process.env.FACTORIO_PATH!, save: process.env.FACTORIO_HARNESS_SAVE!, config,
            clock: {blueprint: encodeBlueprintFile({blueprint: exported.blueprint}), schedule: exported.schedule},
            blueprint: fs.readFileSync(variant.config_path.replace(/\.json$/, "-scaffold.txt"), "utf8").trim(),
            out: path.join(capture.directory, "recording.json"), work_dir: path.join(capture.directory, "game"),
            ticks: 2 * period, warmup_ticks: 600, settle_ticks: total_periods * period, seed: [], unclocked: false,
            lua: composeProbeSource(path.join(__dirname, "scrap-silo-clock-probe.lua"), {period, settle_periods: phases.settle_periods,
                baseline_periods, trials: phases.trials, lift: LIFT}),
            game_speed: 1000, watch: false, timeout_seconds: 3600, log() {}});
        // the build as Sidecar exports it: the recycler puts its results into the silo
        const exported_config = recording.config as {machines?: {result_target?: unknown}[]; chests?: {type: string; id: number}[]};
        const silo = exported_config.chests?.find(chest => chest.type === "rocket-silo");
        expect(exported_config.machines?.[0]?.result_target, "Sidecar exports the silo as the recycler's result target").toEqual({type: "chest", id: silo?.id});
        const report = JSON.parse(fs.readFileSync(path.join(capture.directory, "game/script-output/scrap-silo.json"), "utf8")) as ScrapSiloReport;
        expect(report.error, "the probe ran to its end").toBeUndefined();
        const summary = summarize(report, config, clock, phases.trials);
        fs.writeFileSync(path.join(capture.directory, "summary.json"), JSON.stringify(summary, null, 1) + "\n");
        fs.writeFileSync(path.join(capture.directory, "report.json"), JSON.stringify(report) + "\n");
        return summary;
    } finally {capture.cleanup();}
}
