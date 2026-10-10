// Shared by the scripts in this folder. They read the built generator (`npx tsc` first) from this checkout, or from
// the checkout CLOCK_GENERATOR_ROOT names: a worktree of another commit, to sweep it as a baseline.
const path = require("path");

const ROOT = path.resolve(process.env.CLOCK_GENERATOR_ROOT ?? path.join(__dirname, ".."));
// the generator reads resources/ relative to where it runs
process.chdir(ROOT);

const dist = file => require(path.join(ROOT, "dist", file));
const quiet = { log() { }, info() { }, warn() { }, error() { }, debug() { } };

/** The config of a sample by its key in ConfigPaths; `belts_do_not_move` turns `overrides.non_moving_belts` on */
async function loadSample(key, belts_do_not_move = false) {
    const { ConfigPaths } = dist("config/config-paths.js");
    const { loadConfigFromFile } = dist("config/loader.js");
    if (ConfigPaths[key] === undefined) {
        throw new Error(`No sample ${key}. Samples: ${Object.keys(ConfigPaths).join(", ")}`);
    }
    const config = await loadConfigFromFile(ConfigPaths[key]);
    if (belts_do_not_move) {
        config.overrides = { ...config.overrides, non_moving_belts: true };
    }
    return config;
}

module.exports = { ROOT, dist, quiet, loadSample };
