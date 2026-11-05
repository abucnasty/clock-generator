// scripts/blast/record.py: the record (one small JSON per blast job) written from a run's job files, and the check that regenerates
// it and compares field by field, with a table of job, field, before and after when a field differs.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { afterAll, describe, expect, it } from 'vitest';

const record = path.resolve(__dirname, '../../scripts/blast/record.py');
const recordDir = path.resolve(__dirname, '../../record');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'blast-record-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const sha = (c: string) => c.repeat(64);
const run = (...args: string[]) => spawnSync('python3', [record, ...args], { encoding: 'utf8' });

interface Edit { id?: string; verdict?: string; period?: number; wake_ups?: number; clock?: string; windows?: Record<string, { start: number; end: number }[]> }
/** An alternative as the blast writes it (the fields the record reads, and the heavy ones it leaves out) */
const alternative = (e: Edit = {}) => ({
    id: e.id ?? 'even-hands', verdict: e.verdict ?? 'stable', holds: true, rate: 640, supply: null, period: e.period ?? 972,
    wake_ups: e.wake_ups ?? 889.0718254784936, clock_sha256: e.clock ?? sha('a'), text_sha256: sha('2'), descriptions_cut: 0,
    windows_sha256: sha('7'), windows: e.windows ?? { 'inserter:1': [{ start: 0, end: 10 }, { start: 54, end: 64 }], 'drill:1': [] },
    results_sha256: sha('3'), results: { label: sha('1'), assessment: sha('9') },
});
const jobFile = (name: string, alternatives = [alternative(), alternative({ id: 'plain', verdict: 'unstable', clock: sha('b') })], group = 'config') => ({
    group, name, selected_index: 0, results_sha256: sha('4'), job_results: { results_sha256: sha('5'), results: { ids: sha('6') } },
    selected: alternatives[0], alternatives, seconds: 12.5,
});

let count = 0;
/** A folder of job files (jobs[name]) and a _jobs.json with each config's hash */
const side = (jobs: Record<string, ReturnType<typeof jobFile>>, hashes: Record<string, string> = {}) => {
    const dir = path.join(tmp, `side${count++}`);
    fs.mkdirSync(dir);
    for (const [name, job] of Object.entries(jobs)) fs.writeFileSync(path.join(dir, `${job.group}-${name}.json`), JSON.stringify(job));
    const list = Object.entries(jobs).map(([name, job]) => ({ key: `${job.group}-${name}`, group: job.group, name, config_sha256: hashes[name] ?? sha('c') }));
    fs.writeFileSync(path.join(dir, '_jobs.json'), JSON.stringify({ format: 't1-blast-3', count: list.length, jobs: list }));
    return dir;
};
const folder = () => path.join(tmp, `record${count++}`);
const written = (jobs: Parameters<typeof side>[0], hashes?: Record<string, string>) => {
    const dir = folder();
    const done = run('write', '--dir', dir, side(jobs, hashes));
    expect(done.status, done.stderr).toBe(0);
    return dir;
};
const read = (dir: string, key: string) => JSON.parse(fs.readFileSync(path.join(dir, `${key}.json`), 'utf8'));

describe('record.py write', () => {
    it('projects a job: the selected clock and every alternative, windows as ranges, no seconds, no raw results', () => {
        const dir = written({ A: jobFile('A') });
        const text = fs.readFileSync(path.join(dir, 'config-A.json'), 'utf8');
        const body = JSON.parse(text);
        expect(body).toMatchObject({ format: 'clock-record-1', job: 'config-A', group: 'config', name: 'A', config_sha256: sha('c'), job_results_sha256: sha('5'), selected: 'even-hands' });
        expect(body.selected_windows).toEqual({ 'inserter:1': '0-10,54-64', 'drill:1': '' });
        expect(body.alternatives.map((a: any) => a.id)).toEqual(['even-hands', 'plain']);
        expect(Object.keys(body.alternatives[0])).toEqual(['id', 'verdict', 'holds', 'rate', 'supply', 'period', 'wake_ups', 'descriptions_cut', 'clock_sha256', 'windows_sha256', 'text_sha256', 'results_sha256']);
        expect(body.alternatives[0].wake_ups).toBe(889.072);
        expect(text).not.toContain('seconds');
        expect(text).not.toContain('"results"');
        expect(text.endsWith('}\n')).toBe(true);
    });

    it('writes the same text for the same run, and removes the record of a job the run does not have', () => {
        const dir = written({ A: jobFile('A'), B: jobFile('B') });
        const before = fs.readFileSync(path.join(dir, 'config-A.json'), 'utf8');
        const again = run('write', '--dir', dir, side({ A: jobFile('A') }));
        expect(again.status).toBe(0);
        expect(fs.readFileSync(path.join(dir, 'config-A.json'), 'utf8')).toBe(before);
        expect(fs.existsSync(path.join(dir, 'config-B.json'))).toBe(false);
    });

    it('refuses an incomplete run, which would delete the records of the jobs it lacks', () => {
        const dir = written({ A: jobFile('A'), B: jobFile('B') });
        const partial = side({ A: jobFile('A'), B: jobFile('B') });
        fs.rmSync(path.join(partial, 'config-B.json'));
        const done = run('write', '--dir', dir, partial);
        expect(done.status).toBe(1);
        expect(done.stderr).toContain('incomplete run: 1 listed jobs have no result (config-B)');
        expect(fs.existsSync(path.join(dir, 'config-B.json'))).toBe(true);
        expect(run('check', '--dir', dir, partial).status).toBe(1);
    });

    it('refuses a folder with no job and a run without a job list', () => {
        const empty = path.join(tmp, `side${count++}`);
        fs.mkdirSync(empty);
        expect(run('write', '--dir', folder(), empty).stderr).toContain('no job files');
        const noList = side({ A: jobFile('A') });
        fs.rmSync(path.join(noList, '_jobs.json'));
        expect(run('write', '--dir', folder(), noList).stderr).toContain('no _jobs.json');
    });
});

describe('record.py check', () => {
    it('passes on the record it wrote, whatever the seconds', () => {
        const dir = written({ A: jobFile('A'), B: jobFile('B') });
        const slower = jobFile('A'); slower.seconds = 99;
        const done = run('check', '--dir', dir, side({ A: slower, B: jobFile('B') }));
        expect(done.status).toBe(0);
        expect(done.stdout).toContain('2 jobs, 4 alternatives: no difference');
    });

    it('fails on one changed field of the record with a table of job, field, before and after', () => {
        const dir = written({ A: jobFile('A'), B: jobFile('B') });
        const body = read(dir, 'config-B');
        body.alternatives[1].period = 1000;
        fs.writeFileSync(path.join(dir, 'config-B.json'), JSON.stringify(body));
        const done = run('check', '--dir', dir, side({ A: jobFile('A'), B: jobFile('B') }));
        expect(done.status).toBe(1);
        const rows = done.stdout.split('\n').filter(line => line.startsWith('config-'));
        expect(rows).toHaveLength(1);
        expect(rows[0].split(/\s{2,}/)).toEqual(['config-B', 'alternatives[plain].period', '1000', '972']);
        expect(done.stdout).toContain('job  ');
        expect(done.stdout).toContain('1 differences in 1 of 2 jobs');
    });

    it('names a moved clock hash, a moved selection and a window that moved', () => {
        const dir = written({ A: jobFile('A') });
        const moved = jobFile('A', [alternative({ id: 'plain', verdict: 'unstable', clock: sha('d'), windows: { 'inserter:1': [{ start: 0, end: 11 }], 'drill:1': [] } }), alternative()]);
        const done = run('check', '--dir', dir, side({ A: moved }));
        expect(done.status).toBe(1);
        expect(done.stdout).toMatch(/config-A\s+selected\s+even-hands\s+plain/);
        expect(done.stdout).toMatch(/config-A\s+selected_windows\.inserter:1\s+0-10,54-64\s+0-11/);
        expect(done.stdout).toMatch(/config-A\s+alternatives \(ids, in order\)\s+even-hands plain\s+plain even-hands/);
    });

    it('names a job only in the record, a job only in the run, an alternative gained or lost', () => {
        const dir = written({ A: jobFile('A'), OLD: jobFile('OLD') });
        const done = run('check', '--dir', dir, side({ A: jobFile('A', [alternative()]), NEW: jobFile('NEW') }));
        expect(done.status).toBe(1);
        expect(done.stdout).toMatch(/config-NEW\s+\(job\)\s+\(absent\) in the record\s+in the run/);
        expect(done.stdout).toMatch(/config-OLD\s+\(job\)\s+in the record\s+\(absent\) in the run/);
        expect(done.stdout).toMatch(/config-A\s+alternatives\[plain\]\.clock_sha256\s+bbbbbbbbbbbb\.\.\s+\(absent\)/);
    });

    it('cuts a hash in the table to 12 characters and a long text with its length', () => {
        const dir = written({ A: jobFile('A') });
        const long = Array.from({ length: 30 }, (_, i) => ({ start: i * 100, end: i * 100 + 7 }));
        const done = run('check', '--dir', dir, side({ A: jobFile('A', [alternative({ clock: sha('e'), windows: { 'inserter:1': long, 'drill:1': [] } }), alternative({ id: 'plain', verdict: 'unstable', clock: sha('b') })]) }));
        expect(done.stdout).toMatch(/aaaaaaaaaaaa\.\.\s+eeeeeeeeeeee\.\./);
        expect(done.stdout).toMatch(/\.\. \(\d+ chars\)/);
    });

    it('appends the table to the summary file', () => {
        const dir = written({ A: jobFile('A') });
        const summary = path.join(tmp, `summary${count++}.md`);
        const done = run('check', '--dir', dir, '--summary', summary, side({ A: jobFile('A', [alternative({ period: 5 }), alternative({ id: 'plain', verdict: 'unstable', clock: sha('b') })]) }));
        expect(done.status).toBe(1);
        expect(fs.readFileSync(summary, 'utf8')).toContain('alternatives[even-hands].period');
    });

    it('refuses a run with no job and a folder with no record', () => {
        const empty = path.join(tmp, `side${count++}`);
        fs.mkdirSync(empty);
        expect(run('check', '--dir', written({ A: jobFile('A') }), empty).status).toBe(1);
        const noRecord = folder(); fs.mkdirSync(noRecord);
        expect(run('check', '--dir', noRecord, side({ A: jobFile('A') })).stderr).toContain('no records');
    });
});

describe('record.py check --map', () => {
    const mapFile = (text: string) => { const f = path.join(tmp, `map${count++}.txt`); fs.writeFileSync(f, text); return f; };

    it('compares a renamed job with its new name when nothing else moved', () => {
        const dir = written({ OLD: jobFile('OLD') });
        const done = run('check', '--dir', dir, '--map', mapFile('# a rename\nconfig-OLD   config-NEW # trailing\n'), side({ NEW: jobFile('NEW') }));
        expect(done.status, done.stdout).toBe(0);
        expect(done.stdout).toContain('renamed through the map: 1 jobs');
    });

    it('lists a renamed job whose config hash moved, and a map entry the record does not have', () => {
        const dir = written({ OLD: jobFile('OLD') });
        const done = run('check', '--dir', dir, '--map', mapFile('config-OLD config-NEW\nconfig-GONE config-ELSE\n'), side({ NEW: jobFile('NEW') }, { NEW: sha('f') }));
        expect(done.status).toBe(1);
        expect(done.stdout).toMatch(/config-NEW\s+config_sha256\s+cccccccccccc\.\.\s+ffffffffffff\.\./);
        expect(done.stdout).toContain("map entries not in the record: ['config-GONE']");
    });

    it('refuses a malformed map and two old names onto one new name', () => {
        const dir = written({ OLD: jobFile('OLD') });
        expect(run('check', '--dir', dir, '--map', mapFile('config-OLD\n'), side({ NEW: jobFile('NEW') })).stderr).toContain("expected 'old-job-key new-job-key'");
        expect(run('check', '--dir', dir, '--map', mapFile('a x\nb x\n'), side({ NEW: jobFile('NEW') })).stderr).toContain('both map to x');
    });
});

describe('the committed record', () => {
    const files = fs.existsSync(recordDir) ? fs.readdirSync(recordDir).filter(f => f.endsWith('.json')) : [];
    it('has one well-formed record per file', () => {
        expect(files.length).toBeGreaterThan(0);
        for (const file of files) {
            const body = JSON.parse(fs.readFileSync(path.join(recordDir, file), 'utf8'));
            expect(body.format, file).toBe('clock-record-1');
            expect(body.job, file).toBe(file.replace(/\.json$/, ''));
            expect(`${body.group}-${body.name}`, file).toBe(body.job);
            expect(body.config_sha256, file).toMatch(/^[0-9a-f]{64}$/);
            if ('error' in body) continue;
            expect(body.alternatives.map((a: any) => a.id), file).toContain(body.selected);
            expect(new Set(body.alternatives.map((a: any) => a.id)).size, file).toBe(body.alternatives.length);
            for (const a of body.alternatives) {
                for (const f of ['clock_sha256', 'windows_sha256', 'text_sha256', 'results_sha256']) expect(a[f], `${file} ${a.id}`).toMatch(/^[0-9a-f]{64}$/);
            }
        }
    });
});
