import fs from "fs";
import path from "path";
import {expect} from "vitest";
import {Config} from "../../../src/config";
import {generateClockAlternatives} from "../../../src/crafting/generate-blueprint";
import {encodeBlueprintFile} from "../../../src/blueprints/serde";
import {BuiltClock} from "../../../src/harness/built-clock";
import {GeneratedClock, recordInFactorio} from "../../../src/harness/factorio-harness";
import {recipesMaking} from "../../../src/harness/recording-output";
import {Recording} from "../../../src/verification/recording";
import {FixtureBeltSpeed, speedCapture} from "../helpers/belt-speed-fixtures";
import {composeProbeSource} from "../helpers/probe-source";
import {assertPickupClockHardware} from "./pickup-clock-speed-hardware";
import {judgeBaseline, RunRecord} from "../helpers/run-judgement";
import {clockHash, clockToRun, expectedNativeSummary, NativeRunSummary} from "./clock-controls";

export interface PickupClockScenario {
    name: string;
    speed: FixtureBeltSpeed;
    backed: boolean;
    config: () => Config | Promise<Config>;
    scaffold: () => string;
    /** The family's controls file (clock-controls.ts), whose entry for the scenario the capture is compared with */
    controls: string;
    /** The id of the alternative to record, in place of the selected one */
    alternative?: string;
    /**
     * The clock the scaffold came with, named to the harness (HarnessOptions.built_clock). Without `keep_built_clock` the
     * generated clock replaces it; with it nothing is generated and the build's own clock is the one recorded.
     */
    built_clock?: BuiltClock;
    keep_built_clock?: boolean;
    /** The identity of the clock the build came with, as its control names it (a build's own clock is no selection to hash) */
    builtClockSha256?: () => string;
    /** The copies of the config the build holds, for a generated clock wired to each (HarnessOptions.copies) */
    copies?: number;
    /** The share of the config's target the build makes, where it holds fewer copies than the config says (1/7 for one copy of seven) */
    share?: number;
    /**
     * A baseline longer than the protocol's minute, with the reason the build needs it (an output that only evens out over a
     * longer stretch); never over RUN_PROTOCOL.maxBaseline
     */
    baseline?: {ticks: number; reason: string};
    /** A probe of its own, in place of pickup-clock-speed-probe.lua: it runs steady.lua with its own disturbances and writes clock-speed.json */
    probeFile?: string;
    probe: {family: string; machine_name?: string; ingredients?: readonly [string, string]; output_to_belt?: boolean;
        trace_ticks?: number; stackSize?: number};
    /** The native setup audit, in place of assertPickupClockHardware (which expects a belt-fed input) */
    assertHardware?: (recording: Recording, config: Config, blueprint: string) => void;
    validateRecording?: (recording: Recording, config: Config) => void;
}

interface Prepared {
    config: Config;
    /** Absent where the build's own clock is recorded */
    clock?: GeneratedClock;
    period: number;
    expected: number;
    generationSeconds: number;
    generationVerdict: string;
    /** The sha256 of the clock's identity (clock-controls.ts); absent from a retained generated-clock.json made before it was kept */
    clockSha256?: string;
    selection?: {id: string; holds: boolean; rate: number; supply: "moving" | "backed_up" | null};
}
const generated = new Map<string, Prepared>();
const quiet = {log() {}, info() {}, warn() {}, error() {}, debug() {}};

/**
 * The game tests' protocol, timed in game ticks (helpers/lua/steady.lua; owner 2026-11-03): steady state is the first tick the
 * machines that make the target item have finished target x 60 s over the trailing minute; the baseline is the minute after it
 * (a family may ask for more with a reason, never over 10 minutes); each disturbance lasts until it reduces output and is
 * recovered within 10 minutes of its release. A whole run is never over 15 minutes of game time: one that would be is not recorded.
 */
export const RUN_PROTOCOL = {window: 3600, baseline: 3600, maxBaseline: 36_000, cap: 54_000} as const;
/** Ticks recorded after the run, for the audit of the native build: one minute from the run's end, cut by no clock */
const AUDIT_TICKS = 3600;

async function prepare(scenario: PickupClockScenario): Promise<Prepared> {
    const key = scenario.name;
    const cached = generated.get(key);
    if (cached) return cached;
    const config = await scenario.config();
    const started = performance.now();
    if (scenario.keep_built_clock) {
        const built = scenario.built_clock!;
        const kept = {config, period: built.period, expected: config.target_output.items_per_second * built.period / 60,
            generationSeconds: 0, generationVerdict: "the build's own clock", clockSha256: scenario.builtClockSha256?.()};
        generated.set(key, kept);
        return kept;
    }
    const alternatives = generateClockAlternatives(config, {logger: quiet});
    const selected = scenario.alternative === undefined ? alternatives.alternatives[alternatives.selected_index]
        : alternatives.alternatives.find(alternative => alternative.id === scenario.alternative);
    if (!selected) throw new Error(`No alternative ${scenario.alternative} for ${scenario.name}`);
    // A generation-only preflight checks the target. Native captures also retain below-target candidates:
    // their output is evidence of a shortfall, rather than a reason to skip the game measurement entirely.
    if (process.env.BELT_CLOCK_GENERATION_ONLY === "1" && process.env.BELT_CLOCK_CALIBRATE !== "1") {
        // the rate is a sum of floating-point rates: 26 steel plates a second came out as 26.000000000000004
        expect(selected.assessment.items_per_second).toBeCloseTo(config.target_output.items_per_second, 9);
    }
    const exported = selected.result.subtick ?? selected.result;
    const period = selected.result.subtick?.clock.period_ticks ?? selected.result.simulation_duration.ticks;
    const prepared = {config, period, expected: config.target_output.items_per_second * period / 60,
        clock: {blueprint: encodeBlueprintFile({blueprint: exported.blueprint}), schedule: exported.schedule},
        generationSeconds: (performance.now() - started) / 1000, generationVerdict: selected.verdict, clockSha256: clockHash(exported),
        selection: {id: selected.id, holds: selected.assessment.holds, rate: selected.assessment.items_per_second,
            supply: selected.belt?.kind ?? null}};
    generated.set(key, prepared);
    return prepared;
}

/** What steady.lua writes into the probe's report: the record of the run, which helpers/run-judgement.js judges */
type RunReport = RunRecord;

/** The summary a run is compared with in its controls file: the record judged host-side (helpers/run-judgement.js) */
export function runSummary(run: RunReport, clock: {generationVerdict: string; target: number; period: number}, exactTarget = clock.target): NativeRunSummary {
    const {baseline, stock} = judgeBaseline(run, exactTarget);
    return {protocol: "trailing-minute", generationVerdict: clock.generationVerdict, target: clock.target, period: clock.period,
        window: run.window, expected: run.expected, steady: run.steady ?? null, baseline,
        // Lua writes an empty table as {}: a run that never reached steady state has no disturbances
        disturbances: (Array.isArray(run.disturbances) ? run.disturbances : []).map(({kind, start, drop, release, recovered}) => ({kind, start,
            ...(drop !== undefined && {drop}), ...(release !== undefined && {release}), ...(recovered !== undefined && {recovered})})),
        stock, result: run.result!, ended: run.ended!};
}

/** One run of a clock under the protocol: steady state, the baseline, and each disturbance with its recovery */
export async function capturePickupClockScenario(scenario: PickupClockScenario) {
    const capture = speedCapture(scenario.name);
    try {
        const replayDirectory = process.env.BELT_CLOCK_REPLAY_DIR ? path.resolve(process.env.BELT_CLOCK_REPLAY_DIR, scenario.name) : undefined;
        const generationRoot = process.env.BELT_CLOCK_GENERATION_DIR;
        const generationPath = generationRoot ? path.resolve(generationRoot, `${scenario.name}.json`) : undefined;
        const retainedClock = replayDirectory ? path.join(replayDirectory, "generated-clock.json") : generationPath;
        const prepared: Prepared = retainedClock && fs.existsSync(retainedClock)
            ? JSON.parse(fs.readFileSync(retainedClock, "utf8")) : await prepare(scenario);
        if (generationPath && !fs.existsSync(generationPath)) {
            fs.mkdirSync(path.dirname(generationPath), {recursive: true});
            fs.writeFileSync(generationPath, JSON.stringify(prepared) + "\n");
        }
        fs.writeFileSync(path.join(capture.directory, "generated-clock.json"), JSON.stringify(prepared) + "\n");
        // the summary is compared with the recording of one clock: on another one it says nothing, so no game is started
        const recordedClock = clockToRun(scenario.controls, scenario.name);
        if (recordedClock && prepared.clockSha256 && process.env.BELT_CLOCK_CALIBRATE !== "1") {
            expect(prepared.clockSha256, `the clock ${scenario.name} runs is not the one its native summary in ${path.basename(scenario.controls)} was recorded on `
                + "(recorded.clock_sha256): record it again in the game, or say in recorded.carried why the recording still holds").toBe(recordedClock);
        }
        if (prepared.selection) fs.writeFileSync(path.join(capture.directory, "generation-selection.json"), JSON.stringify(prepared.selection) + "\n");
        if (process.env.BELT_CLOCK_GENERATION_ONLY === "1") return;
        const {config, clock, period} = prepared;
        const inputConfig = config.inserters.find(inserter => inserter.source.type === "belt" && inserter.sink.type === "machine");
        // a probe of the scenario's own may watch a clock whose inputs come from chests
        if (inputConfig?.source.type !== "belt" && !scenario.probeFile) throw new Error("Expected one belt-fed clock input");
        const reach = inputConfig?.source.type === "belt" ? inputConfig.source.pickup_length ?? 1 : undefined;
        const blueprint = scenario.scaffold();
        fs.writeFileSync(path.join(capture.directory, "scaffold.txt"), blueprint.trim() + "\n");
        const share = scenario.share ?? 1;
        const target = config.target_output.items_per_second * share;
        const expectedPerWindow = Math.round(target * RUN_PROTOCOL.window / 60 * 1e6) / 1e6;
        const baselineTicks = scenario.baseline?.ticks ?? RUN_PROTOCOL.baseline;
        if (scenario.baseline && (!scenario.baseline.reason.trim() || baselineTicks > RUN_PROTOCOL.maxBaseline || baselineTicks <= RUN_PROTOCOL.baseline)) {
            throw new Error(`${scenario.name}: a longer baseline needs a reason and at most ${RUN_PROTOCOL.maxBaseline} ticks`);
        }
        const recipes = [...recipesMaking(config, config.target_output.recipe)];
        // the copies of the config the build holds: those the clock is wired to, or the config's copies times the build's share of them
        const buildCopies = scenario.copies ?? Math.round((config.target_output.copies ?? 1) * share);
        const finals = config.machines.filter(machine => recipes.includes(machine.recipe)).length * buildCopies;
        const recording = replayDirectory ? JSON.parse(fs.readFileSync(path.join(replayDirectory, "recording.json"), "utf8"))
            : (await recordInFactorio({factorio: process.env.FACTORIO_PATH!, save: process.env.FACTORIO_HARNESS_SAVE!, config, clock, blueprint, built_clock: scenario.built_clock, copies: scenario.copies,
                out: path.join(capture.directory, "recording.json"), work_dir: path.join(capture.directory, "game"),
                ticks: AUDIT_TICKS, record_at_once: true, warmup_ticks: 3600, settle_ticks: RUN_PROTOCOL.cap + 1, seed: [], unclocked: false,
                lua: composeProbeSource(scenario.probeFile ?? path.join(__dirname, "pickup-clock-speed-probe.lua"), {
                    ...scenario.probe, window: RUN_PROTOCOL.window, expected: expectedPerWindow, baseline: baselineTicks, cap: RUN_PROTOCOL.cap,
                    recipes, item: config.target_output.recipe, speed: scenario.speed.units / 32, reach,
                }), game_speed: 1000, watch: false, timeout_seconds: 900, log() {},
            })).recording;
        (scenario.assertHardware ?? assertPickupClockHardware)(recording, config, blueprint);
        scenario.validateRecording?.(recording, config);
        const report = JSON.parse(fs.readFileSync(path.join(replayDirectory ?? capture.directory, "game/script-output/clock-speed.json"), "utf8"));
        if (reach !== undefined) {
            const source = recording.inserters.find((inserter: {source: {type: string}; sink: {type: string}}) => inserter.source.type === "belt" && inserter.sink.type === "machine")!;
            expect(source.source.pickup_length).toBe(reach);
            expect(report.initial).toMatchObject({speed: scenario.speed.units / 32, reach: reach});
        }
        const run = report.protocol as RunReport;
        expect(run.error, "the probe failed in the game").toBeUndefined();
        expect(run.result, "the run did not end before the recording: over the cap").toBeDefined();
        // the machines the probe counted are the config's that make the target item, in every copy
        expect(Array.isArray(run.finals) ? run.finals : [], "the final machines the probe counts").toHaveLength(finals);
        const summary = runSummary(run, {generationVerdict: prepared.generationVerdict, target: Math.round(target * 1e6) / 1e6, period}, target);
        fs.writeFileSync(path.join(capture.directory, "summary.json"), JSON.stringify(summary) + "\n");
        if (process.env.BELT_CLOCK_CALIBRATE !== "1") {
            expect(summary).toEqual(expectedNativeSummary(scenario.controls, scenario.name));
        }
    } finally {capture.cleanup();}
}
