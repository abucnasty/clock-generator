#!/usr/bin/env node
// Rewrites ci/generation-durations.json, which deals the generation test files out to the CI shards by duration
// (ci/duration-sequencer.ts), from the vitest JSON reports of a run: the generation-test-results-<n> artifacts of
// the Test workflow (`gh run download <run> -p 'generation-test-results-*'`). Usage:
//   node scripts/ci/update-generation-durations.js <directory with the downloaded artifacts>
// A file that is in no report keeps its old figure if it still exists; a file in the reports no longer on disk is dropped.
const fs = require('node:fs');
const path = require('node:path');

const packageDir = path.resolve(__dirname, '..', '..');
const target = path.join(packageDir, 'ci', 'generation-durations.json');
const reportsDir = process.argv[2];
if (!reportsDir) {
    console.error('Usage: node scripts/ci/update-generation-durations.js <directory with the generation.json reports>');
    process.exit(2);
}

const reports = [];
(function find(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) find(file);
        else if (entry.name === 'generation.json') reports.push(file);
    }
})(reportsDir);
if (reports.length === 0) {
    console.error(`No generation.json under ${reportsDir}`);
    process.exit(1);
}

const durations = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : {};
for (const report of reports) {
    for (const result of JSON.parse(fs.readFileSync(report, 'utf8')).testResults) {
        // the path from the package: the run's checkout is at another place than this one
        const key = result.name.slice(result.name.indexOf('/src/') + 1);
        if (fs.existsSync(path.join(packageDir, key))) durations[key] = Math.round((result.endTime - result.startTime) / 100) / 10;
    }
}
const kept = Object.fromEntries(Object.entries(durations).filter(([key]) => fs.existsSync(path.join(packageDir, key))).sort(([a], [b]) => (a < b ? -1 : 1)));
fs.writeFileSync(target, JSON.stringify(kept, null, 1) + '\n');
console.log(`${Object.keys(kept).length} files from ${reports.length} reports, written to ${target}`);
