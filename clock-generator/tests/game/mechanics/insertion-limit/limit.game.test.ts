import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";
import {expect, test} from "vitest";
import {FactorioBlueprintFile} from "../../../../src/blueprints/blueprint";
import {encodeBlueprintFile} from "../../../../src/blueprints/serde";
import {recordInFactorio} from "../../../../src/harness/factorio-harness";
import {composeProbeSource} from "../../helpers/probe-source";
import {LIMIT_RUNS} from "./cases";
import {parseRecording} from "./recording";

/**
 * Inserters dropping into machines that cannot craft, from a chosen stock (probe.lua). Each run's recording is written to
 * LIMIT_CAPTURE_DIR/<run>.json.gz when it is named; recordings/ holds the ones the offline checks (recordings.test.ts) read.
 * See README.md.
 */
for (const run of LIMIT_RUNS) test(`insertion limit: ${run.name}`, async context => {
    const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
    context.skip(!factorio || !save || !fs.existsSync(save), "Factorio harness is not configured");
    const retained = process.env.LIMIT_CAPTURE_DIR;
    const scratch = retained ? path.resolve(retained, run.name) : fs.mkdtempSync(path.join(os.tmpdir(), "limit-"));
    if (retained && fs.existsSync(scratch) && fs.readdirSync(scratch).length) throw new Error("Choose a new empty LIMIT_CAPTURE_DIR");
    fs.mkdirSync(scratch, {recursive: true});
    const max_ticks = 30000;
    try {
        // the recorder starts only with a machine or an inserter in the build: an idle assembler away from the machines
        const blueprint = encodeBlueprintFile({blueprint: {item: "blueprint", label: `Insertion limit ${run.name}`, version: 562949955649536,
            entities: [{entity_number: 1, name: "assembling-machine-1", position: {x: 0.5, y: 0.5}, recipe: "rail"}]}} as unknown as FactorioBlueprintFile);
        const lua = composeProbeSource(path.join(__dirname, "probe.lua"),
            {scenarios: run.scenarios, max_ticks, timeout: 90, ...(run.force && {force: run.force})});
        await recordInFactorio({factorio: factorio!, save: save!, blueprint, lua, out: path.join(scratch, "recording.json"),
            work_dir: path.join(scratch, "game"), ticks: max_ticks + 30, warmup_ticks: 1, settle_ticks: 0, seed: [], unclocked: true,
            game_speed: 1000, watch: false, timeout_seconds: 1800, log() {}});
        const output = path.join(scratch, "game/script-output/insertion-limit.json");
        expect(fs.existsSync(output), "the probe wrote its log").toBe(true);
        const recording = parseRecording(fs.readFileSync(output, "utf8"));
        expect(recording.finished, "every trial ran before the tick limit").toBe(true);
        for (const scenario of run.scenarios) {
            expect(recording.trials[scenario.name].length, scenario.name).toBe(scenario.hands.length * (scenario.stocks.length + (scenario.bumps?.length ?? 0)));
        }
        if (retained) fs.writeFileSync(path.join(scratch, `${run.name}.json.gz`), zlib.gzipSync(fs.readFileSync(output), {level: 9}));
    } finally {if (!retained) fs.rmSync(scratch, {recursive: true, force: true});}
}, 2_000_000);
