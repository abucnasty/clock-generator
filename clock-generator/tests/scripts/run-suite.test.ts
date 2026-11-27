// scripts/game/run-suite.py: where its guard folder comes from, and the environment of a job's command. The checks end
// before the runner lists a case or starts a job, so no vitest list, no guard and no game runs.
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
    spawnSync('python3', ['-I', '-B', script, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', ...env } });

/** What `resolve_guard` gives, or the refusal's text, called without the runner's main */
const resolve = (guardDir: string | null, noGuard: boolean, env: Record<string, string> = {}) =>
    spawnSync('python3', ['-I', '-B', '-c', [
        'import importlib.util, json, sys',
        'spec = importlib.util.spec_from_file_location("run_suite", sys.argv[1])',
        'module = importlib.util.module_from_spec(spec)',
        'spec.loader.exec_module(module)',
        'guard_dir, no_guard, environ = json.loads(sys.argv[2])',
        'print(json.dumps(None if module.resolve_guard(guard_dir, no_guard, environ) is None else "guard"))',
    ].join('\n'), script, JSON.stringify([guardDir, noGuard, env])], { encoding: 'utf8' });

/** The command `Runner.command` builds for a job of `file`, guarded or not, with `env` as the runner's own environment */
const jobCommand = (file: string, guard: string | null, env: Record<string, string> = {}) => {
    const out = fs.mkdtempSync(path.join(tmp, 'out-'));
    const result = spawnSync('python3', ['-I', '-B', '-c', [
        'import argparse, importlib.util, json, sys',
        'from pathlib import Path',
        'spec = importlib.util.spec_from_file_location("run_suite", sys.argv[1])',
        'module = importlib.util.module_from_spec(spec)',
        'spec.loader.exec_module(module)',
        'file, out, guard = json.loads(sys.argv[2])',
        'args = argparse.Namespace(cache="on", calibrate=False, owner="test")',
        'runner = module.Runner(args, Path(out), None if guard is None else Path(guard))',
        'print(json.dumps(runner.command({"id": "000-job", "file": file, "pattern": "^(case)$"})))',
    ].join('\n'), script, JSON.stringify([file, out, guard])], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', ...env } });
    expect(result.stderr).toBe('');
    return { out, command: JSON.parse(result.stdout) as string[] };
};

describe('run-suite.py job environment', () => {
    const missing = 'tests/game/builds/missing-recordings-clock.game.test.ts';
    const other = 'tests/game/builds/iron-plate-80-car-chest-clock.game.test.ts';
    const caller = { MISSING_RECORDINGS_CAPTURE_DIR: '/the/caller/folder' };
    const settings = (command: string[]) => command.filter(arg => arg.startsWith('MISSING_RECORDINGS_CAPTURE_DIR='));

    it('gives each job of the missing-recordings file its own capture folder, and never the caller\'s', () => {
        const guard = fs.mkdtempSync(path.join(tmp, 'guard-'));
        for (const folder of [guard, null]) {
            const { out, command } = jobCommand(missing, folder, caller);
            expect(command).toContain('-uMISSING_RECORDINGS_CAPTURE_DIR');
            expect(settings(command)).toEqual([`MISSING_RECORDINGS_CAPTURE_DIR=${path.join(out, 'capture', '000-job')}`]);
            expect(command.indexOf('-uMISSING_RECORDINGS_CAPTURE_DIR')).toBeLessThan(command.indexOf(settings(command)[0]));
        }
    });

    it('only unsets the variable for a job of another file', () => {
        const guard = fs.mkdtempSync(path.join(tmp, 'guard-'));
        for (const folder of [guard, null]) {
            const { command } = jobCommand(other, folder, caller);
            expect(command).toContain('-uMISSING_RECORDINGS_CAPTURE_DIR');
            expect(settings(command)).toEqual([]);
        }
    });
});

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
