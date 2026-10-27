// Shared by the scripts in this folder. They read the built generator (`npx tsc` first) from this checkout, or from
// the checkout CLOCK_GENERATOR_ROOT names: a worktree of another commit, to sweep it as a baseline.
const path = require("path"), fs = require("fs");

const ROOT = path.resolve(process.env.CLOCK_GENERATOR_ROOT ?? path.join(__dirname, ".."));
// older builds, swept as baselines, read resources/ relative to where they run
const INVOKED_FROM = process.cwd();
process.chdir(ROOT);

const dist = file => require(path.join(ROOT, "dist", file));
// newer ones read the game data from resources/ once this module is loaded
if (fs.existsSync(path.join(ROOT, "dist", "data", "factorio-data-file.js"))) {
    dist("data/factorio-data-file.js");
}
const quiet = { log() { }, info() { }, warn() { }, error() { }, debug() { } };

/**
 * The config of a sample by its key in ConfigPaths, or of a config file by its path; `backed_up_belts` turns
 * `overrides.backed_up_belts` on. SEARCH=1 in the environment turns `overrides.search_for_fewer_wake_ups` on for
 * every script: the four searches then run for every sample, and not only where no other clock is stable.
 * START_DEPENDENCE=1 turns `overrides.check_start_dependence` on: every clock is tried from the other starts too.
 */
async function loadSample(key, backed_up_belts = false) {
    const { ConfigPaths } = dist("config/config-paths.js");
    const { loadConfigFromFile } = dist("config/loader.js");
    if (ConfigPaths[key] === undefined && !key.endsWith(".json")) {
        throw new Error(`No sample ${key}. Samples: ${Object.keys(ConfigPaths).join(", ")}`);
    }
    const config = await loadConfigFromFile(ConfigPaths[key] ?? path.resolve(INVOKED_FROM, key));
    if (backed_up_belts) {
        config.overrides = { ...config.overrides, backed_up_belts: true };
    }
    if (process.env.START_DEPENDENCE === "1") {
        config.overrides = { ...config.overrides, check_start_dependence: true };
    }
    if (process.env.SEARCH === "1") {
        config.overrides = { ...config.overrides, search_for_fewer_wake_ups: true };
    }
    return config;
}

/**
 * The keys of the samples the sweeps take: every sample but those that exist to be refused (older builds have no
 * such list).
 */
function sampleKeys() {
    const { ConfigPaths, ExpectedRefusals = {} } = dist("config/config-paths.js");
    return Object.keys(ConfigPaths).filter(key => !(key in ExpectedRefusals));
}

module.exports = { ROOT, dist, quiet, loadSample, sampleKeys };
