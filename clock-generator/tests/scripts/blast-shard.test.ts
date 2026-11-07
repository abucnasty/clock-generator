// scripts/blast/shard.py: the blast's jobs dealt out to the record check's CI shards by measured seconds, and the shards' job files
// joined again into the folder `record check` reads (the whole check sharded passes, and a changed record fails it with the table).
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { afterAll, describe, expect, it } from 'vitest';
import { moduleSha256 as checksSha256 } from '../game/builds/record-job-checks';

const shardPy = path.resolve(__dirname, '../../scripts/blast/shard.py');
const recordPy = path.resolve(__dirname, '../../scripts/blast/record.py');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'blast-shard-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const sha = (c: string) => c.repeat(64);
const py = (script: string, ...args: string[]) => spawnSync('python3', [script, ...args], { encoding: 'utf8' });
const shard = (...args: string[]) => py(shardPy, ...args);

let count = 0;
const fresh = (kind: string) => path.join(tmp, `${kind}${count++}`);

/** Job names and their seconds on a CI runner; group is `config` for all but the ones named in `others` */
const SECONDS: Record<string, number> = { HUGE: 900, BIG: 400, MID1: 120, MID2: 110, S1: 30, S2: 25, S3: 20, S4: 15, S5: 10, S6: 5 };
const key = (name: string) => `${name === 'S6' ? 'variants' : 'config'}-${name}`;

const listFile = (names = Object.keys(SECONDS)) => {
    const file = fresh('jobs') + '.json';
    fs.writeFileSync(file, JSON.stringify({ format: 't1-blast-3', jobs_sha256: sha('a'), jobs: names.map(name => ({ key: key(name), group: key(name).split('-')[0], name, config_sha256: sha('c') })) }));
    return file;
};
const durationsFile = (seconds: Record<string, number> = SECONDS) => {
    const file = fresh('durations') + '.json';
    fs.writeFileSync(file, JSON.stringify(Object.fromEntries(Object.entries(seconds).map(([name, s]) => [key(name), s]))));
    return file;
};

const select = (jobs: string, durations: string, index: number, count: number, write?: string) =>
    shard('select', jobs, durations, `${index}/${count}`, ...(write ? ['--write', write] : []));

describe('shard.py select: the split', () => {
    it('gives every job to one shard and no job to two, whatever the order of the job list', () => {
        const durations = durationsFile();
        const names = Object.keys(SECONDS);
        for (const jobs of [listFile(names), listFile([...names].reverse())]) {
            const dealt = [1, 2, 3].flatMap(i => select(jobs, durations, i, 3).stdout.trim().split(','));
            expect(dealt.sort()).toEqual([...names].sort());
        }
        const a = [1, 2, 3].map(i => select(listFile(names), durations, i, 3).stdout);
        const b = [1, 2, 3].map(i => select(listFile([...names].reverse()), durations, i, 3).stdout);
        expect(a).toEqual(b);
    });

    it('gives the longest jobs a shard each, so that the shards finish together', () => {
        const plan = shard('plan', listFile(), durationsFile(), '3');
        expect(plan.status, plan.stderr).toBe(0);
        const lines = plan.stdout.trim().split('\n');
        expect(lines[0]).toContain('HUGE');
        // the slowest shard is the longest job alone on its runner, and no other shard is slower
        expect(lines.at(-1)).toContain('slowest shard about 900.0 s');
        expect(lines.at(-1)).toContain('1635.0 job-s in all');
        const picked = select(listFile(), durationsFile(), 1, 3).stdout.trim().split(',');
        expect(picked).toContain('HUGE');
    });

    it('counts a job that is not in the durations as the median job, and still runs it', () => {
        const names = [...Object.keys(SECONDS), 'NEW'];
        const dealt = [1, 2, 3].flatMap(i => select(listFile(names), durationsFile(), i, 3).stdout.trim().split(','));
        expect(dealt.sort()).toEqual([...names].sort());
    });

    it('selects by name, as BLAST_ONLY takes it, and refuses a name two groups share', () => {
        const file = listFile();
        const twice = JSON.parse(fs.readFileSync(file, 'utf8'));
        twice.jobs.push({ key: 'pickup-S1', group: 'pickup', name: 'S1', config_sha256: sha('c') });
        fs.writeFileSync(file, JSON.stringify(twice));
        const done = select(file, durationsFile(), 1, 3);
        expect(done.status).toBe(1);
        expect(done.stderr).toContain('the name S1 is in two groups');
    });

    it('refuses a shard outside 1..count', () => {
        for (const bad of ['0/3', '4/3', 'x']) expect(shard('select', listFile(), durationsFile(), bad).status).toBe(1);
    });
});

describe('the committed split', () => {
    it('deals every job of the committed record to a shard, with the committed durations', () => {
        const record = path.resolve(__dirname, '../../record');
        const jobs = fs.readdirSync(record).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(record, f), 'utf8')));
        const file = fresh('jobs') + '.json';
        fs.writeFileSync(file, JSON.stringify({ jobs: jobs.map(j => ({ key: j.job, group: j.group, name: j.name })) }));
        const durations = path.resolve(__dirname, '../../ci/record-durations.json');
        const dealt = [1, 2, 3, 4, 5, 6, 7, 8].flatMap(i => {
            const done = select(file, durations, i, 8);
            expect(done.status, done.stderr).toBe(0);
            return done.stdout.trim().split(',');
        });
        expect(dealt.sort()).toEqual(jobs.map(j => j.name).sort());
    });
});

/** A job file as the blast writes it, with the record's fields; `rate` is what a test changes */
const alternative = (rate = 640) => ({
    id: 'even-hands', verdict: 'stable', holds: true, rate, supply: null, window_cycle_ticks: 972, wake_ups: 889.07, clock_sha256: sha('a'), text_sha256: sha('2'),
    descriptions_cut: 0, windows_sha256: sha('7'), windows: { 'inserter:1': [{ start: 0, end: 10 }] }, results_sha256: sha('3'), results: {},
});
const jobFile = (name: string, rate?: number) => ({
    group: key(name).split('-')[0], name, selected_index: 0, results_sha256: sha('4'), job_results: { results_sha256: sha('5'), results: {} },
    selected: alternative(rate), alternatives: [alternative(rate)], seconds: SECONDS[name],
    properties: { module_sha256: spawnSync('sha256sum', [path.resolve(__dirname, '../game/builds/record-properties.ts')], { encoding: 'utf8' }).stdout.split(' ')[0], seconds: 0.1, problems: [], checked: { 'always-on-reasons-named': 1 } },
    checks: { module_sha256: checksSha256(), seconds: 0.1, ran: [], failures: [] },
});

/** What `blast.sh run --shard i/count` leaves in a folder: the shard's job files, its job list and its record of the split */
const runShards = (count: number, rate: (name: string) => number | undefined = () => undefined) => {
    const jobs = listFile();
    const durations = durationsFile();
    return Array.from({ length: count }, (_, i) => {
        const dir = fresh('shard');
        fs.mkdirSync(dir);
        const names = select(jobs, durations, i + 1, count, path.join(dir, '_shard.json')).stdout.trim().split(',');
        for (const name of names) fs.writeFileSync(path.join(dir, `${key(name)}.json`), JSON.stringify(jobFile(name, rate(name))));
        fs.writeFileSync(path.join(dir, '_jobs.json'), JSON.stringify({
            format: 't1-blast-3', only: names, count: names.length, jobs: names.map(name => ({ key: key(name), group: key(name).split('-')[0], name, config_sha256: sha('c') })),
        }));
        return dir;
    });
};
const merge = (out: string, dirs: string[]) => shard('merge', out, ...dirs);

describe('shard.py merge and the record check on the joined shards', () => {
    it('joins the shards into one folder of every job file and one job list', () => {
        const out = fresh('whole');
        const done = merge(out, runShards(3));
        expect(done.status, done.stderr).toBe(0);
        expect(done.stdout).toContain('joined 3 shards, 10 jobs');
        expect(done.stdout).toMatch(/shard 1\/3: {2}1 jobs, {3}900\.0 job-s; longest config-HUGE/);
        expect(fs.readdirSync(out).filter(f => !f.startsWith('_')).sort()).toEqual(Object.keys(SECONDS).map(n => `${key(n)}.json`).sort());
        const list = JSON.parse(fs.readFileSync(path.join(out, '_jobs.json'), 'utf8'));
        expect(list.jobs.map((j: { key: string }) => j.key)).toEqual(Object.keys(SECONDS).map(key).sort());
        expect(list.count).toBe(10);
    });

    it('passes the record check with zero differences on the record written from the same jobs, and fails a changed record with the table', () => {
        const whole = fresh('whole');
        expect(merge(whole, runShards(3)).status).toBe(0);
        const record = fresh('record');
        expect(py(recordPy, 'write', '--dir', record, whole).status).toBe(0);
        const same = py(recordPy, 'check', '--dir', record, whole);
        expect(same.status, same.stdout).toBe(0);
        expect(same.stdout).toContain('10 jobs, 10 alternatives: no difference');
        expect(same.stdout).toContain('properties checked on 10 jobs');
        // the same jobs sharded the other way make the same record
        const other = fresh('whole');
        expect(merge(other, runShards(4)).status).toBe(0);
        expect(py(recordPy, 'check', '--dir', record, other).status).toBe(0);
        // a record that is not what the shards made
        const file = path.join(record, 'config-MID1.json');
        fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('"rate": 640', '"rate": 641'));
        const changed = py(recordPy, 'check', '--dir', record, whole);
        expect(changed.status).toBe(1);
        const row = changed.stdout.split('\n').find(line => line.startsWith('config-MID1'))!;
        expect(row.split(/\s{2,}/)).toEqual(['config-MID1', 'alternatives[even-hands].rate', '641', '640']);
    });

    it('refuses a shard that is missing, one twice and a shard without the job file of one of its jobs', () => {
        const dirs = runShards(3);
        const missing = merge(fresh('whole'), dirs.slice(0, 2));
        expect(missing.status).toBe(1);
        expect(missing.stderr).toContain('shard 3 of 3 is missing');
        const twice = merge(fresh('whole'), [...dirs, dirs[0]]);
        expect(twice.status).toBe(1);
        expect(twice.stderr).toContain('shard 1 is in');
        const lost = fs.readdirSync(dirs[1]).find(f => !f.startsWith('_'))!;
        fs.rmSync(path.join(dirs[1], lost));
        const gone = merge(fresh('whole'), dirs);
        expect(gone.status).toBe(1);
        expect(gone.stderr).toContain(`has no result for ${lost.replace(/\.json$/, '')}`);
    });

    it('refuses shards of different splits, of different job lists, and a job file that is not its shard\'s', () => {
        const three = runShards(3);
        const four = runShards(4);
        expect(merge(fresh('whole'), [three[0], three[1], four[2]]).stderr).toContain('different sizes');
        const other = runShards(3);
        const record = JSON.parse(fs.readFileSync(path.join(other[0], '_shard.json'), 'utf8'));
        record.all = record.all.slice(1);
        fs.writeFileSync(path.join(other[0], '_shard.json'), JSON.stringify(record));
        expect(merge(fresh('whole'), other).stderr).toContain('different job lists');
        const stray = runShards(3);
        fs.writeFileSync(path.join(stray[0], 'config-ELSE.json'), '{}');
        expect(merge(fresh('whole'), stray).stderr).toContain('which is not its job');
    });
});
