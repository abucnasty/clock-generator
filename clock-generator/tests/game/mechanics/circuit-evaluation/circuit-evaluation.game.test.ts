import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {expect, test} from "vitest";
import {recordInFactorio} from "../../../../src/harness/factorio-harness";
import {GameFixturePaths} from "../../helpers/fixture-paths";
import {composeProbeSource} from "../../helpers/probe-source";

// Equal visible outputs do not establish equal condition-check counts; those observations are separate.
test("Mechanics: equal circuit outputs and a real full hand carried over clock edges", async context => {
    const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
    context.skip(!factorio || !save || !fs.existsSync(save), "Factorio harness is not configured");
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "circuit-evaluation-"));
    try {
        const folder = GameFixturePaths.CIRCUIT_EVALUATION;
        await recordInFactorio({factorio: factorio!, save: save!, blueprint: fs.readFileSync(path.join(folder, "scaffold.scaffold"), "utf8"),
            lua: composeProbeSource(path.join(folder, "probe.lua"), {layout: JSON.parse(fs.readFileSync(path.join(folder, "layout.json"), "utf8"))}),
            out: path.join(scratch, "recording.json"), work_dir: path.join(scratch, "game"), ticks: 32,
            warmup_ticks: 0, settle_ticks: 32, seed: [], unclocked: true, game_speed: 1000, watch: false, timeout_seconds: 240, log() {}});
        const report = JSON.parse(fs.readFileSync(path.join(scratch, "game/script-output/visible.json"), "utf8"));
        expect(report.error).toBeUndefined();
        expect(report.samples).toHaveLength(24);
        expect(report.interventions).toEqual([{tick: 1, name: "fill_destination_after_real16_pickup_and_connect_period8_clock", inserted: 4800}]);
        const rows = report.samples.filter((r: {tick: number}) => r.tick >= 5);
        for (const row of rows) {
            expect(row.hand.held).toBe(16);
            expect(row.sink_count).toBe(4800);
            for (const kind of ["arithmetic_zero", "simple_true", "and_true", "and_false_first", "and_false_last", "or_true_first", "or_true_last"]) {
                const control = (role: string) => row.controls.find((c: {role: string}) => c.role === role);
                expect(control(`fixed_${kind}`).output).toEqual(control(`changing_${kind}`).output);
            }
        }
        expect(new Set(rows.map((r: {hand: {disabled: boolean}}) => r.hand.disabled))).toEqual(new Set([true, false]));
        expect(new Set(rows.map((r: {counter: number}) => r.counter))).toEqual(new Set([0,1,2,3,4,5,6,7]));
    } finally {fs.rmSync(scratch, {recursive: true, force: true});}
}, 300_000);
