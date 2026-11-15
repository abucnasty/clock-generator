// scripts/game/run-suite.py: where its guard folder comes from. The checks end before the runner lists a case or starts a
// job, so no vitest list, no guard and no game runs.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { afterAll, describe, expect, it } from 'vitest';

const script = path.resolve(__dirname, '../../scripts/game/run-suite.py');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'run-suite-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** The runner with these arguments and an environment of only `env` (no GUARD_DIR unless given) */
const run = (args: string[], env: Record<string, string> = {}) =>
    spawnSync('python3', ['-I', script, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', ...env } });

/** What `resolve_guard` gives, or the refusal's text, called without the runner's main */
const resolve = (guardDir: string | null, noGuard: boolean, env: Record<string, string> = {}) =>
    spawnSync('python3', ['-I', '-c', [
        'import importlib.util, json, sys',
        'spec = importlib.util.spec_from_file_location("run_suite", sys.argv[1])',
        'module = importlib.util.module_from_spec(spec)',
        'spec.loader.exec_module(module)',
        'guard_dir, no_guard, environ = json.loads(sys.argv[2])',
        'print(json.dumps(None if module.resolve_guard(guard_dir, no_guard, environ) is None else "guard"))',
    ].join('\n'), script, JSON.stringify([guardDir, noGuard, env])], { encoding: 'utf8' });

describe('run-suite.py guard folder', () => {
    it('refuses to start with no --guard-dir, no GUARD_DIR and no --no-guard: exit 1, one line naming all three', () => {
        const result = run(['--plan']);
        expect(result.status).toBe(1);
        expect(result.stdout).toBe('');
        const lines = result.stderr.trim().split('\n');
        expect(lines).toHaveLength(1);
        for (const name of ['--guard-dir', 'GUARD_DIR', '--no-guard']) expect(lines[0]).toContain(name);
    });

    it('refuses a guard folder that holds no guarded-run-budget.py, from the option and from the environment', () => {
        const empty = fs.mkdtempSync(path.join(tmp, 'empty-'));
        for (const result of [run(['--plan', '--guard-dir', empty]), run(['--plan'], { GUARD_DIR: empty })]) {
            expect(result.status).toBe(1);
            expect(result.stderr.trim().split('\n')).toHaveLength(1);
            expect(result.stderr).toContain('guarded-run-budget.py');
        }
    });

    it('takes the folder from --guard-dir or GUARD_DIR when it holds the guard, and none for --no-guard', () => {
        const guard = fs.mkdtempSync(path.join(tmp, 'guard-'));
        fs.writeFileSync(path.join(guard, 'guarded-run-budget.py'), '');
        expect(resolve(guard, false).stdout.trim()).toBe('"guard"');
        expect(resolve(null, false, { GUARD_DIR: guard }).stdout.trim()).toBe('"guard"');
        expect(resolve(null, true).stdout.trim()).toBe('null');
        expect(resolve(null, true, { GUARD_DIR: guard }).stdout.trim()).toBe('null');
    });

    it('refuses --no-guard together with --guard-dir', () => {
        const result = run(['--plan', '--no-guard', '--guard-dir', tmp]);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('--no-guard');
        expect(result.stderr.trim().split('\n')).toHaveLength(1);
    });
});
