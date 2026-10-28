import fs from "fs";
import path from "path";

const ENGINE = path.resolve(__dirname, "../../..");

/**
 * Every config the repository keeps with a target under a folder: the files that hold `machines` and a `target_output`
 * (a Sidecar export has no target: it is not a config the generator runs)
 */
function sampleConfigs(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === ".scratch" || entry.name === "node_modules" ? [] : sampleConfigs(file);
        if (!entry.name.endsWith(".json")) return [];
        const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
        const config = typeof value === "object" && value !== null && Array.isArray((value as { machines?: unknown }).machines);
        return config && typeof (value as { target_output?: unknown }).target_output === "object" ? [file] : [];
    });
}

/** A legacy fixture the simulator refuses to build, as pickup-capture.test.ts expects: its pickups were not captured */
const REFUSED = path.join(ENGINE, "src", "config", "fixtures", "legacy", "pickup-without-capture.json");

/**
 * The config samples, the game tests' configs, tests/configs and the fixtures of the source, each a config with a target
 * the simulator builds: what the tests that hold the traits to the entities' figures walk
 */
export const SAMPLE_CONFIG_FILES: readonly string[] = [
    ...sampleConfigs(path.join(ENGINE, "resources", "config-samples")),
    ...sampleConfigs(path.join(ENGINE, "tests", "game")),
    ...sampleConfigs(path.join(ENGINE, "tests", "configs")),
    ...sampleConfigs(path.join(ENGINE, "src", "config", "fixtures")),
    ...sampleConfigs(path.join(ENGINE, "src", "crafting", "fixtures")),
].filter(file => file !== REFUSED);
