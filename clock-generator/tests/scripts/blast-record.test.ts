// scripts/blast/record.py: the record (one small JSON per blast job) written from a run's job files, and the check that regenerates
// it and compares field by field, with a table of job, field, before and after when a field differs.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { afterAll, describe, expect, it } from 'vitest';
import { moduleSha256 } from '../game/builds/record-properties';
import { moduleSha256 as checksSha256 } from '../game/builds/record-job-checks';

const record = path.resolve(__dirname, '../../scripts/blast/record.py');
const recordDir = path.resolve(__dirname, '../../record');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'blast-record-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const sha = (c: string) => c.repeat(64);
const run = (...args: string[]) => spawnSync('python3', [record, ...args], { encoding: 'utf8' });

interface Edit { id?: string; maker?: string; verdict?: string; holds?: boolean; rate?: number; window_cycle_ticks?: number; wake_ups?: number; clock?: string; windows?: Record<string, { start: number; end: number }[]> }
/** An alternative as the blast writes it (the fields the record reads, and the heavy ones it leaves out) */
const alternative = (e: Edit = {}) => ({
    id: e.id ?? 'even-hands', ...(e.maker !== undefined && { maker: e.maker }), verdict: e.verdict ?? 'stable', holds: e.holds ?? true, rate: e.rate ?? 640, supply: null, window_cycle_ticks: e.window_cycle_ticks ?? 972,
    wake_ups: e.wake_ups ?? 889.0718254784936, clock_sha256: e.clock ?? sha('a'), text_sha256: sha('2'), descriptions_cut: 0,
    windows_sha256: sha('7'), windows: e.windows ?? { 'inserter:1': [{ start: 0, end: 10 }, { start: 54, end: 64 }], 'drill:1': [] },
    results_sha256: sha('3'), results: { label: sha('1'), assessment: sha('9') },
});
/** What the property module writes into a job file of a result it found nothing wrong with */
const clean = () => ({
    module_sha256: moduleSha256(), seconds: 0.5, problems: [] as { property: string; alternative: string; message: string }[],
    checked: { 'always-on-reasons-named': 2, 'decider-build-order': 2, 'stable-holds-and-survives-loss': 2, 'counters-add-up': 1, 'fuel-never-dry': 0, 'strategy-and-signals': 2 },
});
/** What the per-job checks module writes into a job file of a result it found nothing wrong with */
const cleanChecks = () => ({ module_sha256: checksSha256(), seconds: 0.25, ran: ['says what it must', 'and the other'], failures: [] as { check: string; message: string; expected?: string; actual?: string }[] });
const jobFile = (name: string, alternatives = [alternative(), alternative({ id: 'plain', verdict: 'unstable', clock: sha('b') })], group = 'config', properties: object | null = clean(), checks: object | null = cleanChecks()) => ({
    group, name, selected_index: 0, results_sha256: sha('4'), job_results: { results_sha256: sha('5'), results: { ids: sha('6') } },
    selected: alternatives[0], alternatives, seconds: 12.5, ...(properties !== null && { properties }), ...(checks !== null && { checks }),
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
        const done = run('check', '--dir', dir, '--summary', summary, side({ A: jobFile('A', [alternative({ window_cycle_ticks: 5 }), alternative({ id: 'plain', verdict: 'unstable', clock: sha('b') })]) }));
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

describe('record.py check: the properties of the run', () => {
    const dirOf = () => written({ A: jobFile('A'), B: jobFile('B') });
    const found = (property: string, alternative: string, message: string) => ({ ...clean(), problems: [{ property, alternative, message }] });

    it('says what it checked and how long it took, and passes a run with no problem', () => {
        const done = run('check', '--dir', dirOf(), side({ A: jobFile('A'), B: jobFile('B') }));
        expect(done.status, done.stdout).toBe(0);
        expect(done.stdout).toContain('properties checked on 2 jobs (18 alternative checks, 1.0 s of the module): 0 problems');
    });

    it('fails on one problem with a table of job, property, alternative and the values, though the record has no difference', () => {
        const broken = jobFile('B', undefined, 'config', found('fuel-never-dry', 'plain', 'machine:2 had no fuel for 12 ticks, from tick 340'));
        const done = run('check', '--dir', dirOf(), side({ A: jobFile('A'), B: broken }));
        expect(done.status).toBe(1);
        expect(done.stdout).toContain('no difference from the record');
        expect(done.stdout).toContain('1 problems');
        const rows = done.stdout.split('\n').filter(line => line.startsWith('config-B'));
        expect(rows).toHaveLength(1);
        expect(rows[0].split(/\s{2,}/)).toEqual(['config-B', 'fuel-never-dry', 'plain', 'machine:2 had no fuel for 12 ticks, from tick 340']);
    });

    it('shows what a named exception found, and does not fail on it', () => {
        const excused = jobFile('A', undefined, 'config', { ...clean(), excepted: [{ property: 'counters-add-up', alternative: 'plain', reason: 'a subtick clock', found: ['inserter:5: 2 swings against 1 grabs a minute'] }] });
        const done = run('check', '--dir', dirOf(), side({ A: excused, B: jobFile('B') }));
        expect(done.status, done.stdout).toBe(0);
        expect(done.stdout).toContain('excepted: config-A counters-add-up plain: 1 found, excepted: a subtick clock');
    });

    it('appends the problems to the summary file', () => {
        const summary = path.join(tmp, `summary${count++}.md`);
        const broken = jobFile('A', undefined, 'config', found('counters-add-up', 'even-hands', 'inserter:1: input and output wake-ups 6 against its wake-ups 3'));
        const done = run('check', '--dir', dirOf(), '--summary', summary, side({ A: broken, B: jobFile('B') }));
        expect(done.status).toBe(1);
        expect(fs.readFileSync(summary, 'utf8')).toContain('config-A  counters-add-up  even-hands');
    });

    it('fails on a job file with no properties, on one the module failed on and on one judged by another version of the module; --allow-unchecked lists them and goes on', () => {
        const none = jobFile('A', undefined, 'config', null);
        const failed = jobFile('B', undefined, 'config', { module_sha256: moduleSha256(), error: 'TypeError: x is undefined' });
        const older = jobFile('C', undefined, 'config', { ...clean(), module_sha256: sha('9') });
        const dir = written({ A: jobFile('A'), B: jobFile('B'), C: jobFile('C') });
        const jobs = side({ A: none, B: failed, C: older });
        const done = run('check', '--dir', dir, jobs);
        expect(done.status).toBe(1);
        expect(done.stdout).toContain('config-A: no properties in the job file');
        expect(done.stdout).toMatch(/config-B\s+\(module\)\s+TypeError: x is undefined/);
        expect(done.stdout).toContain('config-C: judged by another version of the property module (999999999999..');
        const allowed = run('check', '--dir', dir, '--allow-unchecked', jobs);
        expect(allowed.status, allowed.stdout).toBe(1); // the module's own error is a problem, not a missing result
        const only = run('check', '--dir', dir, '--allow-unchecked', side({ A: none, B: jobFile('B'), C: older }));
        expect(only.status, only.stdout).toBe(0);
        expect(only.stdout).toContain('2 jobs with no result of them');
    });

    it('leaves a job that failed to generate to the record: it has no properties to have', () => {
        const dir = written({ A: jobFile('A') });
        const errored = { group: 'config', name: 'A', error: 'Error: no feasible clock', seconds: 1 };
        const done = run('check', '--dir', dir, side({ A: errored as any }));
        expect(done.stdout).toContain('properties checked on 0 jobs');
        expect(done.stdout).not.toContain('no properties in the job file');
    });
});

describe('record.py check: the per-job checks of the run', () => {
    const dirOf = () => written({ A: jobFile('A'), B: jobFile('B') });
    const failing = (failures: { check: string; message: string; expected?: string; actual?: string }[]) => ({ ...cleanChecks(), failures });

    it('says what ran and how long it took, and passes a run with no failure', () => {
        const done = run('check', '--dir', dirOf(), side({ A: jobFile('A'), B: jobFile('B') }));
        expect(done.status, done.stdout).toBe(0);
        expect(done.stdout).toContain('per-job checks: 4 checks on 2 jobs (0.5 s): 0 failed');
    });

    it('fails on one failed check with a table of job, check and the expected and actual values, though the record has no difference', () => {
        const broken = jobFile('B', undefined, 'config', clean(), failing([{ check: 'says what it must', message: 'expected 71 to be 72', expected: '72', actual: '71' }]));
        const done = run('check', '--dir', dirOf(), side({ A: jobFile('A'), B: broken }));
        expect(done.status).toBe(1);
        expect(done.stdout).toContain('no difference from the record');
        expect(done.stdout).toContain('1 failed');
        const rows = done.stdout.split('\n').filter(line => line.startsWith('config-B'));
        expect(rows).toHaveLength(1);
        expect(rows[0].split(/\s{2,}/)).toEqual(['config-B', 'says what it must', 'expected 72, actual 71']);
    });

    it('shows the message of a failure that has no values', () => {
        const broken = jobFile('A', undefined, 'config', clean(), failing([{ check: 'and the other', message: 'the text is\nnot there' }]));
        const done = run('check', '--dir', dirOf(), side({ A: broken, B: jobFile('B') }));
        expect(done.status).toBe(1);
        expect(done.stdout).toContain('config-A  and the other  the text is not there');
    });

    it('appends the failures to the summary file', () => {
        const summary = path.join(tmp, `summary${count++}.md`);
        const broken = jobFile('A', undefined, 'config', clean(), failing([{ check: 'says what it must', message: 'm', expected: '"a"', actual: '"b"' }]));
        const done = run('check', '--dir', dirOf(), '--summary', summary, side({ A: broken, B: jobFile('B') }));
        expect(done.status).toBe(1);
        expect(fs.readFileSync(summary, 'utf8')).toContain('### Job checks: 1 failed in 1 jobs');
        expect(fs.readFileSync(summary, 'utf8')).toContain('config-A  says what it must  expected "a", actual "b"');
    });

    it('fails on a job file with no checks, on one the module failed on and on one judged by another version of the module; --allow-unchecked lists them and goes on', () => {
        const none = jobFile('A', undefined, 'config', clean(), null);
        const failed = jobFile('B', undefined, 'config', clean(), { module_sha256: checksSha256(), error: 'TypeError: x is undefined' });
        const older = jobFile('C', undefined, 'config', clean(), { ...cleanChecks(), module_sha256: sha('9') });
        const dir = written({ A: jobFile('A'), B: jobFile('B'), C: jobFile('C') });
        const jobs = side({ A: none, B: failed, C: older });
        const done = run('check', '--dir', dir, jobs);
        expect(done.status).toBe(1);
        expect(done.stdout).toContain('config-A: no checks in the job file');
        expect(done.stdout).toMatch(/config-B\s+\(module\)\s+TypeError: x is undefined/);
        expect(done.stdout).toContain('config-C: judged by another version of the per-job checks (999999999999..');
        const only = run('check', '--dir', dir, '--allow-unchecked', side({ A: none, B: jobFile('B'), C: older }));
        expect(only.status, only.stdout).toBe(0);
        expect(only.stdout).toContain('2 jobs with no result of them');
    });

    it('leaves a job that failed to generate to the record: it has no checks to have', () => {
        const dir = written({ A: jobFile('A') });
        const errored = { group: 'config', name: 'A', error: 'Error: no feasible clock', seconds: 1 };
        const done = run('check', '--dir', dir, side({ A: errored as any }));
        expect(done.stdout).toContain('per-job checks: 0 checks on 0 jobs');
        expect(done.stdout).not.toContain('no checks in the job file');
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

describe('record.py check: the derived ids of the alternatives', () => {
    const old = () => written({ A: jobFile('A', [alternative({ id: 'planned-belt-slack' }), alternative({ id: 'planned-belt-slack-subtick', clock: sha('b') })]) });
    const derived = (id: string, maker: string, clock = sha('a')) => alternative({ id, maker, clock });

    it('reads an id of the record as the id the run gave the same maker, so a pure rename of the ids is no difference', () => {
        const done = run('check', '--dir', old(), side({ A: jobFile('A', [derived('takt_batches', 'planned-belt-slack'), derived('takt_batches_subtick', 'planned-belt-slack-subtick', sha('b'))]) }));
        expect(done.status, done.stdout).toBe(0);
        expect(done.stdout).toContain('2 alternative ids of the record read as the derived ids');
    });

    it('still lists what moved besides the ids', () => {
        const done = run('check', '--dir', old(), side({ A: jobFile('A', [derived('takt_batches', 'planned-belt-slack', sha('d')), derived('takt_batches_subtick', 'planned-belt-slack-subtick', sha('b'))]) }));
        expect(done.status).toBe(1);
        expect(done.stdout).toMatch(/config-A\s+alternatives\[takt_batches\]\.clock_sha256\s+aaaaaaaaaaaa\.\.\s+dddddddddddd\.\./);
        expect(done.stdout).not.toContain('alternatives (ids, in order)');
    });

    it('leaves the ids alone where the run has no makers (an engine from before), which are then read as removed and added', () => {
        const done = run('check', '--dir', old(), side({ A: jobFile('A', [alternative({ id: 'takt_batches' }), alternative({ id: 'takt_batches_subtick', clock: sha('b') })]) }));
        expect(done.status).toBe(1);
        expect(done.stdout).toContain('alternatives (ids, in order)');
    });

    it('does not touch a record whose ids the run has (written after the derivation)', () => {
        const dir = written({ A: jobFile('A', [derived('takt_batches', 'planned-belt-slack')]) });
        const done = run('check', '--dir', dir, side({ A: jobFile('A', [derived('takt_batches', 'planned-belt-slack')]) }));
        expect(done.status, done.stdout).toBe(0);
        expect(done.stdout).not.toContain('alternative ids of the record read as');
    });
});

describe('record.py worse (the never-worse rule)', () => {
    const base = () => written({ A: jobFile('A'), B: jobFile('B') });
    /** The change: the same two jobs, A with these alternatives, in a record folder of its own */
    const change = (a: ReturnType<typeof alternative>, jobs: Record<string, ReturnType<typeof jobFile>> = {}) =>
        written({ A: jobFile('A', [a, alternative({ id: 'plain', verdict: 'unstable', clock: sha('b') })]), B: jobFile('B'), ...jobs });
    const moves = (text: string) => {
        const file = path.join(tmp, `moves${count++}.md`);
        fs.writeFileSync(file, text);
        return file;
    };
    const worse = (before: string, after: string, text?: string, ...more: string[]) =>
        run('worse', '--base', before, '--dir', after, ...(text === undefined ? [] : ['--moves', moves(text)]), ...more);

    it('passes a change that moves no record, and one that moves a clock without making it worse', () => {
        const dir = base();
        expect(worse(dir, dir).status).toBe(0);
        const better = worse(dir, change(alternative({ verdict: 'stable', rate: 700, wake_ups: 500, clock: sha('e') })));
        expect(better.status, better.stdout).toBe(0);
        expect(better.stdout).toContain('0 jobs worse');
    });

    it.each([
        ['the verdict drops from stable to no recovery', { verdict: 'no recovery' }, 'verdict', 'stable', 'no recovery'],
        ['the verdict drops from stable to unstable', { verdict: 'unstable' }, 'verdict', 'stable', 'unstable'],
        ['the clock stops holding', { holds: false }, 'holds', 'true', 'false'],
        ['the rate falls', { rate: 600 }, 'rate', '640', '600'],
        ['the wake-ups a minute rise', { wake_ups: 890.5 }, 'wake_ups', '889.072', '890.5'],
    ] as const)('fails when %s and the job is not named in MOVES.md, with a table', (_what, edit, field, before, after) => {
        const done = worse(base(), change(alternative({ ...edit, clock: sha('e') })), '## Something else (#1)\n- config-B: faster\n');
        expect(done.status, done.stdout).toBe(1);
        const row = done.stdout.split('\n').find(line => line.startsWith('config-A'))!;
        expect(row.split(/\s{2,}/)).toEqual(['config-A', field, before, after, 'NO']);
        expect(done.stdout).toContain('1 jobs worse, 1 of them not named in MOVES.md');
    });

    it('passes the same change when the lines the pull request adds to MOVES.md name the job', () => {
        const after = change(alternative({ verdict: 'no recovery', rate: 600, clock: sha('e') }));
        const done = worse(base(), after, '## A clock gets worse (#2)\n- config-A: no recovery, rate 640 -> 600; accepted because the belt is shorter\n');
        expect(done.status, done.stdout).toBe(0);
        const rows = done.stdout.split('\n').filter(line => line.startsWith('config-A'));
        expect(rows.map(r => r.split(/\s{2,}/).at(-1))).toEqual(['yes', 'yes']);
    });

    it('names a job as a word of its own: config-A is not named by config-A_BACKED_UP', () => {
        const after = change(alternative({ holds: false, clock: sha('e') }));
        expect(worse(base(), after, '- config-A_BACKED_UP: moved\n- xconfig-A: moved\n').status).toBe(1);
        expect(worse(base(), after, '- `config-A`, config-B: moved\n').status).toBe(0);
    });

    it('fails when no MOVES text is given at all', () => {
        expect(worse(base(), change(alternative({ holds: false, clock: sha('e') }))).status).toBe(1);
    });

    it('fails a job that generated and now fails to, and passes one that now generates', () => {
        const dir = base();
        const broken = written({ A: { group: 'config', name: 'A', error: 'Error: boom' } as unknown as ReturnType<typeof jobFile>, B: jobFile('B') });
        const done = worse(dir, broken);
        expect(done.status).toBe(1);
        expect(done.stdout).toMatch(/config-A\s+error\s+generated\s+Error: boom\s+NO/);
        expect(worse(broken, dir).status).toBe(0);
    });

    it('leaves a job in one record only, a rate within rounding and a rise of nothing', () => {
        const dir = written({ A: jobFile('A'), OLD: jobFile('OLD', [alternative({ holds: true })]) });
        const after = written({ A: jobFile('A', [alternative({ rate: 640 - 1e-12 }), alternative({ id: 'plain', verdict: 'unstable', clock: sha('b') })]), NEW: jobFile('NEW', [alternative({ holds: false, verdict: 'unstable' })]) });
        expect(worse(dir, after).status).toBe(0);
    });

    it('appends the table to the summary file when a clock is not named', () => {
        const summary = path.join(tmp, `summary${count++}.md`);
        worse(base(), change(alternative({ holds: false, clock: sha('e') })), '', '--summary', summary);
        expect(fs.readFileSync(summary, 'utf8')).toContain('### Never worse: 1 selected clocks got worse and are not named in MOVES.md');
    });

    it('refuses a missing base and a folder with no record', () => {
        expect(run('worse', '--dir', base()).stderr).toContain('--base');
        expect(run('worse', '--base', path.join(tmp, 'nothing'), '--dir', base()).status).not.toBe(0);
    });
});

describe('the committed record', () => {
    const files = fs.existsSync(recordDir) ? fs.readdirSync(recordDir).filter(f => f.endsWith('.json')) : [];
    it('has a CI duration for every job and for no other (ci/record-durations.json deals the jobs out to the shards)', () => {
        const durations = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../ci/record-durations.json'), 'utf8')) as Record<string, number>;
        expect(Object.keys(durations).sort()).toEqual(files.map(f => f.replace(/\.json$/, '')).sort());
        for (const [job, seconds] of Object.entries(durations)) expect(seconds, job).toBeGreaterThan(0);
    });

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
