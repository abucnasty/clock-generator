import fs from "fs/promises";
import { loadConfigFromFile } from "./config/loader";
import { generateClockForConfig } from "./crafting/generate-blueprint";
import { compareRecording, DEFAULT_COMPARE_OPTIONS, formatReport } from "./verification/compare";
import { matchRecordingToConfig } from "./verification/entity-matching";
import { parseRecording } from "./verification/recording";

function argValue(name: string): string | undefined {
    return process.argv.find(arg => arg.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
}

async function main() {
    const config_path = argValue("config");
    const recording_path = argValue("recording");
    if (!config_path || !recording_path) {
        console.error("Usage: npm run verify -- --config=<config.json> --recording=<recording.json> [--overrides='{\"terminal_swing_count\":2}'] [--tolerance=2] [--window=32]");
        process.exit(2);
    }
    const options = {
        tolerance_ticks: Number(argValue("tolerance") ?? DEFAULT_COMPARE_OPTIONS.tolerance_ticks),
        match_window_ticks: Number(argValue("window") ?? DEFAULT_COMPARE_OPTIONS.match_window_ticks),
    };

    const loaded = await loadConfigFromFile(config_path);
    // e.g. the swing count of the clock alternative that was built in game
    const overrides = argValue("overrides");
    const config = overrides ? { ...loaded, overrides: { ...loaded.overrides, ...JSON.parse(overrides) } } : loaded;
    const recording = parseRecording(JSON.parse(await fs.readFile(recording_path, "utf-8")));

    // the simulator logs heavily through console.log
    const log = console.log;
    console.log = () => {};
    const result = (() => {
        try {
            return generateClockForConfig(config, { logger: { log: () => {}, warn: () => {}, error: console.error, debug: () => {} } });
        } finally {
            console.log = log;
        }
    })();

    const match = matchRecordingToConfig(recording, config);
    const report = compareRecording(recording, config, result, match, options);
    formatReport(report, options).forEach(line => console.log(line));
    process.exit(report.issues.length === 0 ? 0 : 1);
}

main().catch(error => {
    console.error(error);
    process.exit(2);
});
