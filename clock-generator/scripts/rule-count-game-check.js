// node scripts/rule-count-game-check.js record <out folder>    records a scaffolded sample twice in the game: unclocked, and
//                                                              on its selected clock (FACTORIO_PATH, FACTORIO_HARNESS_SAVE)
// node scripts/rule-count-game-check.js compare <out folder>   lays the rule count of both recordings against the simulator's
//
// The check of the rule count's simulator path against the game (round 0 of the real-save loop, the reviewer's change
// A): the same build, unclocked and clocked, counted the rule's way from recordings of the game and from the
// simulator's runs of its config, per group. SAMPLE names the sample (default ADVANCED_CIRCUIT: machine-to-machine
// inputs and outputs that take part hands). The first clock period of each recording is left out, as the scaffold
// tests leave it out. Run the game under the harness lock, one at a time. Needs `npx tsc` first.
const fs = require("fs");
const path = require("path");
const { dist, quiet } = require("./lib");

const SAMPLE = process.env.SAMPLE ?? "ADVANCED_CIRCUIT";
const SCAFFOLDS = {
    ADVANCED_CIRCUIT: { scaffold: "intermediates/advanced-circuit/advanced-circuit-scaffold.txt", warmup: 3600, settle: 4800 },
    AUTOMATION_SCIENCE: { scaffold: "science/automation-science/automation-science-scaffold.txt", warmup: 300, settle: 4800 },
    ACCUMULATOR_640: { scaffold: "intermediates/accumulator/accumulator-640-scaffold.txt", warmup: 3600, settle: 7200 },
    LOW_DENSITY_STRUCTURE: { scaffold: "intermediates/low-density-structure/low-density-structure-scaffold.txt", warmup: 3600, settle: 2400 },
    // the egg loop cannot start itself, so the egg machines are given eggs to begin with, as the game tests do
    AGRICULTURAL_SCIENCE: {
        scaffold: "science/agriculture-science/agriculture-science-scaffold.txt", warmup: 300, settle: 4800,
        seed: [{ target: { recipe: "pentapod-egg" }, item: "pentapod-egg", count: 200 }],
    },
};
const PERIODS = 20;

(async () => {
    const [mode, out] = process.argv.slice(2);
    if (!["record", "compare"].includes(mode) || !out) {
        console.error("usage: node scripts/rule-count-game-check.js record|compare <out folder>");
        process.exit(2);
    }
    const { ConfigPaths } = dist("config/config-paths.js");
    const { loadConfigFromFile } = dist("config/loader.js");
    const { generateClockAlternatives } = dist("crafting/generate-blueprint.js");
    const config = await loadConfigFromFile(ConfigPaths[SAMPLE]);
    const generated = generateClockAlternatives(config, { logger: quiet });
    const selected = generated.alternatives[generated.selected_index];
    const period = selected.result.simulation_duration.ticks;
    fs.mkdirSync(out, { recursive: true });

    if (mode === "record") {
        const { recordInFactorio } = dist("harness/factorio-harness.js");
        const { encodeBlueprintFile } = dist("blueprints/serde.js");
        const build = SCAFFOLDS[SAMPLE];
        const samples_dir = path.join(path.dirname(ConfigPaths[SAMPLE]), "..", "..");
        const blueprint = fs.readFileSync(path.join(samples_dir, build.scaffold), "utf8").trim();
        const exported = selected.result.subtick ?? selected.result;
        const clock = { blueprint: encodeBlueprintFile({ blueprint: exported.blueprint }), schedule: exported.schedule };
        for (const unclocked of [true, false]) {
            const name = unclocked ? "unclocked" : "clocked";
            const started = Date.now();
            await recordInFactorio({
                factorio: process.env.FACTORIO_PATH, save: process.env.FACTORIO_HARNESS_SAVE, blueprint,
                out: path.join(out, `${SAMPLE}-${name}.json`), ticks: period * (PERIODS + 1),
                warmup_ticks: build.warmup, settle_ticks: build.settle, seed: build.seed ?? [],
                clock: unclocked ? undefined : clock, config: unclocked ? undefined : config, unclocked,
                game_speed: 1000, timeout_seconds: 900, log: () => { },
            });
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
