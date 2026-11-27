import { rateDecimal } from "../../../src/config/setpoint-rate";
import fs from "fs";
import os from "os";
import path from "path";
import {expect, test} from "vitest";
import {encodeBlueprintFile} from "../../../src/blueprints/serde";
import {ConfigPaths} from "../../../src/config/config-paths";
import {loadConfigFromFile} from "../../../src/config/loader";
import {withUnstatedLaneEnds} from "../../../src/entities/traits/lane-ends";
import {generateClockAlternatives} from "../../../src/crafting/generate-blueprint";
import {recordInFactorio} from "../../../src/harness/factorio-harness";
import {recipesMaking} from "../../../src/harness/recording-output";
import {composeProbeSource} from "../helpers/probe-source";
import {clockHash} from "./clock-controls";
import {runSummary} from "./pickup-clock-capture";
import {scaffoldClockPins} from "./scaffold-recordings-clock-pins";

/**
 * The selected clock of UTILITY_SCIENCE_120 (Takt Batches, 3 output swings each output cycle, a window cycle of 672 ticks) on the
 * sample's scaffold of one copy, as the config is and with its belts backed up, recorded from the staged start under the game
 * tests' protocol: steady state, a baseline of whole window cycles that takes the run past 21,600 ticks, then the loss the
 * generator's disturbance trial says breaks the clock (low density structure stops arriving), until the output falls and after its
 * release. The simulator's verdict for the clock is "no recovery": the game differs on this scaffold, where the clock holds its rate
 * and the output comes back after the loss. The scaffold holds one copy, so the join of the copies that share a lane (the trial's
 * "on the copies that share a lane") is not in it. On the seven-copy scaffold the game agrees with the simulator's "no recovery"
 * (copy 7 stayed at 0 for 45 window cycles after the same stop, the build's known deadlock risk), so the one-copy difference comes from
 * the one-copy scaffold having no shared lane. The test records and judges; it asserts the baseline and keeps the verdict.
 */
const quiet = {log() {}, info() {}, warn() {}, error() {}, debug() {}};
const PIN = "utility science";
const WINDOW = 3600;
/** Window cycles of 672 ticks: 21 of them are 14,112 ticks, which with a steady state at about 7,200 takes the run past 21,600 */
const BASELINE = 14_400;
const CAP = 36_000;
/** Ticks from the first drop of the output: the loss lasts until the build has stopped, and the recovery of the other recordings takes about 4,200 after the release */
const RECOVER_BOUND = 14_000;

for (const backed of [false, true]) {
    const name = backed ? "backed-up" : "as-is";
    test(`utility science 120, selected clock from the staged start: ${name}`, async context => {
        const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
        context.skip(!factorio || !save || !fs.existsSync(save), "Factorio harness is not configured");
        const kept = process.env.UTILITY_120_CAPTURE_DIR;
        const directory = path.join(kept ? path.resolve(kept) : fs.mkdtempSync(path.join(os.tmpdir(), "utility-science-120-")), name);
        fs.mkdirSync(directory, {recursive: true});
        const loaded = await loadConfigFromFile(ConfigPaths.UTILITY_SCIENCE_120);
        const config = backed ? withUnstatedLaneEnds(loaded, "dead_end") : loaded;
        const generated = generateClockAlternatives(config, {logger: quiet});
        const selected = generated.alternatives[generated.selected_index];
        const exported = selected.result.subtick ?? selected.result;
        const period = selected.result.subtick?.clock.window_cycle_ticks ?? selected.result.simulation_duration.ticks;
        expect(clockHash(exported), "the selected clock is the one pinned").toBe(scaffoldClockPins[PIN].clock_sha256);
        // the scaffold holds one of the config's seven copies: 17.14 a second
        const target = rateDecimal(config.setpoint.items_per_second) / config.setpoint.copies;
        const recipes = [...recipesMaking(config, config.setpoint.item)];
        const blueprint = fs.readFileSync(path.join(path.dirname(ConfigPaths.UTILITY_SCIENCE_120), "utility-120.scaffold"), "utf8").trim();
        const probe = composeProbeSource(path.join(__dirname, "utility-science-120-selected-clock-probe.lua"), {
            window: WINDOW, expected: Math.round(target * WINDOW / 60 * 1e6) / 1e6, baseline: BASELINE, cap: CAP, recover_bound: RECOVER_BOUND, period,
            recipes, item: config.setpoint.item, ticks: CAP,
        });
        const {recording} = await recordInFactorio({
            factorio: factorio!, save: save!, config, blueprint,
            clock: {blueprint: encodeBlueprintFile({blueprint: exported.blueprint}), schedule: exported.schedule},
            out: path.join(directory, "recording.json"), work_dir: path.join(directory, "game"),
            ticks: CAP, warmup_ticks: 0, staged_start: {}, seed: [], unclocked: false, game_speed: 1000, watch: false, timeout_seconds: 1500,
            log() {}, lua: probe,
        }) as any;
        const report = JSON.parse(fs.readFileSync(path.join(directory, "game", "script-output", "clock-speed.json"), "utf8"));
        const run = report.protocol;
        expect(run.error, "the probe failed in the game").toBeUndefined();
        expect(run.result, "the run did not end before the recording").toBeDefined();
        const summary = runSummary(run, {generationVerdict: selected.verdict, target: Math.round(target * 1e6) / 1e6, period}, target);
        // the output of each whole window cycle after the steady state, net of the output stock: products less what the stock gained
        const cycles: {t: number; net: number}[] = [];
        let before: {t: number; items: number} | undefined;
        for (const row of run.series.cycles as {t: number; p: number[]; s: number[] | null}[]) {
            const items = row.p.reduce((sum, finished, k) => sum + finished * run.finals[k].worth, 0) - (row.s ?? []).reduce((sum, count) => sum + count, 0);
            if (before) cycles.push({t: row.t, net: items - before.items});
            before = {t: row.t, items};
        }
        const expectedCycle = target * period / 60;
        const loss = summary.disturbances[0];
        const lossAt = loss?.start ?? run.ended;
        const judged = cycles.filter(cycle => cycle.t <= lossAt);
        const short = judged.filter(cycle => cycle.net < expectedCycle - 1e-6);
        const verdict = {
            case: name, clock: clockHash(exported), result: summary.result, steady: summary.steady, ticks_before_the_loss: lossAt,
            baseline: summary.baseline, loss: loss ?? null, expected_per_window_cycle: expectedCycle,
            window_cycles_before_the_loss: judged.length, window_cycles_short: short.map(cycle => cycle.net),
            holds_before_the_loss: summary.baseline?.meets === true && short.length === 0,
            after_the_loss: loss?.recovered !== undefined ? "recovers" : "stays short",
        };
        fs.writeFileSync(path.join(directory, "summary.json"), JSON.stringify(summary) + "\n");
        fs.writeFileSync(path.join(directory, "verdict.json"), JSON.stringify(verdict, null, 1) + "\n");
        expect(recording.inserters.length).toBeGreaterThan(0);
        expect(summary.steady, "steady state").not.toBeNull();
        expect(summary.baseline?.meets, "the baseline makes the target over its whole window cycles").toBe(true);
    }, 1_800_000);
}
