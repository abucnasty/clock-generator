// node scripts/record-clock.js <recordings dir> <build> <on|off> [alternative id]
// Records a potential clock of a scaffolded build in Factorio (the selected one unless an id is given) and checks it
// as the game tests do: what it moved in every period, the wake-ups against the simulator's, and the simulator laid
// against the game entity by entity. <on|off> is "Backed-up belts". A recording that is already in the directory is
// read instead of made again.
//
// To record windows of your own, such as a clock tightened by hand: WINDOWS=<json file> holding
// {"period": 528, "output_swings": 2, "windows": {"inserter:1": [{"start": 1, "end": 6}, ...], ...}}. They are built as
// they are; output_swings is the output swings per cycle of the plan whose period they are of.
//
// To try a variant without touching the samples: SCAFFOLD=<blueprint file> records on that scaffold, CONFIG=<config
// json> generates for that config, and TAG=<word> goes into the name of the recording so that it is kept apart.
//
// Needs FACTORIO_PATH and FACTORIO_HARNESS_SAVE (`set -a; . ./.env; set +a`), and the harness runs one game at a
// time: `flock /tmp/claude-1000/factorio-harness.lock node scripts/record-clock.js ...`. A minute a build.
const path = require("path"), fs = require("fs");
const [out_arg, name, belts, alternative_id] = process.argv.slice(2);
const out_dir = path.resolve(out_arg);
const scaffold_arg = process.env.SCAFFOLD && path.resolve(process.env.SCAFFOLD);
const given_windows = process.env.WINDOWS && path.resolve(process.env.WINDOWS);
const { ROOT, dist, quiet, loadSample } = require("./lib");
const { generateClockAlternatives, clockBeltLabel, clockFromWindows } = dist("crafting/generate-blueprint.js");
const { encodeBlueprintFile } = dist("blueprints/serde.js");
const { recordInFactorio } = dist("harness/factorio-harness.js");
const { outputPerPeriod, recipesMaking } = dist("harness/recording-output.js");
const { matchRecordingToConfig } = dist("verification/entity-matching.js");
const { wakeUpsOfRecording } = dist("verification/recording-wake-ups.js");
const { compareRecordings } = dist("verification/compare-recordings.js");
const { matchOfSimulatedRecording, simulateRecording } = dist("verification/simulated-recording.js");
const { parseRecording } = dist("verification/recording.js");

const SAMPLES = path.join(ROOT, "resources", "config-samples");
// as in tests/game/builds/scaffold-recordings.game.test.ts
const BUILDS = {
    "agricultural-science": { scaffold: "science/agriculture-science/agriculture-science-scaffold.txt", config: "AGRICULTURAL_SCIENCE", seed: [{ target: { recipe: "pentapod-egg" }, item: "pentapod-egg", count: 200 }], warmup_ticks: 300, settle_ticks: 4800 },
    "automation-science": { scaffold: "science/automation-science/automation-science-scaffold.txt", config: "AUTOMATION_SCIENCE", seed: [], warmup_ticks: 3600, settle_ticks: 1200 },
    "automation-science-belted-buffer": { scaffold: "science/automation-science/automation-science-belted-buffer-scaffold.txt", config: "AUTOMATION_SCIENCE_BELTED_BUFFER", seed: [], warmup_ticks: 3600, settle_ticks: 1200 },
    "low-density-structure": { scaffold: "intermediates/low-density-structure/low-density-structure-scaffold.txt", config: "LOW_DENSITY_STRUCTURE", seed: [], warmup_ticks: 3600, settle_ticks: 2400 },
    "advanced-circuit": { scaffold: "intermediates/advanced-circuit/advanced-circuit-scaffold.txt", config: "ADVANCED_CIRCUIT", seed: [], warmup_ticks: 3600, settle_ticks: 4800 },
    "utility-science": { scaffold: "science/utility-science/utility-science-scaffold.txt", config: "UTILITY_SCIENCE", seed: [], warmup_ticks: 3600, settle_ticks: 2400 },
    "utility-science-belted-blue-and-lds": { scaffold: "science/utility-science/utility-science-belted-combined-blue-and-lds-scaffold.txt", config: "UTILITY_SCIENCE_BELTED_COMBINED_BLUE_AND_LDS", seed: [], warmup_ticks: 3600, settle_ticks: 2400 },
    "accumulator": { scaffold: "intermediates/accumulator/accumulator-640-scaffold.txt", config: "ACCUMULATOR_640", seed: [], warmup_ticks: 3600, settle_ticks: 7200 },
    "iron-bacteria": { scaffold: "gleba/iron-bacteria-cultivation/iron-bacteria-cultivation-scaffold.txt", config: "IRON_BACTERIA_CULTIVATION", seed: [{ target: { recipe: "iron-bacteria-cultivation" }, item: "iron-bacteria", count: 50 }], warmup_ticks: 300, settle_ticks: 3600 },
};
// TICKS=<n> in the environment records that many instead (at most 72,000)
const RECORDED_TICKS = Number(process.env.TICKS ?? 36000);

(async () => {
    const build = BUILDS[name];
    if (build === undefined || (belts !== "on" && belts !== "off")) {
        throw new Error(`usage: record-clock.js <recordings dir> <${Object.keys(BUILDS).join("|")}> <on|off> [alternative id]`);
    }
    const scaffold = scaffold_arg || path.join(SAMPLES, build.scaffold);
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
        selected = alternative_id ? alternatives.find(a => a.id === alternative_id) : alternatives[selected_index];
        if (selected === undefined) {
            throw new Error(`No potential clock ${alternative_id}. There are: ${alternatives.map(a => a.id).join(", ")}`);
        }
    }
    const result = selected.result;
    const period = result.simulation_duration.ticks;
    // a fractional period is built as a subtick clock, which counts the whole ticks after which the period repeats
    const clock_ticks = result.subtick ? result.subtick.clock.period_ticks : period;
    console.log(`${name} (backed-up belts: ${belts}): ${selected.id} "${selected.label}", belt ${selected.belt ? clockBeltLabel(selected.belt) : "-"}, `
        + `${selected.verdict} in the simulator, period ${period}, clock counts ${clock_ticks}`);

    const tag = process.env.TAG ? `-${process.env.TAG}` : "";
    const file = path.join(out_dir, `${name}${tag}-${selected.id}-${belts}.json`);
    let recording;
    if (fs.existsSync(file)) {
        recording = parseRecording(JSON.parse(fs.readFileSync(file, "utf-8")));
    } else {
        fs.mkdirSync(out_dir, { recursive: true });
        const exported = result.subtick ?? result;
        recording = (await recordInFactorio({
            factorio: process.env.FACTORIO_PATH, save: process.env.FACTORIO_HARNESS_SAVE,
            blueprint: fs.readFileSync(scaffold, "utf-8").trim(), out: file,
            ticks: RECORDED_TICKS, warmup_ticks: build.warmup_ticks, settle_ticks: build.settle_ticks, seed: build.seed,
            clock: { blueprint: encodeBlueprintFile({ blueprint: exported.blueprint }), schedule: exported.schedule }, config,
            unclocked: false, game_speed: 1000, timeout_seconds: 900, log: () => { },
        })).recording;
    }

    // a subtick clock's repeat can leave a float a hair off the whole number of items
    const expected = Math.round(result.stability_check.expected_output_items * clock_ticks / period * 1e6) / 1e6;
    // the first period is cut where the recording starts
    const periods = outputPerPeriod(recording, recipesMaking(config, config.target_output.recipe)).slice(1);
    const tally = {};
    periods.forEach(p => tally[p.items] = (tally[p.items] ?? 0) + 1);
    console.log(`  game: ${periods.length} periods, expected ${expected} a period, moved`, JSON.stringify(tally));
    const match = matchRecordingToConfig(recording, config);
    const simulated_wake_ups = result.stability_check.as_built?.wake_ups;
    console.log(`  wake-ups a minute: simulator ${simulated_wake_ups?.wake_ups_per_minute.toFixed(1)}, game ${wakeUpsOfRecording(recording, match).wake_ups_per_minute.toFixed(1)}`);
    const simulated = simulateRecording(config, result.clock_windows, period, RECORDED_TICKS * 1.5, clock_ticks);
    const compared = compareRecordings(
        { recording, match },
        { recording: simulated, match: matchOfSimulatedRecording(simulated), from_sample: Math.floor(simulated.sample_count / 3) },
        config, { expected_output_per_period: expected });
    console.log("  simulator against game, issues:", JSON.stringify(compared.issues).slice(0, 1500));
})().catch(e => { console.error(e); process.exit(1); });
