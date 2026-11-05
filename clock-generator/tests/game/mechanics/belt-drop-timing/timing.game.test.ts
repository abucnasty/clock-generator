import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";
import {expect, test} from "vitest";
import {FactorioBlueprintFile} from "../../../../src/blueprints/blueprint";
import {encodeBlueprintFile} from "../../../../src/blueprints/serde";
import {recordInFactorio} from "../../../../src/harness/factorio-harness";
import {composeProbeSource} from "../../helpers/probe-source";
import {ALL_RUNS} from "./cases";
import {loadRecording, parseRecording, RECORDINGS_DIR} from "./recording";
import {runFigures} from "./summary";

/**
 * Inserters dropping full hands onto turbo lines, logged every tick (probe.lua). Each run's recording is written to
 * DROP_TIMING_CAPTURE_DIR/<run>/<run>.json.gz when that is named; recordings/ holds the ones the offline checks
 * (recordings.test.ts) read, and a fresh run must give the figures of the one kept there. DROP_TIMING_RUNS names the runs to make
 * (comma separated; default all). See README.md.
 */
const wanted = process.env.DROP_TIMING_RUNS?.split(",");
for (const run of ALL_RUNS.filter(run => !wanted || wanted.includes(run.name))) test(`belt drop timing: ${run.name}`, async context => {
    const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
    context.skip(!factorio || !save || !fs.existsSync(save), "Factorio harness is not configured");
    const retained = process.env.DROP_TIMING_CAPTURE_DIR;
    const scratch = retained ? path.resolve(retained, run.name) : fs.mkdtempSync(path.join(os.tmpdir(), "belt-drop-timing-"));
    if (retained && fs.existsSync(scratch) && fs.readdirSync(scratch).length) throw new Error("Choose a new empty DROP_TIMING_CAPTURE_DIR");
    fs.mkdirSync(scratch, {recursive: true});
    try {
        // the recorder starts only with a machine or an inserter in the build: an idle assembler away from the lines
        const blueprint = encodeBlueprintFile({blueprint: {item: "blueprint", label: `Belt drop timing ${run.name}`, version: 562949955649536,
            entities: [{entity_number: 1, name: "assembling-machine-1", position: {x: 0.5, y: 0.5}, recipe: "rail"}]}} as unknown as FactorioBlueprintFile);
        const lua = composeProbeSource(path.join(__dirname, "probe.lua"),
            {scenarios: run.scenarios, ticks: run.ticks, go: run.go, ...(run.force && {force: run.force})});
        await recordInFactorio({factorio: factorio!, save: save!, blueprint, lua, out: path.join(scratch, "recording.json"),
            work_dir: path.join(scratch, "game"), ticks: run.go + run.ticks + 30, warmup_ticks: 1, settle_ticks: 0, seed: [], unclocked: true,
            game_speed: 1000, watch: false, timeout_seconds: 900, log() {}});
        const output = path.join(scratch, "game/script-output/belt-drop-timing.json");
        expect(fs.existsSync(output), "the probe wrote its log").toBe(true);
        const recording = parseRecording(fs.readFileSync(output, "utf8"));
        expect(recording.info.research_unchanged).toBe(true);
        for (const scenario of run.scenarios) expect(recording.runs[scenario.name].length, scenario.name).toBe(run.ticks + 3);
        if (retained) fs.writeFileSync(path.join(scratch, `${run.name}.json.gz`), zlib.gzipSync(fs.readFileSync(output), {level: 9}));
        // the control: the game still gives, for every scenario, the ticks, sizes, lanes and landings of the recording kept in recordings/
        if (fs.existsSync(path.join(RECORDINGS_DIR, `${run.name}.json.gz`))) {
            expect(runFigures(recording), "figures of the retained recording").toEqual(runFigures(loadRecording(run.name)));
        }
    } finally {if (!retained) fs.rmSync(scratch, {recursive: true, force: true});}
}, 1_000_000);
