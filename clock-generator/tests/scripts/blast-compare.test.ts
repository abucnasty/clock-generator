// scripts/blast/compare.py with --map: the before side's jobs renamed through a map before the join, and the renamed jobs'
// config hashes compared.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { afterAll, describe, expect, it } from 'vitest';

const compare = path.resolve(__dirname, '../../scripts/blast/compare.py');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'blast-compare-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const sha = (c: string) => c.repeat(64);
/** A job file with one alternative, the fields compare.py reads */
const jobFile = (name: string, clock = sha('a')) => {
    const results = { label: sha('1') };
    const alt = { id: 'even-hands', verdict: 'stable', holds: true, rate: 640, supply: null, window_cycle_ticks: 972, wake_ups: 10, clock_sha256: clock, text_sha256: sha('2'), descriptions_cut: 0, results_sha256: sha('3'), results };
    return {
        group: 'config', name, selected_index: 0, results_sha256: sha('4'), job_results: { results_sha256: sha('5'), results },
        selected: alt, alternatives: [alt], seconds: 1,
    };
};

let count = 0;
/** A folder of job files named by name, with a _jobs.json listing config hashes (hashes[name]; a name without one has none) */
const side = (hashes: Record<string, string | null>, withList = true) => {
    const dir = path.join(tmp, `side${count++}`);
    fs.mkdirSync(dir);
    for (const name of Object.keys(hashes)) fs.writeFileSync(path.join(dir, `config-${name}.json`), JSON.stringify(jobFile(name)));
    if (withList) {
        const jobs = Object.entries(hashes).map(([name, h]) => ({ key: `config-${name}`, group: 'config', name, ...(h ? { config_sha256: h } : {}) }));
        fs.writeFileSync(path.join(dir, '_jobs.json'), JSON.stringify({ format: 't1-blast-3', groups: ['config'], count: jobs.length, jobs }));
    }
    return dir;
};
const mapFile = (text: string) => {
    const f = path.join(tmp, `map${count++}.txt`);
    fs.writeFileSync(f, text);
    return f;
};
const run = (...args: string[]) => spawnSync('python3', [compare, ...args], { encoding: 'utf8' });

describe('compare.py --map', () => {
    const before = () => side({ OLD: sha('c'), SAME: sha('d') });
    const after = (hash = sha('c')) => side({ NEW: hash, SAME: sha('d') });

    it('without a map a renamed job is missing after and only in after', () => {
        const done = run(before(), after());
        expect(done.status).toBe(0);
        expect(done.stdout).toContain("('config:OLD', 'missing after', None)");
        expect(done.stdout).toContain("only in after: ['config:NEW']");
        expect(done.stdout).not.toContain('renamed through the map');
    });

    it('with a map the renamed job compares equal and the config hashes are equal', () => {
        const done = run('--map', mapFile('# a rename\n\nconfig-OLD   config-NEW  # trailing\n'), before(), after());
        expect(done.status).toBe(0);
        expect(done.stdout).toContain('jobs 2;');
        expect(done.stdout).toContain('selected clock hash changed: 0');
        expect(done.stdout).toContain('renamed through the map: 1 jobs');
        expect(done.stdout).toContain('config hashes of renamed jobs: 1 of 1 equal');
        expect(done.stdout).toContain('errors/missing: []');
        expect(done.stdout).not.toContain('only in after');
    });

    it('takes --map after the folders and --json along with it', () => {
        const out = path.join(tmp, 'rows.json');
        const done = run(before(), after(), '--json', out, '--map', mapFile('config-OLD config-NEW\n'));
        expect(done.status).toBe(0);
        expect(done.stdout).toContain('renamed through the map: 1 jobs');
        expect(JSON.parse(fs.readFileSync(out, 'utf8')).map((r: any) => r.key)).toEqual(['config:NEW', 'config:SAME']);
    });

    it('lists a renamed job whose config hash differs or is missing', () => {
        const differs = run('--map', mapFile('config-OLD config-NEW\n'), before(), after(sha('e')));
        expect(differs.status).toBe(0);
        expect(differs.stdout).toContain('config hashes of renamed jobs: 0 of 1 equal');
        expect(differs.stdout).toContain('config-OLD -> config-NEW: config hash differs');
        const lacks = run('--map', mapFile('config-OLD config-NEW\n'), before(), side({ NEW: null, SAME: sha('d') }));
        expect(lacks.stdout).toContain('config-OLD -> config-NEW: no config hash (after)');
        const noList = run('--map', mapFile('config-OLD config-NEW\n'), before(), side({ NEW: sha('c'), SAME: sha('d') }, false));
        expect(noList.stdout).toContain('config hashes of renamed jobs not compared');
    });

    it('names a map entry that is not in before and does not fail', () => {
        const done = run('--map', mapFile('config-OLD config-NEW\nconfig-GONE config-ELSE\n'), before(), after());
        expect(done.status).toBe(0);
        expect(done.stdout).toContain("map entries not in before: ['config-GONE']");
        expect(done.stdout).toContain('renamed through the map: 1 jobs');
    });

    it('fails on a malformed map line, naming it', () => {
        const done = run('--map', mapFile('config-OLD config-NEW\nconfig-ONLY_ONE\n'), before(), after());
        expect(done.status).toBe(1);
        expect(done.stderr).toContain('line 2');
        const three = run('--map', mapFile('a b c\n'), before(), after());
        expect(three.status).toBe(1);
    });

    it('fails on two old names mapping to one new name', () => {
        const done = run('--map', mapFile('config-OLD config-NEW\nconfig-SAME config-NEW\n'), before(), after());
        expect(done.status).toBe(1);
        expect(done.stderr).toContain('both map to config-NEW');
    });

    it('fails when a renamed job lands on a name the before side already has', () => {
        const done = run('--map', mapFile('config-OLD config-SAME\n'), before(), after());
        expect(done.status).toBe(1);
        expect(done.stderr).toContain('config:SAME');
    });
});
