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
import {clockHash, NativeRunSummary, readControls, runHolds} from "./clock-controls";
import {RUN_PROTOCOL, runSummary} from "./pickup-clock-capture";

/**
 * The scrap silo (`recycling/scrap-silo`): a recycler on scrap at +300% productivity destroys 2 scrap a second and places its
 * twelve results, each from 1% to 20% of a roll, into a rocket silo; filter stack inserters take them out. Its clocks
 * give each set of takers one window a period (result-windows.ts). One run under the game tests' protocol
 * (helpers/lua/steady.lua) on each clock. The target counts the scrap destroyed (the config's `counts: "destroyed"`), so the
 * run counts what the feed inserter drops into the recycler, against the target x 60 s a minute: the recycler's results are
 * random and are not what the target counts. The disturbances: the scrap supply cut, and the output blocked (every taker
 * disabled and the silo filled with results until it refuses them all), each recovered from.
 *
 * The baseline is the clock's whole cycle where that is over the protocol's minute (the selected clock's is 5,760 ticks, 12
 * hands of scrap): the baseline of a minute has no whole cycle in it. What the recycler gives is random in the game, so
 * beside the protocol the baseline is judged on each result's count against its binomial (over the rolls the recycler made in it),
 * the takers taking out what was placed, and the recycler never stopping. Dropped with the four hours (owner's protocol,
 * 2026-11-03): the rate in every period, which the baseline's whole cycle now judges, the trials of windows missed by
 * some takers (the output block is the protocol's), and the silo being at the target at the end of the run.
 */
export interface ScrapSiloCase {
    name: string;
    /** The config, and its scaffold beside it (`-scaffold.txt`) */
    config_path: string;
    /** The alternative recorded, in place of the selected one */
    alternative?: string;
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

/**
 * The baseline of a clock: the protocol's minute, or one whole cycle of the clock where its period is longer (the protocol
 * judges the products of whole cycles; the reason is stated for a baseline over the minute)
 */
export function scrapSiloBaseline(period: number): {ticks: number; reason?: string} {
    if (period <= RUN_PROTOCOL.baseline) return {ticks: RUN_PROTOCOL.baseline};
    if (period > RUN_PROTOCOL.maxBaseline) throw new Error(`The clock's cycle of ${period} ticks is over the longest baseline of ${RUN_PROTOCOL.maxBaseline}`);
    return {ticks: period, reason: `the clock's cycle is ${period} ticks, longer than the minute: a baseline of one whole cycle is the least with a whole cycle in it`};
}

/** What the probe writes into its report, beside steady.lua's `protocol` */
interface ScrapSiloReport {
    items: string[]; weight: Record<string, number>;
    /** Counted over the baseline's ticks */
    baseline: {
        ticks: number;
        /** Scrap the feed dropped into the recycler, and the recycler's rolls (products_finished: crafts and productivity payouts) */
        fresh: number; rolls: number;
        placed: Record<string, number>; taken: Record<string, number>;
        weight_max: number; open_weight_max: number;
        stuck_ticks: number; waiting_ticks: number;
        /** Window openings at which the silo had no room for the heaviest result */
        full_openings: number;
    };
    takers: {unit: number; items: string[]; hand: number; alarm_ticks: number; alarm_results: number; woken: number; waiting_ticks: number;
        enabled_ticks: number; openings: number; held_at_open: Record<string, number>}[];
    events: {tick: number; action: string}[];
    blocked_at?: number;
    protocol: Parameters<typeof runSummary>[0];
    error?: string;
}

/** What the baseline shows beyond the protocol's verdict, as the controls keep it */
export interface ScrapSiloObserved {
    clock: {id: string; label: string; period: number; expected: number; verdict: string; wake_ups_per_minute: number; sha256: string};
    baseline: {
        ticks: number; periods: number; minutes: number;
        /** Scrap dropped into the recycler, the recipe's rolls (products_finished), and the rolls at the productivity */
        fresh: number; rolls: number; rolls_expected: number;
        /** By result: placed into the silo, its binomial expectation, standard deviation and tail (the less likely of the two sides) from the rolls, taken out */
        results: {item: string; chance: number; placed: number; expected: number; sigma: number; z: number; tail: number; taken: number}[];
        lift: number; open_weight_max: number; weight_max: number;
        /** Openings at which the silo had no room for the heaviest result, of all openings */
        full_openings: number; openings: number;
        stuck_ticks: number; waiting_ticks: number;
        /** The wake-up stand-in: placings while a taker waited at the silo enabled, a minute (ticks, and results) */
        wake_ticks_per_minute: number; wake_results_per_minute: number;
        takers: {items: string[]; wake_ticks_per_minute: number; wake_results_per_minute: number; openings: number; held_at_open: Record<string, number>}[];
    };
}

/** A run under the protocol, with the figures this family still judges */
export type ScrapSiloRun = NativeRunSummary & {observed: ScrapSiloObserved};

const quiet = {log() {}, info() {}, warn() {}, error() {}, debug() {}};
const LIFT = FactorioDataService.findRocketSiloOrThrow("rocket-silo").lift_weight;
/** A result's count is out of range at a tail of this probability: 3.5 standard deviations, 0.023% a side, and about 0.5% for twelve results of both sides */
export const RESULT_TAIL = 2.3e-4;

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

/** The probabilities of at most and of at least `count` successes in `n` rolls of chance `p` (the exact binomial, summed in logs: n can be thousands) */
export function binomialTails(n: number, p: number, count: number): {atMost: number; atLeast: number} {
    if (p <= 0 || p >= 1) return {atMost: count >= (p >= 1 ? n : 0) ? 1 : 0, atLeast: count <= (p >= 1 ? n : 0) ? 1 : 0};
    const step = Math.log(p / (1 - p));
    let log = n * Math.log(1 - p);
    const pmf: number[] = [];
    for (let k = 0; k <= n; k++) {
        pmf.push(Math.exp(log));
        log += Math.log((n - k) / (k + 1)) + step;
    }
    const clamped = Math.min(Math.max(count, 0), n);
    // each tail is summed from its own end, smallest terms first, and not as one less than the other
    let atMost = 0, atLeast = 0;
    for (let k = clamped; k >= 0; k--) atMost += pmf[k];
    for (let k = n; k >= clamped; k--) atLeast += pmf[k];
    return {atMost: count < 0 ? 0 : Math.min(1, atMost), atLeast: count > n ? 0 : Math.min(1, atLeast)};
}

/** The run's summary under the protocol, with the baseline's figures for the checks a clock for random results has to meet */
export function summarize(report: ScrapSiloReport, config: Config, clock: ScrapSiloObserved["clock"]): ScrapSiloRun {
    const run = runSummary(report.protocol, {generationVerdict: clock.verdict, target: config.target_output.items_per_second, period: clock.period});
    const b = report.baseline;
    const minutes = b.ticks / 3600;
    const chance = chances(config);
    const results = report.items.map(item => {
        const p = chance.get(item) ?? 0;
        const placed = b.placed[item] ?? 0;
        const expected = b.rolls * p;
        const sigma = Math.sqrt(b.rolls * p * (1 - p));
        const tails = binomialTails(b.rolls, p, placed);
        return {item, chance: p, placed, expected, sigma, z: sigma > 0 ? (placed - expected) / sigma : 0, tail: Math.min(tails.atMost, tails.atLeast),
            taken: b.taken[item] ?? 0};
    });
    const takers = report.takers.map(it => ({items: it.items, wake_ticks_per_minute: it.alarm_ticks / minutes, wake_results_per_minute: it.alarm_results / minutes,
        openings: it.openings, held_at_open: it.held_at_open}));
    return {
        ...run,
        observed: {
            clock,
            baseline: {
                ticks: b.ticks, periods: b.ticks / clock.period, minutes, fresh: b.fresh, rolls: b.rolls,
                rolls_expected: b.fresh * (1 + (config.machines[0].productivity ?? 0) / 100), results, lift: LIFT,
                full_openings: b.full_openings, openings: sum(report.takers.map(it => it.openings)),
                open_weight_max: b.open_weight_max, weight_max: b.weight_max, stuck_ticks: b.stuck_ticks, waiting_ticks: b.waiting_ticks,
                wake_ticks_per_minute: sum(takers.map(it => it.wake_ticks_per_minute)), wake_results_per_minute: sum(takers.map(it => it.wake_results_per_minute)),
                takers,
            },
        },
    };
}

/** The conditions a clock of result windows meets in the game: the protocol (holds the target, recovers from the cut and the block), each result in its binomial's range, the recycler never stopping */
export function assertHolds(summary: ScrapSiloRun): void {
    const {baseline} = summary.observed;
    expect(runHolds(summary), `the run holds the target and recovers from each disturbance (${summary.result})`).toBe(true);
    expect(baseline.rolls, "the recycler made rolls in the baseline").toBeGreaterThan(0);
    for (const result of baseline.results) {
        expect(result.tail, `${result.item}: placed within the binomial's range of the rolls (z ${result.z.toFixed(2)})`).toBeGreaterThanOrEqual(RESULT_TAIL);
        expect(Math.abs(result.placed - result.taken), `${result.item}: taken out as it was placed`).toBeLessThanOrEqual(result.expected / baseline.periods * 2 + 32);
    }
    // the silo may be full at an opening in about 1 period in 740 (the windows' level): what it refuses waits in the
    // recycler's slots, a stack of each, and only a stack waiting stops it
    expect(baseline.stuck_ticks, "the recycler never stops").toBe(0);
}

export async function captureScrapSilo(variant: ScrapSiloCase): Promise<ScrapSiloRun> {
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
        const baseline = scrapSiloBaseline(period);
        const expectedPerWindow = Math.round(config.target_output.items_per_second * RUN_PROTOCOL.window / 60 * 1e6) / 1e6;
        const {recording} = await recordInFactorio({factorio: process.env.FACTORIO_PATH!, save: process.env.FACTORIO_HARNESS_SAVE!, config,
            clock: {blueprint: encodeBlueprintFile({blueprint: exported.blueprint}), schedule: exported.schedule},
            blueprint: fs.readFileSync(variant.config_path.replace(/\.json$/, "-scaffold.txt"), "utf8").trim(),
            out: path.join(capture.directory, "recording.json"), work_dir: path.join(capture.directory, "game"),
            ticks: 3600, record_at_once: true, warmup_ticks: 600, settle_ticks: RUN_PROTOCOL.cap + 1, seed: [], unclocked: false,
            lua: composeProbeSource(path.join(__dirname, "scrap-silo-clock-probe.lua"),
                {period, window: RUN_PROTOCOL.window, expected: expectedPerWindow, baseline: baseline.ticks, cap: RUN_PROTOCOL.cap, lift: LIFT}),
            game_speed: 1000, watch: false, timeout_seconds: 900, log() {}});
        // the build as Sidecar exports it: the recycler puts its results into the silo
        const exported_config = recording.config as {machines?: {result_target?: unknown}[]; chests?: {type: string; id: number}[]};
        const silo = exported_config.chests?.find(chest => chest.type === "rocket-silo");
        expect(exported_config.machines?.[0]?.result_target, "Sidecar exports the silo as the recycler's result target").toEqual({type: "chest", id: silo?.id});
        const report = JSON.parse(fs.readFileSync(path.join(capture.directory, "game/script-output/scrap-silo.json"), "utf8")) as ScrapSiloReport;
        expect(report.error ?? report.protocol.error, "the probe ran to its end").toBeUndefined();
        expect(report.protocol.result, "the run did not end before the recording: over the cap").toBeDefined();
        const summary = summarize(report, config, clock);
        fs.writeFileSync(path.join(capture.directory, "summary.json"), JSON.stringify(summary, null, 1) + "\n");
        fs.writeFileSync(path.join(capture.directory, "report.json"), JSON.stringify(report) + "\n");
        return summary;
    } finally {capture.cleanup();}
}
