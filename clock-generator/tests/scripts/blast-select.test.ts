// The selection behind scripts/blast/blast.sh: which functions a job ran, and which jobs a change of the engine reaches
// (scripts/blast/functions.js and the seed and bases commands of cache.py).
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { analyze, footprintOf, plan, tableOfDist, topChange, translate } from '../../scripts/blast/functions';

const scriptsDir = path.resolve(__dirname, '../../scripts/blast');

/** The built file a test edits: two functions, one inside the other, a class, some module-level code and the lines a TypeScript
 * build writes for imports and exports */
const source = (changes: { comment?: string; inner?: string; outer?: string; top?: string; method?: string; extra?: string; require?: string } = {}) => `
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.go = exports.TABLE = void 0;
const util_1 = require("${changes.require ?? './util'}");
${changes.comment ?? ''}
exports.TABLE = [1, 2, ${changes.top ?? '3'}];
function outer(x) {
    const y = x + ${changes.outer ?? '1'};
    function inner(z) {
        return z * ${changes.inner ?? '2'};
    }
    return inner(y);
}
class Box {
    constructor(v) { this.v = v; }
    get() { return this.v; }
    static make(v) { return new Box(v); }
    ${changes.method ?? ''}
}
${changes.extra ?? ''}
const go = (a) => outer(a) + exports.TABLE.length + Box.make(a).get() + util_1.k;
exports.go = go;
`;

const hashes = (text: string) => Object.fromEntries(analyze(ts, text).units.map((unit: any) => [unit.id, unit.hash])) as Record<string, string>;
const changedBetween = (a: string, b: string) => {
    const before = hashes(a), after = hashes(b);
    return Object.keys({ ...before, ...after }).filter(id => before[id] !== after[id]).sort();
};
/** What differs at the top level of the second build from the first's */
const topChangedBetween = (a: string, b: string) => topChange(analyze(ts, a).top, analyze(ts, b).top);

describe('the units of a built file', () => {
    it('names the functions, the class and its members, nested ones by their path', () => {
        const ids = analyze(ts, source()).units.map((unit: any) => unit.id);
        expect(ids).toEqual(expect.arrayContaining(['outer', 'outer/inner', 'class Box', 'class Box/constructor', 'class Box/get', 'class Box/static make', 'go']));
    });

    it('does not move for comments or layout', () => {
        const noted = source({ comment: '// a note\n/* and another\n   over two lines */' });
        expect(changedBetween(source(), noted)).toEqual([]);
        expect(topChangedBetween(source(), noted)).toEqual({ names: [], effects: null });
        const spaced = source().replace(/\n {4}/g, '\n\t\t').replace('return z * 2;', 'return   z   *   2 ;');
        expect(changedBetween(source(), spaced)).toEqual([]);
        expect(topChangedBetween(source(), spaced)).toEqual({ names: [], effects: null });
    });

    it('moves a function alone when its own code changes, and not the function around it', () => {
        expect(changedBetween(source(), source({ inner: '3' }))).toEqual(['outer/inner']);
        expect(changedBetween(source(), source({ outer: '2' }))).toEqual(['outer']);
    });

    it('moves a class when a member is added, as the class around the new method but not by its hash', () => {
        expect(changedBetween(source(), source({ method: 'extra() { return 0; }' }))).toEqual(['class Box/extra']);
        const members = (text: string) => analyze(ts, text).units.find((unit: any) => unit.id === 'class Box')!.members;
        expect(members(source({ method: 'extra() { return 0; }' }))).not.toEqual(members(source()));
    });

    it('lists the names a unit mentions', () => {
        const units = analyze(ts, source()).units;
        expect(units.find((unit: any) => unit.id === 'go')!.refs).toEqual(expect.arrayContaining(['TABLE', 'Box', 'util_1', 'outer', 'k']));
        expect(units.find((unit: any) => unit.id === 'outer')!.refs).not.toContain('TABLE');
    });

    it('maps the ranges V8 reports to the unit and the units around it', () => {
        const text = source();
        const analysis = analyze(ts, text);
        const range = (needle: string) => [text.indexOf(needle), text.indexOf(needle) + needle.length];
        // V8 starts a method's range at its name, after `static`; an arrow's at its parameters
        const make = text.indexOf('make(v) { return new Box(v); }');
        expect(analysis.unitsOfRange(make, make + 'make(v) { return new Box(v); }'.length)).toEqual({ ids: ['class Box/static make', 'class Box'], mapped: true });
        const inner = text.slice(text.indexOf('function inner'), text.indexOf('    return inner(y);'));
        expect(analysis.unitsOfRange(...(range(inner.trimEnd()) as [number, number])).ids).toEqual(['outer/inner', 'outer']);
        const arrow = text.indexOf('(a) => outer(a)');
        expect(analysis.unitsOfRange(arrow, text.indexOf(';', arrow)).ids).toEqual(['go']);
    });
});

describe('the top level of a built file', () => {
    it('changes the names a declaration with other code declares', () => {
        expect(topChangedBetween(source(), source({ top: '4' }))).toEqual({ names: ['TABLE'], effects: null });
    });

    it('changes the name of an import that now reads another module', () => {
        expect(topChangedBetween(source(), source({ require: './other' }))).toEqual({ names: ['util_1'], effects: null });
    });

    it('differs in the statements that only run when one is added, removed or changed', () => {
        const effect = (call: string) => source({ extra: call });
        expect(topChangedBetween(source(), effect('registry.add("box", Box);')).effects).toBe('a statement that only runs differs');
        expect(topChangedBetween(effect('registry.add("box", Box);'), source()).effects).toBe('a statement that only runs differs');
        expect(topChangedBetween(effect('registry.add("a");'), effect('registry.add("b");')).effects).toBe('a statement that only runs differs');
    });

    it('does not change for what only adds a name that code that did not change cannot read', () => {
        // a new function with its export, a new import, a new constant, a new enum: what a change that adds a helper writes
        const added = source({
            extra: 'const LIMIT = 7;\nexports.LIMIT = 9;\nvar Kind;\n(function (Kind) { Kind[Kind["A"] = 0] = "A"; })(Kind || (exports.Kind = Kind = {}));\nfunction helper() { return LIMIT; }\nexports.helper = helper;',
        }).replace('const util_1', 'const extra_1 = require("./extra");\nexports.go = exports.helper = void 0;\nconst util_1');
        expect(topChangedBetween(source(), added)).toEqual({ names: [], effects: null });
        expect(changedBetween(source(), added)).toEqual(['<anon>', 'helper']);
    });

    it('changes the name of a class with statics when they change, and an enum is a function that ran while the file loaded', () => {
        const withStatic = (value: string) => source({ extra: `class Slots { static count = ${value}; }` });
        expect(topChangedBetween(withStatic('1'), withStatic('2')).names).toEqual(['Slots']);
        const withEnum = (value: string) => source({ extra: `var Kind;\n(function (Kind) { Kind[Kind["A"] = ${value}] = "A"; })(Kind || (exports.Kind = Kind = {}));` });
        expect(topChangedBetween(withEnum('0'), withEnum('1'))).toEqual({ names: [], effects: null });
        expect(changedBetween(withEnum('0'), withEnum('1'))).toEqual(['<anon>']);
    });
});

/** Builds (folders of files written as dist/ has them) for the plan to compare; their tables and a job's footprint by unit ids */
describe('what a change of the engine reaches', () => {
    const builds = {
        base: {
            'a.js': 'exports.LIMIT = 4;\nfunction helper(x) { return x * 2; }\nexports.helper = helper;\n',
            'b.js': '"use strict";\nconst a_1 = require("./a");\nexports.DOUBLE = a_1.LIMIT * 2;\nfunction useLimit(x) { return x + a_1.LIMIT; }\nfunction useDouble(x) { return x + exports.DOUBLE; }\nfunction plain(x) { return x; }\n',
            'c.js': 'const log = [];\nlog.push(1);\nfunction size() { return log.length; }\n',
        } as Record<string, string>,
    };
    const withFiles = (changes: Record<string, string | ((text: string) => string)>) =>
        Object.fromEntries(Object.entries(builds.base).map(([file, text]) => [file, typeof changes[file] === 'function' ? (changes[file] as (t: string) => string)(text) : (changes[file] as string | undefined) ?? text]));
    const tableOf = (files: Record<string, string>) => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blast-dist-'));
        try {
            for (const [file, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, file), text);
            return tableOfDist(ts, dir).table;
        } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    };
    const baseTable = tableOf(builds.base);
    const unitIndex = (table: any, file: string, id: string) => table.units.findIndex((u: any) => table.files[u[0]] === file && u[1] === id);
    /** A job that ran these units (as `file:id`) and loaded these files */
    const footprint = (units: string[], loaded = ['a.js', 'b.js', 'c.js']) => ({
        loaded: loaded.map(file => baseTable.files.indexOf(file)),
        units: units.map(unit => unitIndex(baseTable, unit.split(':')[0], unit.split(':')[1])),
    });
    const footprints = new Map(Object.entries({
        'limit': footprint(['b.js:useLimit']), 'double': footprint(['b.js:useDouble']), 'plain': footprint(['b.js:plain', 'a.js:helper']),
        'size': footprint(['c.js:size']), 'size-without-c': footprint(['b.js:plain'], ['a.js', 'b.js']),
    }));
    const jobs = [...footprints.keys()].map(key => ({ key, config_sha256: 'c' }));
    const reach = (files: Record<string, string>) => {
        const result = plan({ baseTable, table: tableOf(files), jobs, footprints, baseJobs: new Set(footprints.keys()), baseConfigs: new Map(jobs.map(j => [j.key, 'c'])) });
        return { rerun: result.rerun.map((r: any) => r.key), why: Object.fromEntries(result.rerun.map((r: any) => [r.key, r.why])), names: result.changed_names };
    };

    it('carries every job when nothing differs, or only comments and layout', () => {
        expect(reach(builds.base).rerun).toEqual([]);
        expect(reach(withFiles({ 'a.js': t => `// a note\n${t.replace('x * 2', 'x   *   2')}` })).rerun).toEqual([]);
    });

    it('reruns the jobs that ran a function that changed, and only those', () => {
        expect(reach(withFiles({ 'a.js': t => t.replace('x * 2', 'x * 3') })).rerun).toEqual(['plain']);
    });

    it('reruns the jobs that ran a function that reads a value that changed, through the values computed from it', () => {
        const changed = reach(withFiles({ 'a.js': t => t.replace('LIMIT = 4', 'LIMIT = 5') }));
        expect(changed.rerun).toEqual(['limit', 'double']);
        expect(changed.why.limit).toContain('b.js: useLimit, which reads LIMIT');
        expect(changed.why.double).toContain('b.js: useDouble, which reads DOUBLE');
        expect(changed.names).toEqual(expect.arrayContaining([expect.stringContaining('a.js: LIMIT'), expect.stringContaining('b.js: DOUBLE')]));
    });

    it('does not rerun for a function, a value or an import that is added', () => {
        const added = withFiles({
            'a.js': t => `${t}function more() { return 1; }\nexports.more = more;\nexports.EXTRA = 5;\n`,
            'b.js': t => `const c_1 = require("./c");\n${t}`,
        });
        expect(reach(added).rerun).toEqual([]);
    });

    it('reruns the jobs that loaded a file whose statements that only run changed, and not the others', () => {
        const changed = reach(withFiles({ 'c.js': t => t.replace('log.push(1)', 'log.push(2)') }));
        expect(changed.rerun).toEqual(['limit', 'double', 'plain', 'size']);
        expect(changed.why.plain).toContain('loaded c.js');
        expect(reach(withFiles({ 'a.js': t => `${t}log.push(3);\n` })).rerun).toEqual(['limit', 'double', 'plain', 'size', 'size-without-c']);
    });

    it('reruns jobs that ran a function that is gone', () => {
        expect(reach(withFiles({ 'b.js': t => t.replace('function plain(x) { return x; }', '') })).rerun).toEqual(['plain', 'size-without-c']);
    });
});

describe('the plan', () => {
    const files = ['a.js', 'b.js'];
    const unit = (file: number, id: string, hash: string, refs: number[] = []) => [file, id, hash, refs];
    const top = { entries: {}, effects: [] };
    const baseTable = { files, names: ['n'], tops: [top, top], classes: [], units: [unit(0, 'f', 'h1'), unit(0, 'g', 'h2'), unit(1, 'h', 'h3')] };
    const job = (key: string, config = 'c') => ({ key, config_sha256: config });
    const run = (table: object, jobs: any[], footprints: Record<string, object>, baseConfigs: Record<string, string> = { one: 'c', two: 'c', three: 'c' }) =>
        plan({ baseTable, table, jobs, footprints: new Map(Object.entries(footprints)), baseJobs: new Set(Object.keys(baseConfigs)), baseConfigs: new Map(Object.entries(baseConfigs)) });
    const footprints = { one: { loaded: [0], units: [0, 1] }, two: { loaded: [0, 1], units: [2] }, three: { loaded: [0], units: [1] } };
    const jobs = [job('one'), job('two'), job('three')];

    it('carries every job forward when nothing differs', () => {
        const result = run(baseTable, jobs, footprints);
        expect(result.rerun).toEqual([]);
        expect(result.carry).toEqual(['one', 'two', 'three']);
    });

    it('reruns the jobs that ran a function that differs, and only those', () => {
        const table = { ...baseTable, units: [unit(0, 'f', 'h1'), unit(0, 'g', 'changed'), unit(1, 'h', 'h3')] };
        const result = run(table, jobs, footprints);
        expect(result.rerun.map((r: any) => r.key)).toEqual(['one', 'three']);
        expect(result.rerun[0].why).toContain('g');
        expect(result.carry).toEqual(['two']);
    });

    it('reruns the jobs that ran a function that is gone', () => {
        const table = { ...baseTable, units: [unit(0, 'f', 'h1'), unit(1, 'h', 'h3')] };
        expect(run(table, jobs, footprints).rerun.map((r: any) => r.key)).toEqual(['one', 'three']);
    });

    it('does not rerun for a function that no job ran', () => {
        const notRun = { ...baseTable, units: [unit(0, 'f', 'changed'), unit(0, 'g', 'h2'), unit(1, 'h', 'h3')] };
        expect(run(notRun, [job('three')], footprints).rerun).toEqual([]);
    });

    it('reruns every job when a class that extends another gains or loses a member or changes its heritage, and none for a class that extends nothing', () => {
        const withClass = (members: string, heritage: string, hash = 'hk') => ({ ...baseTable, units: [...baseTable.units, unit(1, 'class K', hash)], classes: [[3, members, heritage]] });
        const before = withClass('m1', 'Base');
        const compare = (base: object, table: object) => plan({ baseTable: base, table, jobs, footprints: new Map(Object.entries(footprints)),
            baseJobs: new Set(['one', 'two', 'three']), baseConfigs: new Map([['one', 'c'], ['two', 'c'], ['three', 'c']]) });
        expect(compare(before, withClass('m1', 'Base')).rerun).toEqual([]);
        const added = compare(before, withClass('m2', 'Base'));
        expect(added.rerun.map((r: any) => r.key)).toEqual(['one', 'two', 'three']);
        expect(added.rerun[0].why).toContain('class K');
        expect(compare(before, withClass('m1', 'Other')).rerun).toHaveLength(3);
        expect(compare(withClass('m1', ''), withClass('m1', 'Base')).rerun).toHaveLength(3);
        expect(compare(withClass('m1', ''), withClass('m2', '')).rerun).toEqual([]);
        // its own code is a unit like any other: only the jobs that ran it rerun
        expect(compare(before, withClass('m1', 'Base', 'changed')).rerun).toEqual([]);
    });

    it('reruns new jobs, jobs whose config changed and jobs with no record', () => {
        const result = run(baseTable, [job('one'), job('two', 'other'), job('three'), job('four')], { one: footprints.one, two: footprints.two });
        expect(Object.fromEntries(result.rerun.map((r: any) => [r.key, r.why]))).toEqual({
            two: 'its config changed', three: 'no record of the functions it ran', four: 'new job',
        });
        expect(result.carry).toEqual(['one']);
    });
});

describe('footprints', () => {
    const text = source();
    const analysis = analyze(ts, text);
    const top = { entries: {}, effects: [] };
    const table = { files: ['m.js'], names: [], tops: [analysis.top], classes: [], units: analysis.units.map((u: any) => [0, u.id, u.hash, []]) };
    const inner = text.indexOf('function inner'), innerEnd = text.indexOf('    return inner(y);');

    it('lists the units that ran with the ones around them, and the files loaded', () => {
        const footprint = footprintOf({ loaded: ['m.js', 'other.js'], executed: { 'm.js': [[inner, text.lastIndexOf('}', innerEnd) + 1]] } }, table, new Map([['m.js', analysis]]));
        expect(footprint.units.map((i: number) => table.units[i][1])).toEqual(['outer', 'outer/inner']);
        expect(footprint.loaded).toEqual([0]);
    });

    it('moves to a new build by unit name, and is dropped if a unit is gone', () => {
        const footprint = { loaded: [0], units: [1, 2] };
        const wider = { files: ['z.js', 'm.js'], names: [], tops: [top, analysis.top], classes: [], units: [[0, 'extra', 'h', []], ...table.units.map(u => [1, u[1], u[2], []])] };
        const moved = translate(footprint, table, wider);
        expect(moved!.loaded).toEqual([1]);
        expect(moved!.units.map((i: number) => wider.units[i][1])).toEqual(table.units.slice(1, 3).map(u => u[1]));
        expect(translate(footprint, table, { files: ['m.js'], names: [], tops: [analysis.top], classes: [], units: table.units.slice(0, 1) })).toBeNull();
    });
});

describe('seeding a run from a cache entry', () => {
    const cache = (...args: string[]) => spawnSync('python3', [path.join(scriptsDir, 'cache.py'), ...args], { encoding: 'utf8' });

    it('copies the carried jobs, marks them claimed, counts what is left and says why the others rerun', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blast-seed-'));
        try {
            const [base, out] = ['base', 'out'].map(name => path.join(dir, name));
            fs.mkdirSync(base); fs.mkdirSync(out);
            for (const key of ['one', 'two']) fs.writeFileSync(path.join(base, `${key}.json`), JSON.stringify({ key }));
            const list = path.join(dir, '_jobs.json');
            fs.writeFileSync(list, JSON.stringify({ jobs: [{ key: 'one' }, { key: 'two' }, { key: 'three' }] }));
            fs.writeFileSync(path.join(out, '.plan.json'), JSON.stringify({
                carry: ['one'], rerun: [{ key: 'two', why: 'ran a.js: f' }, { key: 'three', why: 'new job' }], changed_units: ['a.js: f'], changed_files: [],
            }));
            const seeded = cache('seed', out, base, path.join(dir, 'functions'), list);
            expect(seeded.status).toBe(0);
            expect(seeded.stdout).toContain('1 jobs carried forward, 2 rerun');
            expect(JSON.parse(fs.readFileSync(path.join(out, 'one.json'), 'utf8'))).toEqual({ key: 'one' });
            expect(fs.existsSync(path.join(out, '.claims', 'one'))).toBe(true);
            expect(fs.existsSync(path.join(out, 'two.json'))).toBe(false);
            expect(cache('missing', out, list).stdout.trim()).toBe('2');
            expect(cache('seednote', out).stdout.trim()).toBe('1 jobs carried from base, 2 rerun'.replace('base', path.basename(path.dirname(base))));
        } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    });
});

describe('choosing the entry to carry jobs from', () => {
    const run = (command: string, args: string[], cwd?: string) => {
        const done = spawnSync(command, args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
        if (done.status !== 0) throw new Error(`${command} ${args.join(' ')}: ${done.stderr}`);
        return done.stdout;
    };

    it('takes a commit that differs in the sample configs, not one with other game data, and the nearest first', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blast-bases-'));
        try {
            const repo = path.join(dir, 'repo'), cache = path.join(dir, 'cache');
            const file = (name: string, text: string) => {
                fs.mkdirSync(path.dirname(path.join(repo, name)), { recursive: true });
                fs.writeFileSync(path.join(repo, name), text);
            };
            fs.mkdirSync(repo);
            run('git', ['init', '-q', '-b', 'main'], repo);
            const files: Record<string, string> = {
                'clock-generator/resources/data.json': '{"a":1}', 'clock-generator/resources/config-samples/a.json': '{"s":1}',
                'clock-generator/resources/config-samples/README.md': 'x', 'clock-generator/package-lock.json': '{}',
                'clock-generator/tsconfig.json': '{}', 'clock-generator/src/x.ts': 'export {}',
            };
            const commit = (message: string, changes: Record<string, string>) => {
                Object.assign(files, changes);
                for (const [name, text] of Object.entries(files)) file(name, text);
                run('git', ['add', '-A'], repo);
                run('git', ['commit', '-q', '-m', message], repo);
                return run('git', ['rev-parse', 'HEAD'], repo).trim();
            };
            const first = commit('first', {});
            const sample = commit('a sample', { 'clock-generator/resources/config-samples/a.json': '{"s":2}' });
            const data = commit('game data', { 'clock-generator/resources/data.json': '{"a":2}' });
            const keyOf = (rev: string) => JSON.parse(run('python3', [path.join(scriptsDir, 'key.py'), repo, rev]));
            const entry = (rev: string, tool: string, older = false, name = rev.slice(0, 12)) => {
                const engine = keyOf(rev);
                delete engine.dirty;
                if (older) delete engine.resources_data; // an entry from before the field has it from its commit
                const folder = path.join(cache, name);
                fs.mkdirSync(folder, { recursive: true });
                fs.writeFileSync(path.join(folder, 'MANIFEST.json'), JSON.stringify({ key: name, engine, jobs: { format: 'f' }, functions: { tool } }));
            };
            entry(first, 'tool', true); entry(sample, 'tool'); entry(data, 'tool');
            // not a base: footprints recorded by another version of the tool
            entry(first, 'other', false, 'first-other');
            const newer = commit('code', { 'clock-generator/src/x.ts': 'export const x = 1;' });
            fs.writeFileSync(path.join(dir, 'engine.json'), JSON.stringify(keyOf(newer)));
            fs.writeFileSync(path.join(dir, 'jobs.json'), JSON.stringify({ format: 'f' }));
            const bases = run('python3', [path.join(scriptsDir, 'cache.py'), 'bases', cache, path.join(dir, 'engine.json'), path.join(dir, 'jobs.json'), 'tool', repo])
                .split('\n').filter(Boolean).map(line => JSON.parse(line));
            // the engine at `newer` has the game data of `data`: the one before it (`sample`) and `first` have other data
            expect(bases.map((base: any) => base.rev)).toEqual([data]);
            const olderEngine = keyOf(sample);
            fs.writeFileSync(path.join(dir, 'engine.json'), JSON.stringify(olderEngine));
            const fromSample = run('python3', [path.join(scriptsDir, 'cache.py'), 'bases', cache, path.join(dir, 'engine.json'), path.join(dir, 'jobs.json'), 'tool', repo])
                .split('\n').filter(Boolean).map(line => JSON.parse(line));
            expect(fromSample.map((base: any) => base.rev)).toEqual([sample, first]);
            expect(fromSample.map((base: any) => base.distance)).toEqual([0, 1]);
        } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    });
});
