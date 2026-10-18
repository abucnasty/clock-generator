// Native Factorio PNG -> compressed documentation JPEG. No mechanic tests or clock searches are run.
const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { parseArgs } = require("node:util");
const { screenshotFrame, compressScreenshot, JPEG_QUALITY } = require("../tests/game/helpers/scaffold-screenshot");
const catalog = require("../tests/game/mechanics/screenshots.json");
const ROOT = path.resolve(__dirname, "..");
const MECHANICS = path.join(ROOT, "tests/game/mechanics");
const METADATA = path.join(MECHANICS, "screenshots.generated.json");
// Increment when capture defaults/framing change, so existing images are regenerated.
const CAPTURE_RECIPE = 2;
const exists = file => fs.access(file).then(() => true, () => false);

async function main() {
    const { values } = parseArgs({ options: {
        all: { type: "boolean" }, case: { type: "string" }, list: { type: "boolean" },
        refresh: { type: "boolean" }, "work-dir": { type: "string" }, help: { type: "boolean" },
    } });
    if (values.help) {
        console.log("npm run screenshots -- --list | --case=<id> | --all [--refresh] [--work-dir=<empty-directory>]\n"
            + "Captures only missing or stale JPEGs by default. Requires graphical Factorio; opens and closes its own client.");
        return;
    }
    if (values.list) { for (const item of catalog) console.log(`${item.id} -> ${item.image}`); return; }
    if (Boolean(values.all) === Boolean(values.case)) throw new Error("Choose --case=<id> or --all; use --list to inspect the catalog");
    const selected = catalog.filter(item => values.all || item.id === values.case);
    if (!selected.length) throw new Error(`Unknown screenshot case: ${values.case}`);
    const metadata = await fs.readFile(METADATA, "utf8").then(JSON.parse).catch(error => {
        if (error.code !== "ENOENT") throw error;
        return {};
    });
    const pending = [];
    for (const item of selected) {
        const blueprint = await fs.readFile(path.resolve(MECHANICS, item.blueprint), "utf8");
        const hash = createHash("sha256").update(blueprint).digest("hex");
        const previous = metadata[item.id];
        if (!values.refresh && previous?.source_sha256 === hash && previous.capture_recipe === CAPTURE_RECIPE
            && previous.jpeg_quality === JPEG_QUALITY && await exists(path.join(MECHANICS, item.image))) {
            console.log(`Current: ${item.id}`);
        } else pending.push({ ...item, source: blueprint, hash });
    }
    if (!pending.length) { console.log("All selected screenshots are current; Factorio was not started."); return; }
    try { process.loadEnvFile(path.join(ROOT, ".env")); } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (!process.env.FACTORIO_PATH || !process.env.FACTORIO_HARNESS_SAVE) throw new Error("Set FACTORIO_PATH and FACTORIO_HARNESS_SAVE in .env");
    const work = path.resolve(values["work-dir"] ?? path.join(ROOT, "../work/mechanics-screenshots", new Date().toISOString().replace(/[:.]/g, "-")));
    if (await exists(work) && (await fs.readdir(work)).length) throw new Error("Choose an empty --work-dir; previous captures will not be overwritten");
    require("../dist/data/factorio-data-file");
    const { HarnessSession } = require("../dist/harness/factorio-harness");
    const session = await HarnessSession.start({
        factorio: process.env.FACTORIO_PATH, save: path.resolve(ROOT, process.env.FACTORIO_HARNESS_SAVE),
        work_dir: work, watch: true, watch_debug: false, timeout_seconds: 180, log: console.error,
    });
    let failed = true;
    try {
        for (const [index, item] of pending.entries()) {
            console.log(`Capturing: ${item.id}`);
            const result = await session.record({
                blueprint: item.source, out: path.join(work, `recording-${index}.json`), ticks: 1,
                warmup_ticks: 600, settle_ticks: 0, seed: [], unclocked: true, game_speed: 100,
                timeout_seconds: 180, log: console.error,
            });
            const frame = screenshotFrame(result.build.area);
            const png = await session.takeScreenshot({ ...frame, surface: result.build.surface, path: `scaffold-${index}.png` });
            const image = await compressScreenshot(png, path.join(MECHANICS, item.image));
            metadata[item.id] = { blueprint: item.blueprint, image: item.image, source_sha256: item.hash,
                factorio_version: result.recording.factorio_version, capture_recipe: CAPTURE_RECIPE,
                warmup_ticks: 600, unclocked: true, ...frame, ...image };
            await fs.writeFile(METADATA, JSON.stringify(metadata, null, 2) + "\n");
            console.log(`Wrote ${item.image}: ${image.width}×${image.height}, ${Math.round(image.jpeg_bytes / 1024)} KiB JPEG from ${Math.round(image.png_bytes / 1024)} KiB PNG`);
        }
        failed = false;
    } finally { await session.close(failed); }
    console.log(`Native PNGs, recordings and logs retained in ${work}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
