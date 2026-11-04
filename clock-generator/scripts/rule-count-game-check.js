// node scripts/rule-count-game-check.js record <out folder> [--long <reason>]
//                                                              records a scaffolded sample twice in the game: unclocked, and
//                                                              on its selected clock (FACTORIO_PATH, FACTORIO_HARNESS_SAVE)
// node scripts/rule-count-game-check.js compare <out folder>   lays the rule count of both recordings against the simulator's
//
// The check of the rule count's simulator path against the game (round 0 of the real-save loop, the reviewer's change
// A): the same build, unclocked and clocked, counted the rule's way from recordings of the game and from the
// simulator's runs of its config, per group. SAMPLE names the sample (default ADVANCED_CIRCUIT: machine-to-machine
// inputs and outputs that take part hands). The first clock period of each recording is left out, as the scaffold
// tests leave it out. Run the game under the harness lock, one at a time. Needs `npx tsc` first.
//
// A run is timed in game ticks, as the game tests are (scripts/game-run.js): after the warm-up a build runs until its final
// machines have made the target amount over the trailing minute, which is printed (for the unclocked build it only says how
// that build runs), and then each recording holds at least TICKS=<n> ticks (3,600 by default; the clocked one in whole clock
// periods, the unclocked one as many ticks as the clocked one). A request over 36,000 ticks, or a clocked recording that would
// be, is refused unless `--long <reason>` (or LONG_RUN=<reason>) says why; the reason is printed.
const fs = require("fs");
const path = require("path");
const { dist, quiet } = require("./lib");
const { GAME_RUN, takeLongReason, assertWithinRun, steadyProbeSource, readSteadyReport, describeRun } = require("./game-run");

const SAMPLE = process.env.SAMPLE ?? "ADVANCED_CIRCUIT";
const SCAFFOLDS = {
    ADVANCED_CIRCUIT: { scaffold: "intermediates/advanced-circuit/advanced-circuit-scaffold.txt", warmup: 3600 },
    AUTOMATION_SCIENCE: { scaffold: "science/automation-science/automation-science-scaffold.txt", warmup: 300 },
    ACCUMULATOR_640: { scaffold: "intermediates/accumulator/accumulator-640-scaffold.txt", warmup: 3600 },
    LOW_DENSITY_STRUCTURE: { scaffold: "intermediates/low-density-structure/low-density-structure-scaffold.txt", warmup: 3600 },
    // the egg loop cannot start itself, so the egg machines are given eggs to begin with, as the game tests do
    AGRICULTURAL_SCIENCE: {
        scaffold: "science/agriculture-science/agriculture-science-scaffold.txt", warmup: 300,
        seed: [{ target: { recipe: "pentapod-egg" }, item: "pentapod-egg", count: 200 }],
    },
};
const TICKS = Number(process.env.TICKS ?? GAME_RUN.baseline);

(async () => {
    const args = process.argv.slice(2);
    const long = takeLongReason(args);
    const [mode, out] = args;
    if (!["record", "compare"].includes(mode) || !out) {
        console.error("usage: node scripts/rule-count-game-check.js record|compare <out folder> [--long <reason>]");
        process.exit(2);
    }
    if (!Number.isInteger(TICKS) || TICKS <= 0) throw new Error(`TICKS is a whole number of ticks above 0, not ${process.env.TICKS}`);
    const { ConfigPaths } = dist("config/config-paths.js");
    const { loadConfigFromFile } = dist("config/loader.js");
    const { generateClockAlternatives } = dist("crafting/generate-blueprint.js");
    const config = await loadConfigFromFile(ConfigPaths[SAMPLE]);
    const generated = generateClockAlternatives(config, { logger: quiet });
    const selected = generated.alternatives[generated.selected_index];
    const period = selected.result.simulation_duration.ticks;
    fs.mkdirSync(out, { recursive: true });

    if (mode === "record") {
        const { recordInFactorio, recordedTicks } = dist("harness/factorio-harness.js");
        const { recipesMaking } = dist("harness/recording-output.js");
        const os = require("os");
        const { encodeBlueprintFile } = dist("blueprints/serde.js");
        const build = SCAFFOLDS[SAMPLE];
        const samples_dir = path.join(path.dirname(ConfigPaths[SAMPLE]), "..", "..");
        const blueprint = fs.readFileSync(path.join(samples_dir, build.scaffold), "utf8").trim();
        const exported = selected.result.subtick ?? selected.result;
        const clock = { blueprint: encodeBlueprintFile({ blueprint: exported.blueprint }), schedule: exported.schedule };
        // both recordings hold the same ticks: whole periods of the clock, from its next wrap, for the clocked one
        const clock_ticks = selected.result.subtick?.clock.period_ticks ?? period;
        const ticks = recordedTicks(TICKS, clock_ticks);
        assertWithinRun(TICKS, long, "TICKS");
        assertWithinRun(ticks, long, `the recording of whole periods of ${clock_ticks} ticks`);
        const target_per_second = selected.result.stability_check.expected_output_items * 60 / period;
        const recipes = recipesMaking(config, config.target_output.recipe);
        for (const unclocked of [true, false]) {
            const name = unclocked ? "unclocked" : "clocked";
            const started = Date.now();
            const work_dir = fs.mkdtempSync(path.join(os.tmpdir(), "rule-count-"));
            try {
                await recordInFactorio({
                    factorio: process.env.FACTORIO_PATH, save: process.env.FACTORIO_HARNESS_SAVE, blueprint,
                    out: path.join(out, `${SAMPLE}-${name}.json`), ticks: unclocked ? ticks : TICKS,
                    warmup_ticks: build.warmup, settle_ticks: GAME_RUN.cap + 1, seed: build.seed ?? [],
                    lua: steadyProbeSource(target_per_second, config.target_output.recipe, recipes, "rule-count-steady.json"), work_dir,
                    clock: unclocked ? undefined : clock, config: unclocked ? undefined : config, unclocked,
                    game_speed: 1000, timeout_seconds: 900, log: () => { }, cache: false,
                });
                const run = readSteadyReport(work_dir, "rule-count-steady.json");
                fs.writeFileSync(path.join(out, `${SAMPLE}-${name}.steady.json`), JSON.stringify(run) + "\n");
                console.log(`${name}: ${describeRun(run).lines.join("; ")}`);
            } finally {
                fs.rmSync(work_dir, { recursive: true, force: true });
            }
            console.log(`${name}: recorded in ${Math.round((Date.now() - started) / 1000)} s`);
        }
        return;
    }

    const { parseRecording } = dist("verification/recording.js");
    const { matchRecordingToConfig } = dist("verification/entity-matching.js");
    const { ruleCountInputOfRecording } = dist("verification/recording-rule-count.js");
    const { ruleCount } = dist("crafting/rule-count.js");
    const { removedBetween } = dist("crafting/rule-call.js");
    const { ruleCallsOfSample } = dist("crafting/rule-calls-of-sample.js");
    const windows = selected.result.clock_windows;
    const game = {};
    for (const name of ["unclocked", "clocked"]) {
        const recording = parseRecording(JSON.parse(fs.readFileSync(path.join(out, `${SAMPLE}-${name}.json`), "utf8")));
        const match = matchRecordingToConfig(recording, config);
        const input = ruleCountInputOfRecording(recording, id => name === "clocked" && (windows[id]?.length ?? 0) > 0, match);
        game[name] = ruleCount(input.inserters, input.machines, period, recording.sample_count);
    }
    const game_removal = removedBetween(game.unclocked, game.clocked);
    const game_original = removedBetween(game.unclocked, game.clocked, "original");
    const sim = ruleCallsOfSample(config, { alternatives: generated });
    const per = (run, key) => {
        const g = run.groups.find(x => x.key === key);
        const m = x => x / g.inserters / run.minutes;
        return g === undefined ? null : {
            n: g.inserters, w: m(g.true_wake_ups), src: m(g.source_wake_ups), dst: m(g.true_sink_wake_ups), pick: m(g.true_pickups),
            w_original: m(g.wake_ups),
        };
    };
    const f = x => x === null || x === undefined ? "-" : x.toFixed(1);
    const rows = [];
    const lines = [
        `${SAMPLE}: ${selected.label} (${selected.id}, ${selected.verdict}), period ${period}. Game: ${game.unclocked.ticks} and ${game.clocked.ticks} ticks counted; simulator ${sim.to_tick - sim.from_tick}.`,
        "",
        "w a minute for each inserter, in true starts (source / sink / pickup), and in the series' original count:",
        "",
        "| Group | Run | n | Game w (source / sink / pickup) | Simulator w (source / sink / pickup) | Difference | Game, original | Simulator, original |",
        "|---|---|---|---|---|---|---|---|",
    ];
    const keys = [...new Set([...game_removal.groups, ...sim.removal.groups].map(g => g.key))].sort();
    for (const key of keys) {
        for (const [name, g_run, s_run] of [["unclocked", game.unclocked, sim.unwired_run], ["clocked", game.clocked, sim.clocked_run]]) {
            const g = per(g_run, key), s = per(s_run, key);
            lines.push(`| ${key.split(" | ").join("; ")} | ${name} | ${g?.n ?? "-"} / ${s?.n ?? "-"} | ${f(g?.w)} (${f(g?.src)} / ${f(g?.dst)} / ${f(g?.pick)}) | ${f(s?.w)} (${f(s?.src)} / ${f(s?.dst)} / ${f(s?.pick)}) | ${g && s ? f(s.w - g.w) : "-"} | ${f(g?.w_original)} | ${f(s?.w_original)} |`);
            rows.push({ key, run: name, game: g, simulator: s });
        }
    }
    lines.push("", "| Group | Game w removed | Call | Simulator w removed | Call | Same call | Game, original: w removed / call | Simulator, original |", "|---|---|---|---|---|---|---|---|");
    const call = c => c === null || c === undefined ? "not wired" : `${c.call} (${c.firm ? "firm" : "marginal"}, ${c.region})`;
    const same = (a, b) => (a?.call ?? null) === (b?.call ?? null) ? "yes" : "NO";
    for (const key of keys) {
        const g = game_removal.groups.find(x => x.key === key), s = sim.removal.groups.find(x => x.key === key);
        const go = game_original.groups.find(x => x.key === key), so = sim.removal_original.groups.find(x => x.key === key);
        lines.push(`| ${key.split(" | ").join("; ")} | ${f(g?.w_removed)} | ${call(g?.call)} | ${f(s?.w_removed)} | ${call(s?.call)} | ${same(g?.call, s?.call)} | ${f(go?.w_removed)} / ${call(go?.call)} | ${f(so?.w_removed)} / ${call(so?.call)} |`);
    }
    lines.push(`| pooled | ${f(game_removal.w_removed_pooled)} | ${call(game_removal.call)} | ${f(sim.removal.w_removed_pooled)} | ${call(sim.removal.call)} | ${same(game_removal.call, sim.removal.call)} | ${f(game_original.w_removed_pooled)} / ${call(game_original.call)} | ${f(sim.removal_original.w_removed_pooled)} / ${call(sim.removal_original.call)} |`);
    for (const [name, run] of [["game unclocked", game.unclocked], ["game clocked", game.clocked], ["simulator unwired", sim.unwired_run], ["simulator clocked", sim.clocked_run]]) {
        for (const m of run.true_start_unknown) lines.push(`true starts not known, ${name}: ${m.machine_id} ${m.recipe}`);
    }
    fs.writeFileSync(path.join(out, `${SAMPLE}-compare.md`), lines.join("\n") + "\n");
    fs.writeFileSync(path.join(out, `${SAMPLE}-compare.json`), JSON.stringify({ rows, game_removal, game_original, sim_removal: sim.removal, sim_original: sim.removal_original }, null, 1));
    console.log(lines.join("\n"));
})().catch(e => { console.error(e); process.exit(1); });
