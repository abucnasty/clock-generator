// check.cjs <expected-hashes.txt> <capture root or generation dir>...
// Prints per case: hash check, selection, and (for a capture) baseline misses and recovered periods.
// expected-hashes.txt: "<case name> <first 12 hex of sha256(JSON.stringify(clock))>" per line, e.g. from a preflight
// (run-lane.sh -m generate) on the frozen head, checked against the blast's selected clocks before any native run.
// A capture root is BELT_SPEED_CAPTURE_DIR (<root>/<lane>/<case>/generated-clock.json and summary.json); a
// generation dir is BELT_CLOCK_GENERATION_DIR (<dir>/<case>.json).
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const [expectedFile, ...roots] = process.argv.slice(2);
if (!expectedFile || roots.length === 0) {
    console.error("usage: node check.cjs <expected-hashes.txt> <capture root or generation dir>...");
    process.exit(2);
}
const expected = Object.fromEntries(fs.readFileSync(expectedFile, "utf8").trim().split("\n").map(line => line.trim().split(/\s+/)));
for (const root of roots) for (const entry of fs.readdirSync(root).sort()) {
    const full = path.join(root, entry);
    const cacheFile = entry.endsWith(".json") && fs.statSync(full).isFile();
    const name = cacheFile ? entry.slice(0, -5) : entry;
    const clockFile = cacheFile ? full : path.join(full, "generated-clock.json");
    if (!fs.existsSync(clockFile)) continue;
    const prepared = JSON.parse(fs.readFileSync(clockFile, "utf8"));
    const hash = crypto.createHash("sha256").update(JSON.stringify(prepared.clock)).digest("hex").slice(0, 12);
    const out = [name, hash === expected[name] ? "hash ok" : `HASH ${hash}, expected ${expected[name]}`,
        `${prepared.selection?.id} @${prepared.period} ${prepared.generationVerdict} holds ${prepared.selection?.holds} supply ${prepared.selection?.supply}`];
    if (!cacheFile) {
        const summaryFile = path.join(full, "summary.json");
        if (!fs.existsSync(summaryFile)) out.push("NO SUMMARY");
        else {
            const s = JSON.parse(fs.readFileSync(summaryFile, "utf8"));
            out.push(`expected ${s.expected}`, `baseline misses ${s.baseline.filter(items => items !== s.expected).length} of ${s.baseline.length}`,
                `recovered ${s.recovery.map(loss => loss.recovered.join("/")).join(" | ")}`);
        }
    }
    console.log(out.join("  "));
}
