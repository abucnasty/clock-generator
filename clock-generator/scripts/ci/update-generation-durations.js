#!/usr/bin/env node
// Rewrites ci/generation-durations.json, which deals the generation test files out to the CI shards by duration
// (ci/duration-sequencer.ts), from the JUnit reports of a run: the generation-test-results-<n> artifacts of
// the Test workflow (`gh run download <run> -p 'generation-test-results-*'`). Usage:
//   node scripts/ci/update-generation-durations.js <directory with the downloaded artifacts> [more directories, of other runs]
// A file in several reports (of several runs) gets their median (one run of a shard that was starved of CPU is not to set the figure).
// A file that is in no report keeps its old figure if it still exists; a file in the reports no longer on disk is dropped.
const fs = require('node:fs');
const path = require('node:path');

const packageDir = path.resolve(__dirname, '..', '..');
const target = path.join(packageDir, 'ci', 'generation-durations.json');
const reportsDirs = process.argv.slice(2);
if (reportsDirs.length === 0) {
    console.error('Usage: node scripts/ci/update-generation-durations.js <directory with the generation.xml reports> [...]');
    process.exit(2);
}

const median = values => {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = sorted.length >> 1;
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const reports = [];
for (const dir of reportsDirs) (function find(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) find(file);
        else if (entry.name === 'generation.xml') reports.push(file);
    }
})(dir);
if (reports.length === 0) {
    console.error(`No generation.xml under ${reportsDirs.join(', ')}`);
    process.exit(1);
}

const durations = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : {};
const measured = {};
for (const report of reports) {
    for (const [, name, time] of fs.readFileSync(report, 'utf8').matchAll(/<testsuite name="([^"]+)"[^>]*? time="([\d.]+)"/g)) {
        // the path from the package, which the report gives already
        if (fs.existsSync(path.join(packageDir, name))) (measured[name] ??= []).push(Number(time));
    }
}
for (const [name, times] of Object.entries(measured)) durations[name] = Math.round(median(times) * 10) / 10;
const kept = Object.fromEntries(Object.entries(durations).filter(([key]) => fs.existsSync(path.join(packageDir, key))).sort(([a], [b]) => (a < b ? -1 : 1)));
fs.writeFileSync(target, JSON.stringify(kept, null, 1) + '\n');
console.log(`${Object.keys(kept).length} files from ${reports.length} reports, written to ${target}`);
