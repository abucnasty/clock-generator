#!/usr/bin/env node
// Rewrites ci/record-durations.json, which deals the blast jobs out to the record check's CI shards by duration
// (scripts/blast/shard.py), from the job files of a run: the record-jobs-<n> artifacts of the Test workflow
// (`gh run download <run> -p 'record-jobs-*'`), each job file holding the seconds its job took. Usage:
//   node scripts/ci/update-record-durations.js <directory with the downloaded artifacts> [more directories, of other runs]
//   node scripts/ci/update-record-durations.js --shards     only prints the shard count the durations call for
// Either way it prints the record shard count (the `record-shards` matrix of .github/workflows/test.yml): the smallest count whose estimated
// slowest shard is the slowest job, so that more shards would not make the pull request wait less. A shard is estimated as the seconds of
// its jobs, dealt longest first onto the shard with the fewest seconds so far (the dealing of scripts/blast/shard.py, which also weighs
// the four jobs a runner takes at a time: this is the more cautious of the two). Set the matrix to the count it prints.
// A job in several runs gets their median (one run on a slow runner is not to set the figure). A job that is in no run keeps its old
// figure if it is still in the record; a job no longer in the record (record/<job>.json) is dropped.
const fs = require('node:fs');
const path = require('node:path');

const packageDir = path.resolve(__dirname, '..', '..');
const target = path.join(packageDir, 'ci', 'record-durations.json');
const dirs = process.argv.slice(2);

// the smallest shard count whose slowest shard is estimated no slower than the slowest job (which no count can beat)
const shardCount = durations => {
    const seconds = Object.values(durations).sort((a, b) => b - a);
    if (seconds.length === 0) return 1;
    for (let count = 1; ; count++) {
        const load = new Array(count).fill(0);
        for (const s of seconds) load[load.indexOf(Math.min(...load))] += s;
        if (Math.max(...load) <= seconds[0]) return count;
    }
};
const reportShardCount = durations => console.log(`Record shards: ${shardCount(durations)} (the smallest count whose estimated slowest shard is the slowest job, ${Math.max(...Object.values(durations))} s); set the matrix of record-shards in .github/workflows/test.yml to it`);
if (dirs[0] === '--shards') {
    reportShardCount(JSON.parse(fs.readFileSync(target, 'utf8')));
    process.exit(0);
}
if (dirs.length === 0) {
    console.error('Usage: node scripts/ci/update-record-durations.js <directory with the record-jobs-<n> artifacts> [...] | --shards');
    process.exit(2);
}

const median = values => {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = sorted.length >> 1;
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const files = [];
for (const dir of dirs) (function find(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) find(file);
        else if (entry.name.endsWith('.json') && !entry.name.startsWith('_')) files.push(file);
    }
})(dir);
if (files.length === 0) {
    console.error(`No job file under ${dirs.join(', ')}`);
    process.exit(1);
}

const durations = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : {};
const measured = {};
for (const file of files) {
    const job = path.basename(file, '.json');
    const { seconds } = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof seconds === 'number' && fs.existsSync(path.join(packageDir, 'record', `${job}.json`))) (measured[job] ??= []).push(seconds);
}
for (const [job, times] of Object.entries(measured)) durations[job] = Math.round(median(times) * 10) / 10;
const kept = Object.fromEntries(Object.entries(durations).filter(([job]) => fs.existsSync(path.join(packageDir, 'record', `${job}.json`))).sort(([a], [b]) => (a < b ? -1 : 1)));
fs.writeFileSync(target, JSON.stringify(kept, null, 1) + '\n');
console.log(`${Object.keys(kept).length} jobs from ${files.length} job files, written to ${target}`);
reportShardCount(kept);
