import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";
import {expect, test} from "vitest";
import {FactorioBlueprintFile} from "../../../../src/blueprints/blueprint";
import {encodeBlueprintFile} from "../../../../src/blueprints/serde";
import {recordInFactorio} from "../../../../src/harness/factorio-harness";
import {composeProbeSource} from "../../helpers/probe-source";
import {DRILL_RUNS} from "./cases";
import {parseRecording} from "./recording";

/**
 * Mining drills that stop, logged every tick with the status the game shows (probe.lua). Each run's recording is written to
 * DRILL_STATUS_CAPTURE_DIR/<run>/<run>.json.gz when it is named; recordings/ holds the ones the offline checks
 * (recordings.test.ts) read. See README.md.
 */
for (const run of DRILL_RUNS) test(`drill status: ${run.name}`, async context => {
    const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
    context.skip(!factorio || !save || !fs.existsSync(save), "Factorio harness is not configured");
    const retained = process.env.DRILL_STATUS_CAPTURE_DIR;
    const scratch = retained ? path.resolve(retained, run.name) : fs.mkdtempSync(path.join(os.tmpdir(), "drill-status-"));
    if (retained && fs.existsSync(scratch) && fs.readdirSync(scratch).length) throw new Error("Choose a new empty DRILL_STATUS_CAPTURE_DIR");
    fs.mkdirSync(scratch, {recursive: true});
    try {
        // the recorder starts only with a machine or an inserter in the build: an idle assembler away from the drills
        const blueprint = encodeBlueprintFile({blueprint: {item: "blueprint", label: `Drill status ${run.name}`, version: 562949955649536,
            entities: [{entity_number: 1, name: "assembling-machine-1", position: {x: 0.5, y: 0.5}, recipe: "rail"}]}} as unknown as FactorioBlueprintFile);
        const lua = composeProbeSource(path.join(__dirname, "probe.lua"), {scenarios: run.scenarios, ticks: run.ticks});
        await recordInFactorio({factorio: factorio!, save: save!, blueprint, lua, out: path.join(scratch, "recording.json"),
            work_dir: path.join(scratch, "game"), ticks: run.ticks + 30, warmup_ticks: 1, settle_ticks: 0, seed: [], unclocked: true,
            game_speed: 1000, watch: false, timeout_seconds: 900, log() {}});
        const output = path.join(scratch, "game/script-output/drill-status.json");
        expect(fs.existsSync(output), "the probe wrote its log").toBe(true);
        const recording = parseRecording(fs.readFileSync(output, "utf8"));
        for (const scenario of run.scenarios) expect(recording.runs[scenario.name].length, scenario.name).toBe(run.ticks + 1);
        if (retained) fs.writeFileSync(path.join(scratch, `${run.name}.json.gz`), zlib.gzipSync(fs.readFileSync(output), {level: 9}));
    } finally {if (!retained) fs.rmSync(scratch, {recursive: true, force: true});}
}, 1_000_000);
