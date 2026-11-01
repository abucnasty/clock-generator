import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {expect, test} from "vitest";
import {recordInFactorio} from "../../../../src/harness/factorio-harness";
import {GameFixturePaths} from "../../helpers/fixture-paths";
import {composeProbeSource} from "../../helpers/probe-source";

// This ordinary game test checks visible outcomes independently of the stored operation observations.
test("Mechanics: destination gates with one stack versus singleton source slots", async context => {
    const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
    context.skip(!factorio || !save || !fs.existsSync(save), "Factorio harness is not configured");
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "source-search-"));
    try {
        const folder = GameFixturePaths.SOURCE_SEARCH;
        await recordInFactorio({factorio: factorio!, save: save!, blueprint: fs.readFileSync(path.join(folder, "scaffold.txt"), "utf8"),
            lua: composeProbeSource(path.join(folder, "probe.lua")), out: path.join(scratch, "recording.json"),
            work_dir: path.join(scratch, "game"), ticks: 32, warmup_ticks: 0, settle_ticks: 32, seed: [], unclocked: true,
            game_speed: 1000, watch: false, timeout_seconds: 240, log() {}});
        const report = JSON.parse(fs.readFileSync(path.join(scratch, "game/script-output/visible.json"), "utf8"));
        expect(report.samples).toHaveLength(24);
        expect(report.initial.map((c: {filled_output: number}) => c.filled_output)).toEqual([50,50,0,0,0,0]);
        const row = report.samples.find((r: {tick: number}) => r.tick === 5);
        expect(Array.from({length: 6}, (_, i) => row.entities.find((e: {unit: number}) => e.unit === report.roles[`hand_${i+1}`]).held))
            .toEqual([0,0,0,0,16,16]);
        const last = report.samples.at(-1);
        expect(Array.from({length: 6}, (_, i) => last.entities.find((e: {unit: number}) => e.unit === report.roles[`source_${i+1}`]).inventory
            .reduce((sum: number, slot: {count: number}) => sum + slot.count, 0))).toEqual([48,48,48,48,32,32]);
    } finally {fs.rmSync(scratch, {recursive: true, force: true});}
}, 300_000);
