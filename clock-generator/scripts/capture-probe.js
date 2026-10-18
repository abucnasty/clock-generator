// One manual capture using the same Lua composition and backed-up transformation as the game regressions.
// Run from clock-generator/: npm run probe -- --fixture=same-item --geometry=underground-exit --out=../work/probes/run-01
const fs = require("node:fs");
const path = require("node:path");
const { parseArgs } = require("node:util");
const { composeProbeSource } = require("../tests/game/helpers/probe-source");
const { makeInputBeltBackedUp } = require("../tests/game/mechanics/belt-pickup/belt-pickup-fixtures");
const ROOT = path.resolve(__dirname, "..");

async function main() {
    const { values } = parseArgs({ options: {
        fixture: { type: "string" }, geometry: { type: "string", default: "underground-exit" },
        item: { type: "string" }, out: { type: "string" }, help: { type: "boolean" },
    } });
    if (values.help) {
        console.log("npm run probe -- --fixture=<same-item|backed-up> --geometry=<straight-belt|underground-entrance|underground-exit> --out=<new-run-directory> [--item=<accumulator|supercapacitor>]");
        return;
    }
    if (!["same-item", "backed-up"].includes(values.fixture) || !values.out) throw new Error("Set --fixture=same-item|backed-up and --out=<new-run-directory>; use --help for all options.");
    if (!["straight-belt", "underground-entrance", "underground-exit"].includes(values.geometry)) throw new Error("Unsupported pickup geometry");
    const backedUp = values.fixture === "backed-up";
    if (backedUp ? !["accumulator", "supercapacitor"].includes(values.item) : values.item !== undefined) {
        throw new Error("Only backed-up captures take --item=accumulator|supercapacitor");
    }
    try { process.loadEnvFile(path.join(ROOT, ".env")); } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (!process.env.FACTORIO_PATH || !process.env.FACTORIO_HARNESS_SAVE) throw new Error("Set FACTORIO_PATH and FACTORIO_HARNESS_SAVE in .env or the environment");
    const run = path.resolve(values.out);
    if (fs.existsSync(run) && fs.readdirSync(run).length) throw new Error("Choose an empty run directory; existing captures will not be overwritten");
    const fixture = path.join(ROOT, "tests/game/mechanics/belt-pickup/fixtures", backedUp ? "different-items" : "same-item");
    const { loadConfigFromFile } = require("../dist/config/loader");
    const { recordInFactorio } = require("../dist/harness/factorio-harness");
    const config = await loadConfigFromFile(path.join(fixture, !backedUp && values.geometry === "straight-belt" ? "straight-belt.json" : "config.json"));
    const input = config.inserters.find(inserter => inserter.source.type === "belt");
    input.source.pickup_length = values.geometry === "straight-belt" ? 1 : 0.5;
    if (backedUp) {
        input.filters = [values.item];
        config.overrides = { ...config.overrides, backed_up_belts: true };
    }
    const original = fs.readFileSync(path.join(fixture, `${values.geometry}-scaffold.txt`), "utf8");
    const blueprint = backedUp ? makeInputBeltBackedUp(original) : original;
    const lua = composeProbeSource(path.join(fixture, backedUp ? "backed-up-probe.lua" : "probe.lua"), backedUp ? { item: values.item } : {});
    fs.mkdirSync(run, { recursive: true });
    fs.writeFileSync(path.join(run, "probe.generated.lua"), lua);
    fs.writeFileSync(path.join(run, "config.json"), JSON.stringify(config, null, 2) + "\n");
    fs.writeFileSync(path.join(run, "blueprint.txt"), blueprint.trim() + "\n");
    const result = await recordInFactorio({
        factorio: process.env.FACTORIO_PATH, save: path.resolve(ROOT, process.env.FACTORIO_HARNESS_SAVE),
        config, blueprint, lua, out: path.join(run, "recording.json"), work_dir: path.join(run, "game"),
        ticks: backedUp ? 1400 : 1260, warmup_ticks: backedUp ? 3600 : 1200, settle_ticks: 0,
        seed: [], unclocked: true, game_speed: 1000, watch: false, timeout_seconds: 180,
        log: message => console.error(message),
    });
    console.log(`Recording: ${result.recording_path}`);
    console.log(`Probe: ${path.join(run, "game/script-output", backedUp ? "backed-up-pickups.json" : "same-item-pickups.json")}`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
