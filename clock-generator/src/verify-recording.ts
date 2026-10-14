import fs from "fs/promises";
import { loadConfigFromFile } from "./config/loader";
import { EntityId } from "./entities";
import { generateClockAlternatives } from "./crafting/generate-blueprint";
import { compareWithExportedClocks, formatExportedClockReport } from "./verification/compare";
import { compareRecordings, formatRecordingComparison } from "./verification/compare-recordings";
import { matchRecordingToConfig } from "./verification/entity-matching";
import { parseRecording } from "./verification/recording";
import { matchOfSimulatedRecording, simulateRecording } from "./verification/simulated-recording";

/** The simulated run is this many times as long as the recording, and its first third is left out as its start-up */
const SIMULATED_TO_RECORDED_TICKS = 1.5;
const SIMULATED_SETTLE_SHARE = 3;

function argValue(name: string): string | undefined {
    return process.argv.find(arg => arg.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
}

async function main() {
    const config_path = argValue("config");
    const recording_path = argValue("recording");
    if (!config_path || !recording_path) {
        console.error("Usage: npm run verify -- --config=<config.json> --recording=<recording.json> [--alternative=<id, label or index>] [--overrides='{\"terminal_swing_count\":2}'] [--items-tolerance=0.5] [--state-agreement=0.95]");
        console.error("  --alternative: the clock that was built, as listed by the UI (default: the one it selects), e.g. planned-belt-slack or 'Batched swings: 5 output swings per cycle'");
        console.error("  --items-tolerance: items a period an inserter or machine may differ by between the game and the simulator");
        console.error("  --state-agreement: share of the time an entity has to show the same state in both not to be marked DIFF");
        process.exit(2);
    }
    const options = {
        items_tolerance: Number(argValue("items-tolerance") ?? 0.5),
        state_agreement: Number(argValue("state-agreement") ?? 0.95),
    };

    const loaded = await loadConfigFromFile(config_path);
    // e.g. the swing count of the clock alternative that was built in game
    const overrides = argValue("overrides");
    const config = overrides ? { ...loaded, overrides: { ...loaded.overrides, ...JSON.parse(overrides) } } : loaded;
    const recording = parseRecording(JSON.parse(await fs.readFile(recording_path, "utf-8")));

    // the simulator logs heavily through console.log and warns about enable control ranges it clamps
    const log = console.log;
    const warn = console.warn;
    console.log = () => {};
    console.warn = () => {};
    const quietly = <T>(run: () => T): T => {
        console.log = () => {};
        console.warn = () => {};
        try {
            return run();
        } finally {
            console.log = log;
            console.warn = warn;
        }
    };
    const alternatives = quietly(() =>
        generateClockAlternatives(config, { verify_as_built: true, logger: { log: () => {}, warn: () => {}, error: console.error, debug: () => {} } }));
    const wanted = argValue("alternative");
    const alternative = wanted === undefined
        ? alternatives.alternatives[alternatives.selected_index]
        : alternatives.alternatives.find((it, index) => it.id === wanted || it.label === wanted || it.label.startsWith(wanted) || String(index) === wanted);
    if (!alternative) {
        console.error(`No clock alternative "${wanted}". Alternatives: ${alternatives.alternatives.map((it, index) => `${index}: ${it.id} (${it.label})`).join("; ")}`);
        process.exit(2);
    }
    console.log(`Clock alternative: ${alternative.label} (${alternative.id}), ${alternative.verdict} as built`);
    const result = alternative.result;

    // The clock that was built: the subtick clock counts the whole ticks a fractional period repeats after, and the
    // clock rounded down runs every period that much short
    const planned_period = result.simulation_duration.ticks;
    const subtick = alternative.id.endsWith("-subtick") ? result.subtick : undefined;
    const period = subtick || Number.isInteger(planned_period) ? planned_period : Math.floor(planned_period);
    const clock_ticks = subtick ? subtick.clock.period_ticks : period;
    const expected_output_per_period = result.stability_check.expected_output_items * clock_ticks / planned_period;

    // the settled clock on its own, as the blueprint runs it in the game, and not the plan the windows were taken from
    const simulated = quietly(() =>
        simulateRecording(config, result.clock_windows, period, Math.ceil(recording.sample_count * SIMULATED_TO_RECORDED_TICKS), clock_ticks));
    const match = matchRecordingToConfig(recording, config);
    const free_running_inserter_ids = new Set(config.inserters.map((inserter, index) => inserter.id ?? index + 1)
        .filter(id => result.unplanned_inserter_clocks?.[EntityId.forInserter(id).id]?.own_clock));

    console.log("");
    console.log("Entity mapping (recorded -> config):");
    console.log(`  machines:  ${Array.from(match.machines).map(([r, c]) => `${r}->${c}`).join(", ")}`);
    console.log(`  inserters: ${Array.from(match.inserters).map(([r, c]) => `${r}->${c}`).join(", ")}`);
    console.log("");

    const exported = compareWithExportedClocks(recording, config, result, match);
    formatExportedClockReport(exported).forEach(line => console.log(line));

    const report = compareRecordings(
        { recording, match },
        { recording: simulated, match: matchOfSimulatedRecording(simulated), from_sample: Math.floor(simulated.sample_count / SIMULATED_SETTLE_SHARE) },
        config,
        { ...options, expected_output_per_period, free_running_inserter_ids },
    );
    report.issues.push(...exported.issues);
    formatRecordingComparison(report, options).forEach(line => console.log(line));
    process.exit(report.issues.length === 0 ? 0 : 1);
}

main().catch(error => {
    console.error(error);
    process.exit(2);
});
