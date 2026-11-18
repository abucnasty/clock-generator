import fs from "fs";
import path from "path";
import {describe, expect, test} from "vitest";
import {encodeBlueprintFile} from "../../../src/blueprints/serde";
import {ConfigPaths} from "../../../src/config/config-paths";
import {loadConfigFromFile} from "../../../src/config/loader";
import {generateClockAlternatives} from "../../../src/crafting/generate-blueprint";
import {recordInFactorio} from "../../../src/harness/factorio-harness";
import {recipesMaking} from "../../../src/harness/recording-output";
import {matchCopies} from "../../../src/verification/entity-copies";
import {composeProbeSource} from "../helpers/probe-source";
import {clockHash, expectedNativeSummary, readRecordJob} from "./clock-controls";
import {CONTROLS_FILE, MISSING_RECORDING_CASES, scaffoldFile} from "./missing-recordings-clock-fixtures";
import {RUN_PROTOCOL, runSummary} from "./pickup-clock-capture";

/**
 * The selected clock of a record job on the sample's scaffold, recorded from the staged start under the game tests' protocol
 * (helpers/lua/steady.lua): steady state, a baseline of whole clock cycles, then each loss of the case until the output falls below the
 * baseline's lowest minute, released, and recovered. A build of copies is judged on each copy by itself: its whole clock cycles from
 * steady state to the first loss, and the whole clock cycles of at least a minute that end where each loss is recovered. The test records
 * and judges; it keeps the run, the verdict and the controls entry in MISSING_RECORDINGS_CAPTURE_DIR, and asserts that the run ended and
 * that the recording is of the clock the record selects. Whether the clock held is the verdict's; the controls file keeps the ones that did.
 */
const quiet = {log() {}, info() {}, warn() {}, error() {}, debug() {}};
/** Ticks the run goes on after its last loss is recovered (or after it fails), and of them the last minute judged, whole clock cycles of it */
const TAIL_TICKS = 7200;
const RECOVERY_CYCLES_TICKS = 3600;
/** A late recording (the case's `late_recording`) holds the minute after the run, for the build's hardware and its copies */
const LATE_RECORDING_TICKS = 3600;

type Row = {t: number; p: number[]; s?: number[]};

describe.sequential("the selected clock of a record job from the staged start, with its losses", () => {
    for (const item of MISSING_RECORDING_CASES) {
        test(`${item.name}: ${item.job}`, async context => {
            const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
            context.skip(!factorio || !save || !fs.existsSync(save), "Factorio harness is not configured");
            context.skip(item.no_staged_start !== undefined && process.env.MISSING_RECORDINGS_TRY_ALL !== "1", item.no_staged_start);
            const kept = process.env.MISSING_RECORDINGS_CAPTURE_DIR;
            expect(kept, "MISSING_RECORDINGS_CAPTURE_DIR names the folder the run is kept in").toBeTruthy();
            const directory = path.join(path.resolve(kept!), item.name);
            fs.mkdirSync(directory, {recursive: true});

            const loaded = await loadConfigFromFile(ConfigPaths[item.config]);
            const config = item.variant ? item.variant(loaded) : loaded;
            const generated = generateClockAlternatives(config, {logger: quiet});
            const selected = generated.alternatives[generated.selected_index];
            const exported = selected.result.subtick ?? selected.result;
            const period = selected.result.subtick?.clock.window_cycle_ticks ?? selected.result.simulation_duration.ticks;
            const made = readRecordJob(item.job)!;
            const base = made.alternatives.find(alternative => alternative.id === made.selected)!;
            expect(clockHash(exported), `the selected clock (${selected.id}) is the one the record selects for ${item.job}`).toBe(base.clock_sha256);

            const jobCopies = config.setpoint.copies ?? 1;
            const perCopy = config.setpoint.items_per_second / jobCopies;
            const target = perCopy * item.copies;
            const recipes = [...recipesMaking(config, config.setpoint.recipe)];
            const finalsPerCopy = config.machines.filter(machine => recipes.includes(machine.recipe)).length;
            const tailTicks = item.tail_ticks ?? TAIL_TICKS;
            const blueprint = fs.readFileSync(scaffoldFile(item), "utf8").trim();
            const probe = composeProbeSource(path.join(__dirname, "missing-recordings-clock-probe.lua"), {
                window: RUN_PROTOCOL.window, expected: Math.round(target * RUN_PROTOCOL.window / 60 * 1e6) / 1e6, baseline: item.baseline?.ticks ?? RUN_PROTOCOL.baseline,
                cap: RUN_PROTOCOL.cap, recipes, item: config.setpoint.recipe, ticks: RUN_PROTOCOL.cap + tailTicks, losses: item.losses, tail: tailTicks,
                finals: finalsPerCopy * item.copies, late: item.late_recording !== undefined,
            });
            const {recording} = await recordInFactorio({
                factorio: factorio!, save: save!, config, blueprint,
                clock: {blueprint: encodeBlueprintFile({blueprint: exported.blueprint}), schedule: exported.schedule},
                copies: item.copies > 1 ? item.copies : undefined,
                out: path.join(directory, "recording.json"), work_dir: path.join(directory, "game"),
                ...(item.late_recording === undefined ? {ticks: RUN_PROTOCOL.cap + tailTicks} : {ticks: LATE_RECORDING_TICKS, settle_ticks: RUN_PROTOCOL.cap + tailTicks + 1}),
                warmup_ticks: 0, staged_start: {}, seed: [], unclocked: false, game_speed: 1000, watch: false, timeout_seconds: 3000,
                log() {}, lua: probe,
            }) as any;
            const report = JSON.parse(fs.readFileSync(path.join(directory, "game", "script-output", "clock-speed.json"), "utf8"));
            const run = report.protocol;
            expect(run.error, "the probe failed in the game").toBeUndefined();
            expect(run.result, "the run did not end before the recording").toBeDefined();
            expect(Array.isArray(run.finals) ? run.finals : [], "the final machines the probe counts").toHaveLength(finalsPerCopy * item.copies);

            const summary = runSummary(run, {generationVerdict: selected.verdict, target: Math.round(target * 1e6) / 1e6, period}, target);
            fs.writeFileSync(path.join(directory, "summary.json"), JSON.stringify(summary) + "\n");
            // the run of the pinned clock is the one the controls file keeps (BELT_CLOCK_CALIBRATE=1 records a new one)
            if (process.env.BELT_CLOCK_CALIBRATE !== "1") {
                const kept = expectedNativeSummary(path.join(__dirname, CONTROLS_FILE), item.name);
                if (kept) expect(summary, `the run is the one ${CONTROLS_FILE} keeps for ${item.name}`).toEqual(kept);
            }

            // each copy by itself: its final machines, found as the harness finds the copies
            const finals = run.finals as {unit_number: number; worth: number}[];
            const rows = (run.series.cycles as Row[]).filter(row => row.t >= run.steady);
            const unitOf = new Map<number, number | undefined>(recording.machines.map((machine: any) => [machine.id, machine.unit_number]));
            const found = item.copies > 1 ? matchCopies(recording, config).copies : [];
            let members: number[][];
            if (item.copies === 1 || found.length === item.copies) {
                members = found.map(match => {
                    const units = new Set(Array.from(match.machines.keys()).map(id => unitOf.get(id)));
                    return finals.flatMap((final, k) => units.has(final.unit_number) ? [k] : []);
                });
            } else {
                // a staged recording starts before every machine has its recipe (the recyclers), so the recording cannot be matched to the
                // config: the copies stand side by side along x, and each is the next `finalsPerCopy` final machines from the west
                const where = report.final_positions as Record<string, {x: number; y: number}>;
                const order = finals.map((final, k) => k).sort((a, b) => where[finals[a].unit_number].x - where[finals[b].unit_number].x);
                members = Array.from({length: item.copies}, (_, copy) => order.slice(copy * finalsPerCopy, (copy + 1) * finalsPerCopy));
            }
            expect(members.length, `the scaffold holds ${item.copies} copies`).toBe(item.copies > 1 ? item.copies : 0);
            if (item.copies === 1) members.push(finals.map((_, k) => k));
            const net = (indices: number[], from: Row, to: Row) => indices.reduce((sum, k) => sum + (to.p[k] - from.p[k]) * finals[k].worth - ((to.s?.[k] ?? 0) - (from.s?.[k] ?? 0)), 0);
            const firstLoss = (run.disturbances as {start: number}[])[0]?.start ?? run.ended;
            const judgedFrom = Math.max(run.steady, Math.floor(firstLoss / 3));
            const perCopyVerdict = members.map((indices, index) => {
                const expectedPerTick = perCopy / 60;
                const cycles: {t: number; ticks: number; net: number; expected: number}[] = [];
                for (let i = 1; i < rows.length && rows[i].t <= firstLoss; i++) {
                    if (rows[i - 1].t < judgedFrom) continue;
                    const ticks = rows[i].t - rows[i - 1].t;
                    cycles.push({t: rows[i - 1].t, ticks, net: net(indices, rows[i - 1], rows[i]), expected: expectedPerTick * ticks});
                }
                const short = cycles.filter(cycle => cycle.net < cycle.expected - 1e-6);
                // after the losses: the whole clock cycles of the last minute of the tail (the run goes on TAIL_TICKS after its last
                // loss is recovered, or after it fails)
                const tailRows = (report.tail?.rows ?? []) as Row[];
                const tailEnd = tailRows.length > 0 ? tailRows[tailRows.length - 1].t : 0;
                // the whole clock cycles of at least a minute: a clock cycle longer than a minute is judged as the one cycle that ends the run
                const lastMinute = tailRows.filter(row => row.t >= tailEnd - RECOVERY_CYCLES_TICKS);
                const judgedTail = lastMinute.length >= 2 ? lastMinute : tailRows.slice(-2);
                const after: {t: number; ticks: number; net: number; expected: number}[] = [];
                for (let i = 1; i < judgedTail.length; i++) {
                    const ticks = judgedTail[i].t - judgedTail[i - 1].t;
                    after.push({t: judgedTail[i - 1].t, ticks, net: net(indices, judgedTail[i - 1], judgedTail[i]), expected: expectedPerTick * ticks});
                }
                const afterShort = after.filter(cycle => cycle.net < cycle.expected - 1e-6);
                const total = (list: {net: number; expected: number}[]) => ({net: list.reduce((sum, it) => sum + it.net, 0), expected: list.reduce((sum, it) => sum + it.expected, 0)});
                return {copy: index + 1, final_machines: indices.length, window_cycles_judged: cycles.length, window_cycles_short: short, total: total(cycles),
                    window_cycles_after_the_losses: after.length, window_cycles_short_after_the_losses: afterShort, total_after_the_losses: total(after)};
            });
            const verdict = {
                case: item.name, job: item.job, final: report.final, clock: clockHash(exported), generation_verdict: selected.verdict, game_version: report.game_version ?? null,
                result: summary.result, steady: summary.steady, baseline: summary.baseline, disturbances: summary.disturbances, stock: summary.stock,
                copies_built: item.copies, copies_of_job: jobCopies, limit: item.limit ?? null, judged_from_tick: judgedFrom, first_loss: firstLoss,
                per_copy: perCopyVerdict,
                holds: summary.result === "holds" && summary.baseline?.meets === true && (summary.stock === null || summary.stock.holds)
                    && perCopyVerdict.every(copy => copy.window_cycles_after_the_losses > 0
                        // a build whose output is random (what a recycler gives back) is judged on each copy's whole stretch, its window cycles vary
                        && (item.random_output !== undefined
                            ? copy.total.net >= copy.total.expected - 1e-6 && copy.total_after_the_losses.net >= copy.total_after_the_losses.expected - 1e-6
                            : copy.window_cycles_short.length === 0 && copy.window_cycles_short_after_the_losses.length === 0)),
                random_output: item.random_output ?? null,
            };
            fs.writeFileSync(path.join(directory, "verdict.json"), JSON.stringify(verdict, null, 1) + "\n");
            fs.writeFileSync(path.join(directory, "controls-entry.json"), JSON.stringify({
                recorded: {pr: 0, commit: null, frozen_head: null, clock_sha256: clockHash(exported), clock_basis: "capture"},
                native: summary,
                generation: {period, expected: Math.round(target * period / 60 * 1e3) / 1e3, verdict: selected.verdict,
                    selection: {id: selected.id, holds: selected.assessment.holds, rate: selected.assessment.items_per_second, supply: selected.belt?.kind ?? null},
                    clock_sha256: clockHash(exported)},
            }, null, 1) + "\n");
            expect(recording.inserters.length).toBeGreaterThan(0);
            expect(summary.steady, "steady state").not.toBeNull();
        }, 3_600_000);
    }
});
