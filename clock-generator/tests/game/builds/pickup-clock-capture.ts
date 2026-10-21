import fs from "fs";
import path from "path";
import {expect} from "vitest";
import {Config} from "../../../src/config";
import {generateClockAlternatives} from "../../../src/crafting/generate-blueprint";
import {encodeBlueprintFile} from "../../../src/blueprints/serde";
import {GeneratedClock, recordInFactorio} from "../../../src/harness/factorio-harness";
import {outputPerPeriod, recipesMaking} from "../../../src/harness/recording-output";
import {Recording} from "../../../src/verification/recording";
import {FixtureBeltSpeed, speedCapture} from "../helpers/belt-speed-fixtures";
import {composeProbeSource} from "../helpers/probe-source";
import {assertPickupClockHardware} from "./pickup-clock-speed-hardware";
import {expectedNativeSummary} from "./clock-controls";

export interface PickupClockScenario {
    name: string;
    speed: FixtureBeltSpeed;
    backed: boolean;
    config: () => Config | Promise<Config>;
    scaffold: () => string;
    /** The family's controls file (clock-controls.ts), whose entry for the scenario the capture is compared with */
    controls: string;
    outagePeriods?: number;
    /** Interventions of a probe of its own, in place of pickupClockInterventions(outagePeriods) */
    interventions?: [number, number, number][];
    /** A probe of its own, in place of pickup-clock-speed-probe.lua; it writes the same clock-speed.json */
    probeFile?: string;
    probe: {family: string; machine_name?: string; ingredients?: readonly [string, string]; output_to_belt?: boolean;
        trace_periods?: readonly number[]; trace_ticks?: number; stackSize?: number};
    /** The native setup audit, in place of assertPickupClockHardware (which expects a belt-fed input) */
    assertHardware?: (recording: Recording, config: Config, blueprint: string) => void;
    validateRecording?: (recording: Recording, config: Config) => void;
}

interface Prepared {
    config: Config;
    clock: GeneratedClock;
    period: number;
    expected: number;
    generationSeconds: number;
    generationVerdict: string;
    selection?: {id: string; holds: boolean; rate: number; supply: "moving" | "backed_up" | null};
}
const generated = new Map<string, Prepared>();
const quiet = {log() {}, info() {}, warn() {}, error() {}, debug() {}};

/** Shared timing keeps the observer and host assertions on the same intervention windows. */
export function pickupClockInterventions(outagePeriods?: number): [number, number, number][] {
    const ingredient = outagePeriods ?? 2, outlet = outagePeriods ?? 4;
    const firstRelease = 66 + ingredient, block = firstRelease + 16;
    const outletRelease = block + outlet, secondCut = outletRelease + 16;
    const secondRelease = secondCut + ingredient;
    return [[66, firstRelease, block], [block, outletRelease, secondCut], [secondCut, secondRelease, secondRelease + 26]];
}

async function prepare(scenario: PickupClockScenario): Promise<Prepared> {
    const key = scenario.name;
    const cached = generated.get(key);
    if (cached) return cached;
    const config = await scenario.config();
    const started = performance.now();
    const alternatives = generateClockAlternatives(config, {logger: quiet});
    const selected = alternatives.alternatives[alternatives.selected_index];
    // A generation-only preflight checks the target. Native captures also retain below-target candidates:
    // their output is evidence of a shortfall, rather than a reason to skip the game measurement entirely.
    if (process.env.BELT_CLOCK_GENERATION_ONLY === "1" && process.env.BELT_CLOCK_CALIBRATE !== "1") {
        expect(selected.assessment.items_per_second).toBe(config.target_output.items_per_second);
    }
    const exported = selected.result.subtick ?? selected.result;
    const period = selected.result.subtick?.clock.period_ticks ?? selected.result.simulation_duration.ticks;
    const prepared = {config, period, expected: config.target_output.items_per_second * period / 60,
        clock: {blueprint: encodeBlueprintFile({blueprint: exported.blueprint}), schedule: exported.schedule},
        generationSeconds: (performance.now() - started) / 1000, generationVerdict: selected.verdict,
        selection: {id: selected.id, holds: selected.assessment.holds, rate: selected.assessment.items_per_second,
            supply: selected.belt?.kind ?? null}};
    generated.set(key, prepared);
    return prepared;
}

/** One run provides >=60 undisturbed periods before any intervention, plus all three recovery checks. */
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
        if (prepared.selection) fs.writeFileSync(path.join(capture.directory, "generation-selection.json"), JSON.stringify(prepared.selection) + "\n");
        if (process.env.BELT_CLOCK_GENERATION_ONLY === "1") return;
        const {config, clock, period, expected} = prepared;
        const inputConfig = config.inserters.find(inserter => inserter.source.type === "belt" && inserter.sink.type === "machine");
        // a probe of the scenario's own may watch a clock whose inputs come from chests
        if (inputConfig?.source.type !== "belt" && !scenario.probeFile) throw new Error("Expected one belt-fed clock input");
        const reach = inputConfig?.source.type === "belt" ? inputConfig.source.pickup_length ?? 1 : undefined;
        const blueprint = scenario.scaffold();
        fs.writeFileSync(path.join(capture.directory, "scaffold.txt"), blueprint.trim() + "\n");
        const plannedInterventions = scenario.interventions ?? pickupClockInterventions(scenario.outagePeriods);
        const lastPeriod = plannedInterventions[plannedInterventions.length - 1][2];
        const settle = (lastPeriod + 10) * period;
        const recording = replayDirectory ? JSON.parse(fs.readFileSync(path.join(replayDirectory, "recording.json"), "utf8"))
            : (await recordInFactorio({factorio: process.env.FACTORIO_PATH!, save: process.env.FACTORIO_HARNESS_SAVE!, config, clock, blueprint,
                out: path.join(capture.directory, "recording.json"), work_dir: path.join(capture.directory, "game"),
                ticks: 2 * period, warmup_ticks: 3600, settle_ticks: settle, seed: [], unclocked: false,
                lua: composeProbeSource(scenario.probeFile ?? path.join(__dirname, "pickup-clock-speed-probe.lua"), {
                    period, settle: 10 * period, lastPeriod: lastPeriod + 14, ...scenario.probe,
                    ...((scenario.outagePeriods !== undefined || scenario.interventions) && {interventions: plannedInterventions}),
                    speed: scenario.speed.units / 32, reach, product: config.target_output.recipe,
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
        const detailed = outputPerPeriod(recording, recipesMaking(config, config.target_output.recipe));
        expect(detailed).toHaveLength(2);
        const periods = report.periods as {start: number; end: number; items: number}[];
        expect(periods.length).toBeGreaterThanOrEqual(130);
        expect(periods.every(value => value.end - value.start === period)).toBe(true);
        for (const observed of detailed) {
            const aggregate = periods.find(value => value.start === recording.start_game_tick + observed.start
                && value.end === recording.start_game_tick + observed.end);
            expect(aggregate, "compact count overlaps both detailed recorder periods").toBeDefined();
            expect(aggregate!.items).toBe(observed.items);
        }
        const start = report.starts;
        const baseline = periods.filter(value => value.end <= start + 64 * period);
        expect(baseline.length).toBeGreaterThanOrEqual(60);
        const interventions = report.interventions ?? pickupClockInterventions();
        const recovery = (interventions as [number, number, number][]).map(([cut, release, next]) => {
            const during = periods.filter(value => value.start >= start + cut * period
                && value.end <= start + (release + 2) * period);
            const after = periods.filter(value => value.start >= start + (release + (scenario.backed ? 10 : 6)) * period
                && value.end <= start + next * period);
            expect(during.length).toBeGreaterThan(0);
            const zeroBaseline = baseline.some(value => value.items === 0);
            if (!zeroBaseline) {
                expect(during.some(value => value.items < Math.min(...baseline.map(value => value.items))),
                    `disturbance at period ${cut} reduced output below the baseline`).toBe(true);
            }
            expect(after.length).toBeGreaterThan(1);
            return {cut, during: during.map(value => value.items), recovered: after.map(value => value.items),
                ...(zeroBaseline && {not_assessed: "baseline already contains zero-output periods"})};
        });
        const summary = {generationVerdict: prepared.generationVerdict, target: config.target_output.items_per_second, period, expected,
            baseline: baseline.map(value => value.items), recovery,
            ...(report.interventions && {interventions: report.interventions})};
        fs.writeFileSync(path.join(capture.directory, "summary.json"), JSON.stringify(summary) + "\n");
        if (process.env.BELT_CLOCK_CALIBRATE !== "1") {
            expect(summary).toEqual(expectedNativeSummary(scenario.controls, scenario.name));
        }
    } finally {capture.cleanup();}
}
