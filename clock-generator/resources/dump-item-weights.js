// node resources/dump-item-weights.js <out.json>
//
// Every item's weight as the running game holds it, for filter-raw.js (--weights). The data dump names a weight only
// where a mod sets one; the game works out the others when it loads. This starts the harness's game (FACTORIO_PATH and
// FACTORIO_HARNESS_SAVE from .env, as the game tests read them; `npm run build` first), asks it for
// `prototypes.item[name].weight` of every item and writes them as { name: weight }. Nothing in the install is written to.
const fs = require("fs/promises");
const path = require("path");

const ROOT = path.join(__dirname, "..");

function loadEnv() {
    try {
        process.loadEnvFile(path.join(ROOT, ".env"));
    } catch {
        // the variables may be set already
    }
}

async function main() {
    const out = process.argv[2];
    if (!out) {
        throw new Error("usage: node resources/dump-item-weights.js <out.json>");
    }
    loadEnv();
    if (!process.env.FACTORIO_PATH) {
        throw new Error("FACTORIO_PATH is not set (in .env or the environment)");
    }
    const { HarnessSession } = require(path.join(ROOT, "dist", "harness", "factorio-harness.js"));
    const save = path.resolve(ROOT, process.env.FACTORIO_HARNESS_SAVE ?? "resources/clock_generator_staging.zip");
    const session = await HarnessSession.start({ factorio: process.env.FACTORIO_PATH, save, timeout_seconds: 120, log: () => { } });
    try {
        const answer = await session["command"]("/sc local w = {} for name, item in pairs(prototypes.item) do w[name] = item.weight end "
            + "rcon.print(helpers.table_to_json(w))");
        const weights = JSON.parse(answer);
        await fs.writeFile(out, JSON.stringify(weights, null, 2) + "\n");
        console.log(`${Object.keys(weights).length} item weights written to ${out}`);
    } finally {
        await session.close();
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
