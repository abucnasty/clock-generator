// node scripts/record-clock.js <recordings dir> <build or sample key or config path> <on|off> [alternative id] [--long <reason>]
// Records a potential clock of a scaffolded build in Factorio (the selected one unless an id is given) and checks it
// as the game tests do: what it moved in every window cycle, the wake-ups against the simulator's, and the simulator laid
// against the game entity by entity. <on|off> is "Backed-up belts". A recording that is already in the directory is
// read instead of made again. The simulator's wake-ups a minute are those of the run scripts/sim-game-check.js judges, seeded from
// the recording (scripts/seeded-run.js), with the cold start's on a line of its own.
//
// To record windows of your own, such as a clock tightened by hand: WINDOWS=<json file> holding
// {"period": 528, "output_swings": 2, "windows": {"inserter:1": [{"start": 1, "end": 6}, ...], ...}}. They are built as
// they are; output_swings is the output swings per cycle of the plan whose window cycle they are of.
//
// <build> is one of the named builds below, or any config: a sample key of ConfigPaths (ADVANCED_CIRCUIT_240) or the path of a
// config JSON. The scaffold of a config is the <config name>.scaffold beside it (else the longest prefix of its name that has one) (SCAFFOLD= names another), and the
// warm-up ticks are those of its entry in tests/game/builds/scaffold-recordings.game.test.ts (WARMUP_TICKS= sets them, 3600
// otherwise). A build that is seeded there (eggs, bacteria) needs SEED=<json>, such as
// [{"target": {"recipe": "pentapod-egg"}, "item": "pentapod-egg", "count": 200}]. The alternative may be any id of the
// generator (the UI and export-clock.js name them), or `selected`.
//
// To try a variant without touching the samples: SCAFFOLD=<blueprint file> records on that scaffold, CONFIG=<config
// json> generates for that config, and TAG=<word> goes into the name of the recording so that it is kept apart.
//
// The run is timed in game ticks, as the game tests are (scripts/game-run.js, tests/game/helpers/lua/steady.lua): after the
// warm-up the build runs on the clock until its final machines have made the target amount over the trailing minute (steady
// state), the next minute is the baseline, judged by the game tests' own rule, and then the recording starts. It holds whole
// window cycles, at least TICKS=<n> ticks (3,600 by default). A request, or a recording of whole window cycles, over 36,000 ticks is
// refused unless `--long <reason>` (or LONG_RUN=<reason>) says why this build needs it; the reason is printed. The exit code is
// 1 when the baseline is not met.
//
// Needs FACTORIO_PATH and FACTORIO_HARNESS_SAVE (`set -a; . ./.env; set +a`), and the harness runs one game at a
// time: `flock /tmp/claude-1000/factorio-harness.lock node scripts/record-clock.js ...`.
const path = require("path"), fs = require("fs"), os = require("os");
const { GAME_RUN, takeLongReason, assertWithinRun, steadyProbeSource, readSteadyReport, describeRun } = require("./game-run");
const args = process.argv.slice(2);
const long = takeLongReason(args);
const [out_arg, name, belts, alternative_id] = args;
const out_dir = path.resolve(out_arg ?? ".");
const scaffold_arg = process.env.SCAFFOLD && path.resolve(process.env.SCAFFOLD);
const given_windows = process.env.WINDOWS && path.resolve(process.env.WINDOWS);
const { ROOT, dist, quiet, loadSample } = require("./lib");
const { scaffoldOf } = require("./scaffold-of");
const { ConfigPaths } = dist("config/config-paths.js");
const { generateClockAlternatives, clockBeltLabel, clockFromWindows } = dist("crafting/generate-blueprint.js");
const { encodeBlueprintFile } = dist("blueprints/serde.js");
const { recordInFactorio, recordedTicks } = dist("harness/factorio-harness.js");
const { outputPerWindowCycle, recipesMaking, clockWindowCycles } = dist("harness/recording-output.js");
const { matchRecordingToConfig } = dist("verification/entity-matching.js");
const { wakeUpsOfRecording } = dist("verification/recording-wake-ups.js");
const { judgedWakeUps } = require("./seeded-run");
const { compareRecordings } = dist("verification/compare-recordings.js");
const { matchOfSimulatedRecording, simulateRecording } = dist("verification/simulated-recording.js");
const { parseRecording } = dist("verification/recording.js");

const SAMPLES = path.join(ROOT, "resources", "config-samples");
// as in tests/game/builds/scaffold-recordings.game.test.ts (the settle is the steady-state search of scripts/game-run.js)
const BUILDS = {
    "agricultural-science": { scaffold: "science/agricultural/agricultural-250.scaffold", config: "AGRICULTURAL_SCIENCE_250", seed: [{ target: { recipe: "pentapod-egg" }, item: "pentapod-egg", count: 200 }], warmup_ticks: 300 },
    "automation-science": { scaffold: "science/automation/automation-240.scaffold", config: "AUTOMATION_SCIENCE_240", seed: [], warmup_ticks: 3600 },
    "automation-science-belted-buffer": { scaffold: "science/automation/automation-120-foundries-feed-belt-to-assembler.scaffold", config: "AUTOMATION_SCIENCE_120_FOUNDRIES_FEED_BELT_TO_ASSEMBLER", seed: [], warmup_ticks: 3600 },
    "low-density-structure": { scaffold: "intermediates/lds/lds-240.scaffold", config: "LDS_240", seed: [], warmup_ticks: 3600 },
    "advanced-circuit": { scaffold: "intermediates/advanced-circuit/advanced-circuit.scaffold", config: "ADVANCED_CIRCUIT_240", seed: [], warmup_ticks: 3600 },
    "utility-science": { scaffold: "science/utility/utility-120.scaffold", config: "UTILITY_SCIENCE_120", seed: [], warmup_ticks: 3600 },
    "utility-science-belted-blue-and-lds": { scaffold: "science/utility/utility-120-processing-unit-and-lds-on-one-belt.scaffold", config: "UTILITY_SCIENCE_120_PROCESSING_UNIT_AND_LDS_ON_ONE_BELT", seed: [], warmup_ticks: 3600 },
    "accumulator": { scaffold: "intermediates/accumulator/accumulator-640.scaffold", config: "ACCUMULATOR_640", seed: [], warmup_ticks: 3600 },
    "productivity-module-80-chest-chain-clock": { scaffold: "intermediates/productivity-module/productivity-module-80-chest-chain.scaffold", config: "PRODUCTIVITY_MODULE_80_CHEST_CHAIN", seed: [], warmup_ticks: 3600 },
    "iron-bacteria": { scaffold: "gleba/iron-bacteria/iron-bacteria-380-cultivation.scaffold", config: "IRON_BACTERIA_380_CULTIVATION", seed: [{ target: { recipe: "iron-bacteria-cultivation" }, item: "iron-bacteria", count: 50 }], warmup_ticks: 300 },
};
// the recording holds whole window cycles of at least this many ticks: the baseline's minute, or TICKS=<n> in the environment
const RECORDED_TICKS = Number(process.env.TICKS ?? GAME_RUN.baseline);

const TESTS = path.join(ROOT, "tests", "game", "builds", "scaffold-recordings.game.test.ts");

/**
 * What a build that is not in the table above needs, from its entry in the game test: the ticks it warms up
 * for, and whether it is seeded (which this cannot read; SEED= gives it)
 */
function buildOfConfig(arg) {
    const config_path = ConfigPaths[arg] ?? path.resolve(arg);
    const key = Object.keys(ConfigPaths).find(it => ConfigPaths[it] === config_path);
    const block = fs.existsSync(TESTS) && key ? fs.readFileSync(TESTS, "utf-8").split(/^    \},?$/m).find(it => it.includes(`config: ConfigPaths.${key},`)) : undefined;
    const ticks = field => Number(new RegExp(`${field}: ([\\d_]+)`).exec(block ?? "")?.[1].replace(/_/g, ""));
    const scaffold = scaffold_arg ?? scaffoldOf(config_path);
    if (!fs.existsSync(scaffold)) {
        throw new Error(`No scaffold at ${scaffold}: SCAFFOLD=<blueprint file> names one`);
    }
    if (block !== undefined && /seed: \[\s*\{/.test(block) && !process.env.SEED) {
        throw new Error(`${arg} is seeded in ${path.relative(ROOT, TESTS)}: SEED=<json> gives the same seed`);
    }
    return {
        scaffold, config: arg, seed: process.env.SEED ? JSON.parse(process.env.SEED) : [],
        warmup_ticks: Number(process.env.WARMUP_TICKS ?? (ticks("warmup_ticks") || 3600)),
    };
}

(async () => {
    if (name === undefined || (belts !== "on" && belts !== "off")) {
        throw new Error(`usage: record-clock.js <recordings dir> <${Object.keys(BUILDS).join("|")}|sample key|config path> <on|off> [alternative id] [--long <reason>]`);
    }
    if (!Number.isInteger(RECORDED_TICKS) || RECORDED_TICKS <= 0) throw new Error(`TICKS is a whole number of ticks above 0, not ${process.env.TICKS}`);
    assertWithinRun(RECORDED_TICKS, long, "TICKS");
    const build = BUILDS[name] ? { ...BUILDS[name], scaffold: path.join(SAMPLES, BUILDS[name].scaffold) } : buildOfConfig(name);
    const scaffold = scaffold_arg || build.scaffold;
    const config = await loadSample(process.env.CONFIG ?? build.config, belts === "on");
    let selected;
    if (given_windows) {
        const given = JSON.parse(fs.readFileSync(given_windows, "utf-8"));
        if (given.output_swings) {
            config.overrides = { ...config.overrides, terminal_swing_count: given.output_swings };
        }
        const made = clockFromWindows(config, given.windows, given.period, quiet);
        selected = { id: process.env.TAG || "given-windows", label: `the windows of ${path.basename(given_windows)}`, belt: made.belt, verdict: made.stability_check.holds ? "stable" : "unstable", result: made };
    } else {
        const { alternatives, selected_index } = generateClockAlternatives(config, { logger: quiet });
        selected = alternative_id && alternative_id !== "selected" ? alternatives.find(a => a.id === alternative_id) : alternatives[selected_index];
        if (selected === undefined) {
            throw new Error(`No potential clock ${alternative_id}. There are: ${alternatives.map(a => a.id).join(", ")}`);
        }
    }
    const result = selected.result;
    const window_cycle_ticks = result.simulation_duration.ticks;
    // a fractional window cycle is built as a subtick clock, which counts the whole ticks after which the window cycle repeats
    const clock_ticks = result.subtick ? result.subtick.clock.window_cycle_ticks : window_cycle_ticks;
    console.log(`${name} (backed-up belts: ${belts}): ${selected.id} "${selected.label}", belt ${selected.belt ? clockBeltLabel(selected.belt) : "-"}, `
        + `${selected.verdict} in the simulator, period ${window_cycle_ticks}, clock counts ${clock_ticks}`);

    // what the scaffold makes a second: the config's target is for all its copies, a scaffold holds the one the generator expects output of
    const target_per_second = result.stability_check.expected_output_items * 60 / window_cycle_ticks;
    const tag = process.env.TAG ? `-${process.env.TAG}` : "";
    const file = path.join(out_dir, `${path.basename(name, ".json")}${tag}-${selected.id}-${belts}.json`);
    const steady_file = file.replace(/\.json$/, ".steady.json");
    let recording, run;
    if (fs.existsSync(file)) {
        recording = parseRecording(JSON.parse(fs.readFileSync(file, "utf-8")));
        run = fs.existsSync(steady_file) ? JSON.parse(fs.readFileSync(steady_file, "utf-8")) : undefined;
    } else {
        // whole window cycles, from the clock's next wrap: a clock of a long window cycle records (and waits for) more than the minute asked for
        assertWithinRun(recordedTicks(RECORDED_TICKS, clock_ticks), long, `the recording of whole periods of ${clock_ticks} ticks`);
        fs.mkdirSync(out_dir, { recursive: true });
        const exported = result.subtick ?? result;
        const work_dir = fs.mkdtempSync(path.join(os.tmpdir(), "record-clock-"));
        const started = Date.now();
        try {
            recording = (await recordInFactorio({
                factorio: process.env.FACTORIO_PATH, save: process.env.FACTORIO_HARNESS_SAVE,
                blueprint: fs.readFileSync(scaffold, "utf-8").trim(), out: file,
                ticks: RECORDED_TICKS, warmup_ticks: build.warmup_ticks, settle_ticks: GAME_RUN.cap + 1, seed: build.seed,
                lua: steadyProbeSource(target_per_second, config.setpoint.recipe, recipesMaking(config, config.setpoint.recipe), "record-clock-steady.json"), work_dir,
                clock: { blueprint: encodeBlueprintFile({ blueprint: exported.blueprint }), schedule: exported.schedule }, config,
                unclocked: false, game_speed: 1000, timeout_seconds: 900, log: () => { }, cache: false,
            })).recording;
            run = readSteadyReport(work_dir, "record-clock-steady.json");
            fs.writeFileSync(steady_file, JSON.stringify(run) + "\n");
        } finally {
            fs.rmSync(work_dir, { recursive: true, force: true });
        }
        console.log(`  game: ${recording.sample_count} ticks recorded after the steady-state run, ${Math.round((Date.now() - started) / 1000)} s of wall time with the warm-up`);
    }

    // a subtick clock's repeat can leave a float a hair off the whole number of items
    const expected = Math.round(result.stability_check.expected_output_items * clock_ticks / window_cycle_ticks * 1e6) / 1e6;
    // the first window cycle is cut where the recording starts
    const window_cycles = outputPerWindowCycle(recording, recipesMaking(config, config.setpoint.recipe)).slice(1);
    const tally = {};
    window_cycles.forEach(p => tally[p.items] = (tally[p.items] ?? 0) + 1);
    console.log(`  game: ${window_cycles.length} periods, expected ${expected} a period, moved`, JSON.stringify(tally));
    const match = matchRecordingToConfig(recording, config);
    const simulated = simulateRecording(config, result.clock_windows, window_cycle_ticks, recording.sample_count * 1.5, clock_ticks);
    const simulated_match = matchOfSimulatedRecording(simulated);
    // both sides by the rule "kept-lists", as scripts/sim-game-check.js counts them. The simulator's figure is the run sim-game-check
    // judges (seeded-run.js): seeded from the recording, whose machines the game warmed up and the simulator does not, where the
    // recording gives a complete seed, else cold; the game's is its whole recording. The cold start is the simulator's whole window cycles
    // after its first third (the settled run the scaffold tests and the comparison below judge), whose count differs from the seeded
    // run's where a build's states do not repeat within the recording (#603)
    const settled = clockWindowCycles(simulated.clock.values).filter(it => it.start >= Math.floor(simulated.sample_count / 3));
    const simulated_wake_ups = settled.length === 0 ? undefined
        : wakeUpsOfRecording(simulated, simulated_match, settled[0].start, settled[settled.length - 1].end, config);
    const judged = judgedWakeUps(await loadSample(process.env.CONFIG ?? build.config, belts === "on"), recording, match, { windows: result.clock_windows, period: window_cycle_ticks, clock_ticks });
    const judged_label = judged.judged_run === "seeded" ? `seeded from sample ${judged.seed.sample}, judged by sim-game-check`
        : `cold start, judged by sim-game-check: ${judged.seed.applied ? "the seed is incomplete" : "no seed"}`;
    console.log(`  wake-ups a minute, rule "kept-lists" on the recording: simulator (${judged_label}) ${judged.wake_ups_per_minute?.toFixed(1) ?? "-"}, game ${wakeUpsOfRecording(recording, match, 0, recording.sample_count, config).wake_ups_per_minute.toFixed(1)}`);
    console.log(`  wake-ups a minute, rule "kept-lists" on the recording: simulator (cold start) ${simulated_wake_ups?.wake_ups_per_minute.toFixed(1) ?? "-"}`);
    const compared = compareRecordings(
        { recording, match },
        { recording: simulated, match: simulated_match, from_sample: Math.floor(simulated.sample_count / 3) },
        config, { expected_output_per_window_cycle: expected });
    console.log("  simulator against game, issues:", JSON.stringify(compared.issues).slice(0, 1500));
    // production is judged by the game tests' rule over the final machines, not by the window cycles tallied above
    if (run === undefined) {
        console.log("  protocol: no steady-state report beside this recording (it was made before the minute protocol)");
    } else {
        const verdict = describeRun(run, target_per_second);
        for (const line of verdict.lines) console.log(`  protocol: ${line}`);
        console.log(`  protocol: ${verdict.holds ? "holds" : "DOES NOT HOLD"}`);
        if (!verdict.holds) process.exitCode = 1;
    }
})().catch(e => { console.error(e); process.exit(1); });
