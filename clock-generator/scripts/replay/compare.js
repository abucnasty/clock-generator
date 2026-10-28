// compare.js: the replay check's verdict (scripts/replay/replay.sh). Lays the results of a replay (one JSON per job,
// replay.js's) against the base's and says, per job, equal or where it first differs: the run (asbuilt, plan, speed,
// losses, in that order; the losses only where both sides ran them), the first period whose hash differs and the signals that differ in it (or the figures, or an
// error that is new, gone or changed). Then the speed figures: the median job's ticks per second of the speed run against
// the base's, and the scavenges per million ticks. Exits 1 when a job differs or is missing.
//
//   node compare.js <base-results> <results> [--json <file>]
//   node compare.js --dumps <base-dump.json> <dump.json>
//       two dumps of one period of one run (replay.js --dump): the first tick at which a signal differs, and the entity,
//       with both sides' values from there
'use strict';
const fs = require('fs');
const path = require('path');

const RUN_ORDER = ['asbuilt', 'plan', 'speed', 'losses'];
const SHOWN = 8;

function load(dir) {
    const out = new Map();
    for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith('.json') || file.startsWith('_') || file.startsWith('.')) continue;
        const result = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
        out.set(result.key, result);
    }
    return out;
}

/** Where run `b` first differs from run `a`, or null where they are the same */
function differenceOf(a, b) {
    if (!a && !b) return null;
    if (!a || !b) return { what: a ? 'run gone' : 'run new' };
    if (a.error || b.error) return a.error === b.error ? null : { what: 'error', base: a.error ?? null, now: b.error ?? null };
    const names = [...new Set([...Object.keys(a.signals), ...Object.keys(b.signals)])].sort();
    const gone = names.filter(n => !(n in b.signals)), added = names.filter(n => !(n in a.signals));
    if (gone.length || added.length) return { what: 'signals', gone: gone.slice(0, SHOWN), added: added.slice(0, SHOWN), gone_count: gone.length, added_count: added.length };
    const whole = names.filter(n => !Array.isArray(a.signals[n]) && a.signals[n] !== b.signals[n]);
    const periods = Math.max(a.periods.length, b.periods.length);
    for (let p = 0; p < periods; p++) {
        if (a.periods[p] === b.periods[p]) continue;
        const differ = names.filter(n => Array.isArray(a.signals[n]) && a.signals[n][p] !== b.signals[n]?.[p]);
        return { what: 'period', period: p, periods, signals: differ.slice(0, SHOWN), signal_count: differ.length,
            ...(whole.length && { whole: whole.slice(0, SHOWN) }) };
    }
    if (whole.length) return { what: 'whole', signals: whole.slice(0, SHOWN), signal_count: whole.length };
    return null;
}

const median = list => {
    const sorted = list.filter(x => x !== null && Number.isFinite(x)).sort((x, y) => x - y);
    if (!sorted.length) return null;
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** The first tick and signal at which two dumps of one period differ */
function explain(a_file, b_file) {
    const a = JSON.parse(fs.readFileSync(a_file, 'utf8')), b = JSON.parse(fs.readFileSync(b_file, 'utf8'));
    const firsts = [];
    for (const name of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
        const x = a[name], y = b[name];
        if (JSON.stringify(x) === JSON.stringify(y)) continue;
        if (!Array.isArray(x) || !Array.isArray(y)) { firsts.push({ name, at: -1, base: x, now: y }); continue; }
        let i = 0;
        while (i < Math.max(x.length, y.length) && JSON.stringify(x[i]) === JSON.stringify(y[i])) i++;
        // a series is one value per tick of the period; events are rows that start with their tick
        const event = Array.isArray(x[i] ?? y[i]);
        firsts.push({ name, at: event ? (x[i] ?? y[i])[0] : i, kind: event ? 'event tick' : 'tick of the period',
            base: x.slice(i, i + 5), now: y.slice(i, i + 5) });
    }
    firsts.sort((p, q) => p.at - q.at);
    if (!firsts.length) { console.log('the dumps are the same'); return 0; }
    for (const f of firsts.slice(0, 12)) console.log(`${f.name} first differs at ${f.kind ?? 'figures'} ${f.at}: base ${JSON.stringify(f.base)} now ${JSON.stringify(f.now)}`);
    if (firsts.length > 12) console.log(`... ${firsts.length - 12} more signals differ`);
    return 1;
}

function main() {
    const argv = process.argv.slice(2);
    if (argv[0] === '--dumps') process.exit(explain(argv[1], argv[2]));
    const json = argv.indexOf('--json') >= 0 ? argv.splice(argv.indexOf('--json'), 2)[1] : undefined;
    const [base_dir, now_dir] = argv;
    if (!base_dir || !now_dir) throw new Error('compare.js <base-results> <results> [--json <file>]');
    const base = load(base_dir), now = load(now_dir);
    const jobs = [...new Set([...base.keys(), ...now.keys()])].sort();
    const report = { equal: 0, differ: [], missing: [], extra: [] };
    const speed = [], scavenges_base = [], scavenges_now = [];
    for (const key of jobs) {
        const a = base.get(key), b = now.get(key);
        if (!b) { report.missing.push(key); continue; }
        if (!a) { report.extra.push(key); continue; }
        let first = null;
        for (const run of RUN_ORDER) {
            // the loss runs are compared where both sides made them (replay.sh --losses); every other run always
            if (run === 'losses' && (!a.runs.losses || !b.runs.losses)) continue;
            const difference = differenceOf(a.runs[run], b.runs[run]);
            if (difference) { first = { run, ...difference }; break; }
        }
        if (first) report.differ.push({ key, ...first });
        else report.equal++;
        const sa = a.runs.speed?.perf, sb = b.runs.speed?.perf;
        if (sa?.ticks_per_second && sb?.ticks_per_second) speed.push(sb.ticks_per_second / sa.ticks_per_second);
        for (const run of ['asbuilt', 'plan', 'speed']) {
            if (a.runs[run]?.perf) scavenges_base.push(a.runs[run].perf.scavenges);
            if (b.runs[run]?.perf) scavenges_now.push(b.runs[run].perf.scavenges);
        }
    }
    const sum = list => list.reduce((x, y) => x + y, 0);
    report.speed = {
        jobs: speed.length,
        median_ticks_per_second_ratio: speed.length ? Math.round(median(speed) * 1000) / 1000 : null,
        scavenges_base: sum(scavenges_base), scavenges_now: sum(scavenges_now),
    };
    for (const d of report.differ) {
        const { key, run, what, ...rest } = d;
        console.log(`DIFFERS ${key}: ${run}, ${what} ${JSON.stringify(rest)}`);
    }
    for (const key of report.missing) console.log(`MISSING ${key}: no result`);
    for (const key of report.extra) console.log(`EXTRA   ${key}: not in the base`);
    console.log(`${report.equal} of ${jobs.length} jobs equal, ${report.differ.length} differ, ${report.missing.length} missing`
        + `; speed run: median ticks/s ${report.speed.median_ticks_per_second_ratio ?? '-'} x the base's over ${speed.length} jobs`
        + `; scavenges ${report.speed.scavenges_now} (base ${report.speed.scavenges_base})`);
    if (json) fs.writeFileSync(json, JSON.stringify(report, null, 1));
    process.exit(report.differ.length || report.missing.length ? 1 : 0);
}

main();
