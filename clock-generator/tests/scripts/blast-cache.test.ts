// scripts/blast/cache.py and blast.sh: `same` leaves out the seconds of a job and of its checks (two runs of equal results read
// equal), a blast takes a lock of its own output folder unless BLAST_LOCK names one, and the temporary files of blast.sh are made
// under the cache. blast.sh runs here on a small repository whose vitest is a stub that writes the job list and two job files.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const scriptsDir = path.resolve(__dirname, '../../scripts/blast');
const cachePy = path.join(scriptsDir, 'cache.py');
const blastSh = path.join(scriptsDir, 'blast.sh');
const git = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };

/** The test's own environment without any CLOCK_* or BLAST_* variable, so that a developer's setting never reaches the scripts */
const clean = () => Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(CLOCK|BLAST)_/.test(name))) as Record<string, string>;

let dir: string;
let count = 0;
const fresh = (name: string) => path.join(dir, `${name}${count++}`);

beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blast-cache-')); });
afterAll(() => {
    fs.chmodSync(path.join(dir, 'locked'), 0o755);
    fs.rmSync(dir, { recursive: true, force: true });
});

describe('cache.py same: what is timing and what is a result', () => {
    const job = (extra: object) => ({ config: 'A', selected: 'c1', ...extra });
    const folder = (body: object) => {
        const made = fresh('jobs');
        fs.mkdirSync(made);
        fs.writeFileSync(path.join(made, 'config-A.json'), JSON.stringify(body));
        return made;
    };
    const same = (a: object, b: object) => spawnSync('python3', [cachePy, 'same', folder(a), folder(b)], { encoding: 'utf8' });
    const checks = (extra: object) => ({ module_sha256: 'm', ran: ['one'], failures: [], ...extra });

    it('reads two runs that differ only in the seconds of a job, of its properties or of its checks as the same', () => {
        const done = same(
            job({ seconds: 1.5, properties: { seconds: 1, ok: true }, checks: checks({ seconds: 0.001 }) }),
            job({ seconds: 9, properties: { seconds: 2, ok: false }, checks: checks({ seconds: 0 }) }),
        );
        expect(done.status, done.stdout + done.stderr).toBe(0);
        expect(done.stdout).toContain('1 jobs in both; 1 the same');
    });

    it('still reports two jobs that differ in what the checks found', () => {
        for (const other of [{ failures: ['one: expected 1, got 2'] }, { ran: ['one', 'two'] }, { module_sha256: 'other' }]) {
            const done = same(job({ checks: checks({ seconds: 0 }) }), job({ checks: checks({ seconds: 0, ...other }) }));
            expect(done.status, JSON.stringify(other)).toBe(1);
            expect(done.stdout).toContain('DIFFERENT: config-A');
        }
    });

    it('reports a job with checks against one without, and a job that differs in a result', () => {
        expect(same(job({ checks: checks({ seconds: 0 }) }), job({})).status).toBe(1);
        expect(same(job({ checks: checks({ seconds: 0 }) }), job({ selected: 'c2', checks: checks({ seconds: 0 }) })).status).toBe(1);
    });
});

describe('blast.sh: the lock and the temporary files', () => {
    let repo: string, cache: string, log: string, locked: string;
    const env = (extra: Record<string, string> = {}) => ({ ...clean(), BLAST_CACHE: cache, STUB_LOG: log, TMPDIR: dir, ...extra });
    const blast = (extra: Record<string, string>, ...args: string[]) => spawnSync('bash', [blastSh, ...args], { encoding: 'utf8', env: env(extra) });
    const asRoot = process.getuid?.() === 0;

    beforeAll(() => {
        repo = path.join(dir, 'repo');
        cache = path.join(dir, 'cache');
        log = path.join(dir, 'stub.log');
        locked = path.join(dir, 'locked');
        const files: Record<string, string> = {
            '.gitignore': 'clock-generator/tests/game/builds/.scratch/\n',
            'clock-generator/resources/data.json': '{"a":1}', 'clock-generator/package-lock.json': '{}',
            'clock-generator/tsconfig.json': '{}', 'clock-generator/src/x.ts': 'export {}',
        };
        for (const [name, text] of Object.entries(files)) {
            fs.mkdirSync(path.dirname(path.join(repo, name)), { recursive: true });
            fs.writeFileSync(path.join(repo, name), text);
        }
        for (const args of [['init', '-q', '-b', 'main'], ['add', '-A'], ['commit', '-q', '-m', 'first']]) {
            const done = spawnSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...clean(), ...git } });
            if (done.status !== 0) throw new Error(done.stderr);
        }
        // a vitest that writes the job list (two jobs), then one job file a call, then says no job is left
        const vitest = path.join(repo, 'clock-generator/node_modules/.bin/vitest');
        fs.mkdirSync(path.dirname(vitest), { recursive: true });
        fs.writeFileSync(vitest, `#!/bin/bash
echo "$BLAST_MODE $BLAST_OUT" >> "$STUB_LOG"
if [ "$BLAST_MODE" = jobs ]; then
  echo '{"format":"t-1","jobs_sha256":"${'a'.repeat(64)}","count":2,"groups":["config"],"skip":[],"jobs":[{"key":"config-A"},{"key":"config-B"}]}' > "$BLAST_OUT/_jobs.json"
  exit 0
fi
for k in config-A config-B; do
  if [ ! -e "$BLAST_OUT/$k.json" ]; then echo '{"seconds":1}' > "$BLAST_OUT/$k.json"; exit 0; fi
done
touch "$BLAST_OUT/.drained"
`, { mode: 0o755 });
        fs.mkdirSync(locked);
        fs.chmodSync(locked, 0o555);
    });

    it('locks the output folder of its own by default, and leaves the cache without a lock', () => {
        const out = fresh('out');
        const done = blast({}, 'run', repo, out, '-n', '1', '--no-store', '--no-build');
        expect(done.status, done.stdout + done.stderr).toBe(0);
        expect(fs.existsSync(path.join(out, '.generate.lock'))).toBe(true);
        expect(fs.existsSync(path.join(cache, '.generate.lock'))).toBe(false);
        expect(done.stdout).toContain('generating 2 jobs');
    }, 60000);

    it('takes the lock BLAST_LOCK names instead, so that blasts which share it take turns', () => {
        const out = fresh('out');
        const shared = fresh('shared') + '.lock';
        const done = blast({ BLAST_LOCK: shared }, 'run', repo, out, '-n', '1', '--no-store', '--no-build');
        expect(done.status, done.stdout + done.stderr).toBe(0);
        expect(fs.existsSync(shared)).toBe(true);
        expect(fs.existsSync(path.join(out, '.generate.lock'))).toBe(false);
    }, 60000);

    it.skipIf(asRoot)('makes the work folder of the key and of select under the cache, with TMPDIR not writable', () => {
        fs.writeFileSync(log, '');
        const key = blast({ TMPDIR: locked }, 'key', repo);
        expect(key.status, key.stdout + key.stderr).toBe(0);
        const select = blast({ TMPDIR: locked }, 'select', repo, '--no-build');
        expect(select.status, select.stdout + select.stderr).toBe(0);
        const worked = fs.readFileSync(log, 'utf8').trim().split('\n').map(line => line.split(' ')[1]);
        expect(worked.length).toBeGreaterThan(0);
        for (const folder of worked) expect(folder.startsWith(path.join(cache, '.blast-key.'))).toBe(true);
        // nothing is left behind
        expect(fs.readdirSync(cache).filter(name => name.startsWith('.blast-'))).toEqual([]);
        expect(fs.readdirSync(locked)).toEqual([]);
    }, 60000);
});
