import fs from "fs";
import path from "path";
import zlib from "zlib";
import {createHash} from "crypto";
import {expect, test} from "vitest";
import {Config} from "../../../src/config";
import {generateClockAlternatives} from "../../../src/crafting/generate-blueprint";
import {clockFromWindows} from "../../../src/crafting/trial";
import {SerializableClockWindows} from "../../../src/crafting/clock";
import {encodeBlueprintFile} from "../../../src/blueprints/serde";
import {recordInFactorio} from "../../../src/harness/factorio-harness";
import {composeProbeSource} from "../helpers/probe-source";
import {speedCapture} from "../helpers/belt-speed-fixtures";
import {reflectOrdinaryPickup} from "../mechanics/belt-pickup/ordinary-reflection-fixtures";
import {pickupClockConfig, pickupClockScaffold, pickupClockSpeedCases} from "./pickup-clock-speed-coverage";
import {overHoodClockCases, overHoodClockConfig, overHoodClockScaffold} from "./over-hood-clock-fixtures";
import {clockHash, readControls} from "./clock-controls";
import {reversedDeciders} from "./reversed-deciders";

interface Run {
    case: string; clock: string; rotate: number; decider_order: "built" | "reversed";
    build_order?: "descending"; position?: {x: number; y: number};
    native_phases: [number, number] | null; output: number[]; pickups: number[];
    output_held_sha256: string; input_held_sha256: string;
}
interface Controls {
    frame_offset: number; periods: number;
    clocks: Record<string, {period: number; terminal_swings: number; clock_windows: SerializableClockWindows; clock_sha256: string; recorded_clock_sha256: string}>;
    runs: Record<string, Run>;
}
interface Report {
    placement_tick: number; phases: number[];
    periods: Record<string, {off_lattice: number; phases: Record<string, boolean>}[]>; clock_offsets: number[];
}
const controls = readControls<{cold_start: Controls}>("pickup-clock-start-controls.json").cold_start;
const quiet = {log() {}, info() {}, warn() {}, error() {}, debug() {}};
const sha = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex");

/** The fixture of a run: config, scaffold and belt tier; near lane 2 is the side cell reflected, its near lane keeping its item */
async function fixtureOf(name: string): Promise<{config: Config; scaffold: string; units: number; backed: boolean}> {
    const overHood = overHoodClockCases("different-items").find(it => it.name === name);
    if (overHood) {
        return {config: overHoodClockConfig(overHood), scaffold: overHoodClockScaffold(overHood), units: overHood.speed.units, backed: overHood.backed};
    }
    const [, tier, geometry, supply, near] = /^(\w+)-(.+)-(moving|backed)-l([12])$/.exec(name)!;
    const variant = pickupClockSpeedCases("electromagnetic")
        .find(it => it.speed.name === tier && it.geometry === geometry && it.backed === (supply === "backed"))!;
    const config = await pickupClockConfig(variant);
    let scaffold = pickupClockScaffold(variant);
    if (near === "2") {
        const input = config.inserters.find(inserter => inserter.source.type === "belt")!;
        if (input.source.type !== "belt") throw new Error("Expected a belt-fed input");
        input.source.near_lane = 2;
        config.belts.find(belt => belt.id === input.source.id)!.lanes.reverse();
        // reflectOrdinaryPickup turns the plant half a turn without mirroring it, which leaves its fluid inputs off the
        // reflected pipes; mirroring the east-facing plant flips it north to south and completes the reflection
        const text = reflectOrdinaryPickup(scaffold);
        const reflected = JSON.parse(zlib.inflateSync(Buffer.from(text.trim().slice(1), "base64")).toString());
        for (const entity of reflected.blueprint.entities) if (entity.name === "electromagnetic-plant") entity.mirror = !entity.mirror;
        scaffold = encodeBlueprintFile(reflected);
    }
    return {config, scaffold, units: variant.speed.units, backed: variant.backed};
}

// The clocked cold starts the generation test lays the simulator against (src/crafting/pickup-clock-cold-start.
// generation.test.ts; tests/game/builds/README.md, "Clocked cold starts"), recorded again: the staged start, the
// generator's selected clock (or the same windows started inside the period, with the deciders or the inserters built
// in reverse, or the build moved), nothing written to a belt. The game has to stand where it stood: the same lane phase
// at placement, every period on that lattice, and what both clocked inserters held in every tick.
for (const [name, run] of Object.entries(controls.runs)) test(`clocked cold start: ${name}`, async context => {
    const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
    context.skip(!factorio || !save || !fs.existsSync(save), "Factorio harness is not configured");
    const capture = speedCapture(`cold-start-${name}`);
    try {
        const clockControl = controls.clocks[run.clock];
        const {config, scaffold, units, backed} = await fixtureOf(run.case);
        const P = clockControl.period;
        let exported: {blueprint: any; schedule: any};
        if (run.rotate === 0) {
            const generated = generateClockAlternatives(config, {logger: quiet});
            exported = generated.alternatives[generated.selected_index].result;
        } else {
            exported = clockFromWindows({...config, overrides: {...config.overrides, terminal_swing_count: clockControl.terminal_swings}},
                clockControl.clock_windows, P, quiet);
        }
        if (run.decider_order === "reversed") exported = reversedDeciders(exported.blueprint, exported.schedule);
        const clock = {blueprint: encodeBlueprintFile({blueprint: exported.blueprint}), schedule: exported.schedule};
        expect(clockHash(exported), "the clock these runs were recorded on (recorded_clock_sha256; its identity: no text or metadata)").toBe(clockControl.recorded_clock_sha256);
        const ticks = controls.periods * P;
        const recording = (await recordInFactorio({factorio: factorio!, save: save!, config, blueprint: scaffold, clock,
            out: path.join(capture.directory, "recording.json"), work_dir: path.join(capture.directory, "game"),
            ticks, warmup_ticks: 0, staged_start: {saturation_ticks: backed ? 1200 : 30, ...(run.build_order && {build_order: run.build_order})},
            seed: [], lua: composeProbeSource(path.join(__dirname, "pickup-clock-cold-start-probe.lua"), {ticks, period: P, units}),
            unclocked: false, game_speed: 1000, watch: false, timeout_seconds: 1500, log() {}, ...(run.position && {position: run.position}),
        })).recording;
        const report = JSON.parse(fs.readFileSync(path.join(capture.directory, "game/script-output/clock-cold-start.json"), "utf8")) as Report;
        // a cold cell, the clock a tick behind the probe, and the recording from the tick after the placement
        expect(recording.start_game_tick).toBe(report.placement_tick + 1);
        expect(report.clock_offsets).toEqual([0]);
        expect(recording.inserters.filter((it: any) => it.source.type === "machine" || it.sink.type === "machine")
            .every((it: any) => it.samples.held_count[0] === 0)).toBe(true);
        for (const machine of recording.machines) {
            expect(machine.samples.products_finished[0]).toBe(0);
            expect(Math.max(...machine.samples.products_finished), "the cell makes its product").toBeGreaterThan(0);
        }
        for (const lanes of Object.values(report.periods)) for (const [lane, record] of lanes.entries()) {
            expect(record.off_lattice, `lane ${lane + 1} off the lattice`).toBe(0);
            if (run.native_phases) expect(Object.keys(record.phases).map(Number), `lane ${lane + 1} phase`).toEqual([run.native_phases[lane]]);
        }
        if (run.native_phases) expect(report.phases).toEqual(run.native_phases);
        const held = (inserter: any) => inserter.samples.held_count.slice(controls.frame_offset, ticks) as number[];
        const output = held(recording.inserters.find((it: any) => it.source.type === "machine"));
        const input = held(recording.inserters.find((it: any) => it.sink.type === "machine"));
        const perPeriod = (series: number[], sign: 1 | -1) => Array.from({length: controls.periods}, (_, k) =>
            series.slice(k * P, (k + 1) * P).reduce((sum, count, t) => sum + Math.max(0, sign * (count - (series[k * P + t - 1] ?? 0))), 0));
        expect(perPeriod(output, -1)).toEqual(run.output);
        expect(perPeriod(input, 1)).toEqual(run.pickups);
        expect(sha(output)).toBe(run.output_held_sha256);
        expect(sha(input)).toBe(run.input_held_sha256);
    } finally {capture.cleanup();}
}, 1_560_000);
