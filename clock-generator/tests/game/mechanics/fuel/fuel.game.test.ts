import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";
import {expect, test} from "vitest";
import {FactorioBlueprintFile} from "../../../../src/blueprints/blueprint";
import {encodeBlueprintFile} from "../../../../src/blueprints/serde";
import {recordInFactorio} from "../../../../src/harness/factorio-harness";
import {composeProbeSource} from "../../helpers/probe-source";
import {ledger} from "./checks";
import {FUEL_RUNS} from "./cases";
import {parseRecording, rowsOf} from "./recording";

/**
 * Burner machines and drills, many to a game run, logged every tick (probe.lua). Each run's recording is written to
 * FUEL_CAPTURE_DIR/<run>.json when it is named; recordings/ holds the ones the offline checks (recordings.test.ts) read.
 * See README.md.
 */
for (const run of FUEL_RUNS) test(`burners: ${run.name}`, async context => {
    const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
    context.skip(!factorio || !save || !fs.existsSync(save), "Factorio harness is not configured");
    const retained = process.env.FUEL_CAPTURE_DIR;
    const scratch = retained ? path.resolve(retained, run.name) : fs.mkdtempSync(path.join(os.tmpdir(), "fuel-"));
    if (retained && fs.existsSync(scratch) && fs.readdirSync(scratch).length) throw new Error("Choose a new empty FUEL_CAPTURE_DIR");
    fs.mkdirSync(scratch, {recursive: true});
    try {
        // the recorder starts only with a machine or an inserter in the build: an idle assembler away from the burners
        const blueprint = encodeBlueprintFile({blueprint: {item: "blueprint", label: `Burners ${run.name}`, version: 562949955649536,
            entities: [{entity_number: 1, name: "assembling-machine-1", position: {x: 0.5, y: 0.5}, recipe: "rail"}]}} as unknown as FactorioBlueprintFile);
        const lua = composeProbeSource(path.join(__dirname, "probe.lua"),
            {scenarios: run.scenarios, ticks: run.ticks, productivity: run.productivity ?? false, ...(run.force && {force: run.force})});
        await recordInFactorio({factorio: factorio!, save: save!, blueprint, lua, out: path.join(scratch, "recording.json"),
            work_dir: path.join(scratch, "game"), ticks: run.ticks + 30, warmup_ticks: 1, settle_ticks: 0, seed: [], unclocked: true,
            game_speed: 1000, watch: false, timeout_seconds: 900, log() {}});
        const output = path.join(scratch, "game/script-output/fuel-probe.json");
        expect(fs.existsSync(output), "the probe wrote its log").toBe(true);
        // every machine's every tick follows the buffer and top-up rule (recordings.test.ts asserts the rest on the retained logs)
        const recording = parseRecording(fs.readFileSync(output, "utf8"));
        expect(recording.info.energy_gap, "the entity's energy is its burner's heat").toBe(0);
        for (const scenario of recording.info.scenarios) {
            expect(ledger(rowsOf(recording, scenario.name), scenario.energy_usage, scenario.heat_capacity, scenario.fuel_value), scenario.name).toEqual([]);
        }
        if (retained) {
            fs.copyFileSync(output, path.join(scratch, `${run.name}.json`));
            fs.writeFileSync(path.join(scratch, `${run.name}.json.gz`), zlib.gzipSync(fs.readFileSync(output), {level: 9}));
        }
    } finally {if (!retained) fs.rmSync(scratch, {recursive: true, force: true});}
}, 1_000_000);
