// The environment half of the blast cache key (scripts/blast/key.py): the variables that change what the engine generates are
// in the key by name and value (none today), a key with none set is the one it always was, and a CLOCK_* variable no list knows
// stops the key: CLOCK_NEW_DISPATCH too, which the engine no longer reads.
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const scriptsDir = path.resolve(__dirname, '../../scripts/blast');
const git = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };

/** The test's own environment without any CLOCK_* variable, so that a developer's setting never reaches key.py */
const clean = () => Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('CLOCK_'))) as Record<string, string>;

describe('the environment in the blast cache key', () => {
    let dir: string, repo: string;
    const run = (command: string, args: string[], env: Record<string, string>, cwd?: string) =>
        spawnSync(command, args, { cwd, encoding: 'utf8', env });
    const key = (env: Record<string, string> = {}, ...args: string[]) =>
        run('python3', [path.join(scriptsDir, 'key.py'), repo, ...args], { ...clean(), ...env });
    const engineOf = (env: Record<string, string> = {}) => {
        const done = key(env);
        if (done.status !== 0) throw new Error(done.stderr);
        return JSON.parse(done.stdout);
    };

    beforeAll(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blast-key-'));
        repo = path.join(dir, 'repo');
        for (const [name, text] of Object.entries({
            'clock-generator/resources/data.json': '{"a":1}', 'clock-generator/package-lock.json': '{}',
            'clock-generator/tsconfig.json': '{}', 'clock-generator/src/x.ts': 'export {}',
        })) {
            fs.mkdirSync(path.dirname(path.join(repo, name)), { recursive: true });
            fs.writeFileSync(path.join(repo, name), text);
        }
        for (const args of [['init', '-q', '-b', 'main'], ['add', '-A'], ['commit', '-q', '-m', 'first']]) {
            const done = run('git', args, { ...clean(), ...git }, repo);
            if (done.status !== 0) throw new Error(done.stderr);
        }
    });
    afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('keeps the key of an environment with none of them set what it was before the field', () => {
        const engine = engineOf();
        expect(engine.env).toEqual({});
        // the hash as it was computed before the environment was part of it (python's json.dumps spacing, sorted keys)
        const before = `{"format": "${engine.format}", "lock": "${engine.lock}", "resources": "${engine.resources}", "src": "${engine.src}", "tsconfig": "${engine.tsconfig}"}`;
        expect(engine.engine).toBe(crypto.createHash('sha256').update(before).digest('hex'));
        // the rest of the environment is not in it
        expect(engineOf({ PATH: `${process.env.PATH}:/nowhere`, HOME: '/nowhere', SOMETHING_ELSE: '1' }).engine).toBe(engine.engine);
    });

    it('does not count the variables the runner clears or the ones that do not reach generation', () => {
        const unset = engineOf().engine;
        for (const name of ['CLOCK_PROOF_PHASES', 'CLOCK_RECORDING_CACHE', 'CLOCK_RECORDING_CACHE_DIR', 'CLOCK_RECORDING_CACHE_LOG', 'CLOCK_GENERATOR_ROOT']) {
            expect(engineOf({ [name]: 'x' }).engine, name).toBe(unset);
        }
    });

    it('fails closed on a CLOCK_* variable that is on no list, naming it', () => {
        for (const args of [[], ['--state']]) {
            const done = run('python3', [path.join(scriptsDir, 'key.py'), ...args, repo], { ...clean(), CLOCK_SOMETHING_NEW: '1' });
            expect(done.status).not.toBe(0);
            expect(done.stdout).toBe('');
            expect(done.stderr).toContain('CLOCK_SOMETHING_NEW');
        }
        // an empty value is still set
        expect(key({ CLOCK_SOMETHING_NEW: '' }).status).not.toBe(0);
        // every unknown one is named
        expect(key({ CLOCK_ONE: '1', CLOCK_TWO: '1' }).stderr).toMatch(/CLOCK_ONE, CLOCK_TWO/);
        // the dispatch setting is gone: a run under it stops
        for (const args of [[], ['--state']]) {
            const done = run('python3', [path.join(scriptsDir, 'key.py'), ...args, repo], { ...clean(), CLOCK_NEW_DISPATCH: '1' });
            expect(done.status).not.toBe(0);
            expect(done.stderr).toContain('CLOCK_NEW_DISPATCH');
        }
    });

    it('does not take a result made under a keyed setting as a base for a run with none set', () => {
        const cache = path.join(dir, 'cache');
        const entry = (name: string, engine: any, drop = false) => {
            const copy = { ...engine }; delete copy.dirty; if (drop) delete copy.env;
            fs.mkdirSync(path.join(cache, name), { recursive: true });
            fs.writeFileSync(path.join(cache, name, 'MANIFEST.json'), JSON.stringify({ key: name, engine: copy, jobs: { format: 'f' }, functions: { tool: 'tool' } }));
        };
        // 'on': an entry made under CLOCK_NEW_DISPATCH=1 while it was keyed
        entry('off', engineOf()); entry('off-old', engineOf(), true); entry('on', { ...engineOf(), env: { CLOCK_NEW_DISPATCH: '1' } });
        fs.writeFileSync(path.join(dir, 'jobs.json'), JSON.stringify({ format: 'f' }));
        const basesFor = (env: Record<string, string>) => {
            fs.writeFileSync(path.join(dir, 'engine.json'), JSON.stringify(engineOf(env)));
            return run('python3', [path.join(scriptsDir, 'cache.py'), 'bases', cache, path.join(dir, 'engine.json'), path.join(dir, 'jobs.json'), 'tool', repo], clean())
                .stdout.split('\n').filter(Boolean).map(line => JSON.parse(line).key).sort();
        };
        // an entry from before the field was made with none of them set
        expect(basesFor({})).toEqual(['off', 'off-old']);
    });

    describe('storing a run folder', () => {
        const check = (folder: string, current: Record<string, string>, ...claimed: string[]) => {
            fs.writeFileSync(path.join(dir, 'current.json'), JSON.stringify(engineOf(current)));
            return run('python3', [path.join(scriptsDir, 'key.py'), '--check-store', folder, path.join(dir, 'current.json'), ...claimed], clean());
        };
        const folder = (name: string, record?: object) => {
            const made = path.join(dir, name);
            fs.mkdirSync(made, { recursive: true });
            if (record) fs.writeFileSync(path.join(made, '.env.json'), JSON.stringify(record));
            return made;
        };

        it('accepts a folder made under the current environment', () => {
            expect(check(folder('off', {}), {}).status).toBe(0);
        });

        it('refuses a folder made under another environment, naming both', () => {
            const flagOn = check(folder('on-2', { CLOCK_NEW_DISPATCH: '1' }), {});
            expect(flagOn.status).not.toBe(0);
            expect(flagOn.stderr).toContain("CLOCK_NEW_DISPATCH='1'");
            expect(flagOn.stderr).toContain('none set');
            // the empty string is a value of its own
            expect(check(folder('on-3', { CLOCK_NEW_DISPATCH: '' }), {}).status).not.toBe(0);
        });

        it('refuses a folder with no record unless the environment it was made under is given, and then it must be the current one', () => {
            const old = folder('old');
            const missing = check(old, {});
            expect(missing.status).not.toBe(0);
            expect(missing.stderr).toContain('no record');
            expect(missing.stderr).toContain('--made-under');
            expect(check(old, {}, 'none').status).toBe(0);
            expect(check(old, {}, 'CLOCK_NEW_DISPATCH=1').status).not.toBe(0);
        });
    });
});
