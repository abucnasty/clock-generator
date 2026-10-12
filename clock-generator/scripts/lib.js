// Shared by the scripts in this folder. They read the built generator (`npx tsc` first) from this checkout, or from
// the checkout CLOCK_GENERATOR_ROOT names: a worktree of another commit, to sweep it as a baseline.
const path = require("path");

const ROOT = path.resolve(process.env.CLOCK_GENERATOR_ROOT ?? path.join(__dirname, ".."));
// the generator reads resources/ relative to where it runs
const INVOKED_FROM = process.cwd();
process.chdir(ROOT);

const dist = file => require(path.join(ROOT, "dist", file));
const quiet = { log() { }, info() { }, warn() { }, error() { }, debug() { } };

/**
 * The config of a sample by its key in ConfigPaths, or of a config file by its path; `belts_do_not_move` turns
 * `overrides.non_moving_belts` on. SEARCH=1 in the environment turns `overrides.search_for_fewer_wake_ups` on for
 * every script: the four searches then run for every sample, and not only where no other clock is stable.
 */
async function loadSample(key, belts_do_not_move = false) {
    const { ConfigPaths } = dist("config/config-paths.js");
    const { loadConfigFromFile } = dist("config/loader.js");
    if (ConfigPaths[key] === undefined && !key.endsWith(".json")) {
        throw new Error(`No sample ${key}. Samples: ${Object.keys(ConfigPaths).join(", ")}`);
    }
    const config = await loadConfigFromFile(ConfigPaths[key] ?? path.resolve(INVOKED_FROM, key));
    if (belts_do_not_move) {
        config.overrides = { ...config.overrides, non_moving_belts: true };
    }
    if (process.env.SEARCH === "1") {
        config.overrides = { ...config.overrides, search_for_fewer_wake_ups: true };
    }
    return config;
}

module.exports = { ROOT, dist, quiet, loadSample };
