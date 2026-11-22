// scripts/pair-check.js: the production gate of a timed pair, on small made-up copy checks
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { afterAll, describe, expect, it } from 'vitest';

interface Verdict { pass: boolean; refused: boolean; reason: string; failures: string[]; production: { apart: number; setpoint_per_copy: number } | null; not_checked: string[] }
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { judge, setpointOf } = require('../../scripts/pair-check') as {
    judge: (input: Record<string, unknown>) => Verdict;
    setpointOf: (file: unknown, options?: Record<string, unknown>) => Record<string, unknown>;
};

const script = path.resolve(__dirname, '../../scripts/pair-check.js');
const scratch = path.resolve(__dirname, '../../.scratch/pair-check-test');
fs.mkdirSync(scratch, { recursive: true });
const folder = fs.mkdtempSync(path.join(scratch, 'run-'));
afterAll(() => fs.rmSync(folder, { recursive: true, force: true }));

/** What tools/verify-save.js --copy-grid writes for `finished` (a figure a copy) of `machines` machines a copy */
function copyCheck(options: { finished: number[]; machines?: number; product?: string | null; ticks?: number; inserters?: number }) {
    const { finished, machines = 10, ticks = 3600 } = options;
    const product = options.product === undefined ? 'science' : options.product;
    const inserters = options.inserters ?? 40 * finished.length;
    return {
        groups: [{ count: inserters }],
        copy_grid: {
            product, sampled_ticks: ticks, machines_without_a_track: 0, copies: finished.length, machines: product === null ? inserters : machines * finished.length,
            empty: [], per_copy: finished.map((value, at) => [at, machines, value]),
            min: Math.min(...finished), max: Math.max(...finished),
        },
    };
}
// 3,600 ticks of one build making 6 an item a second, 1 item a craft: 360 crafts a copy
const setpoint = { item: 'science', claim: 360, rate: null, amount: null, builds_per_copy: null, lane_rate: null };
const steady = (value: number, copies = 4) => copyCheck({ finished: Array(copies).fill(value) });
const pair = (today: unknown, other: unknown, extra: Record<string, unknown> = {}) => judge({ today, new: other, setpoint, ...extra });

describe('pair-check judge', () => {
    it('passes two saves that make the setpoint in every copy', () => {
        const verdict = pair(steady(360), steady(360));
        expect(verdict.pass).toBe(true);
        expect(verdict.refused).toBe(false);
        expect(verdict.production?.apart).toBe(0);
    });
    it('passes a gap inside one craft a machine and inside half a percent', () => {
        expect(pair(steady(360), copyCheck({ finished: [361, 360, 359, 360] })).pass).toBe(true);
    });
    it('refuses counts that are by inserter, not by product', () => {
        const verdict = pair(copyCheck({ finished: [360, 360], product: null }), steady(360, 2));
        expect(verdict.refused).toBe(true);
        expect(verdict.pass).toBe(false);
        expect(verdict.reason).toContain('by inserter');
    });
    it('refuses a product count that equals the inserters of the box, whatever the product says', () => {
        const verdict = pair(copyCheck({ finished: [360, 360], machines: 10, inserters: 20 }), steady(360, 2));
        expect(verdict.refused).toBe(true);
        expect(verdict.reason).toContain('count of inserters');
    });
    it('refuses a file with no copy grid, and one with no groups to show its basis', () => {
        expect(pair({}, steady(360)).reason).toContain('no copy grid');
        const bare = { copy_grid: steady(360).copy_grid };
        expect(pair(bare, steady(360)).reason).toContain('cannot be shown');
    });
    it('refuses other products, other ticks, other copies and a sample shorter than the window', () => {
        expect(pair(steady(360), copyCheck({ finished: [360, 360, 360, 360], product: 'other' })).reason).toContain('other products');
        expect(pair(steady(360), copyCheck({ finished: [360, 360, 360, 360], ticks: 960 })).reason).toContain('other ticks');
        expect(pair(steady(360), steady(360, 3)).reason).toContain('other numbers of copies');
        expect(pair(steady(360), copyCheck({ finished: [360, 360, 360, 360], machines: 11 })).reason).toContain('other numbers of machines');
        expect(pair(steady(360), steady(360), { window_ticks: 4000 }).reason).toContain('less than the timed window');
    });
    it('refuses a setpoint of another item and the same save twice', () => {
        expect(judge({ today: steady(360), new: steady(360), setpoint: { ...setpoint, item: 'logistic' } }).reason).toContain('the setpoint is logistic');
        expect(pair(steady(360), steady(360), { same_save: true }).reason).toContain('same file');
    });
    it('fails a copy that one save starves, and says which', () => {
        const verdict = pair(steady(360), copyCheck({ finished: [360, 360, 300, 360] }));
        expect(verdict.refused).toBe(false);
        expect(verdict.pass).toBe(false);
        expect(verdict.reason).toContain('copy 2: 300');
    });
    it('fails a copy that is far from the median in one save even when the saves agree in total', () => {
        const spread = copyCheck({ finished: [330, 390, 360, 360] });
        expect(pair(spread, spread).pass).toBe(false);
    });
    it('fails saves more than half a percent apart, over the larger, even when each copy is inside one craft a machine', () => {
        const verdict = pair(steady(360), steady(357), { setpoint: { ...setpoint, claim: 358.5 }, tolerances: { setpoint_tolerance: 0.01 } });
        expect(verdict.pass).toBe(false);
        expect(verdict.reason).toContain('apart');
    });
    it('fails two saves that agree with each other under the setpoint', () => {
        const verdict = pair(steady(300), steady(300));
        expect(verdict.pass).toBe(false);
        expect(verdict.reason).toContain('under the setpoint');
    });
    it('fails more than the setpoint, unless that is allowed', () => {
        expect(pair(steady(400), steady(400)).reason).toContain('over the setpoint');
        expect(pair(steady(400), steady(400), { allow_above: true }).pass).toBe(true);
    });
    it('holds a build that loads a lane to a stricter line, and to a rate that fills the lane', () => {
        const lane = { ...setpoint, claim: null, rate: 6, amount: 1, builds_per_copy: 1, lane_rate: 6 };
        expect(pair(steady(360), steady(360), { setpoint: lane }).pass).toBe(true);
        expect(pair(steady(358), steady(358), { setpoint: lane }).reason).toContain('not saturated');
        expect(pair(steady(360), steady(360), { setpoint: { ...lane, lane_rate: 7 } }).reason).toContain('does not fill its lane');
    });
    it('reads the clock check against the game when given, and says when it was not', () => {
        expect(pair(steady(360), steady(360)).not_checked.some(line => line.includes('against the game of today'))).toBe(true);
        const sim_game = { today: { pass: true, game_version: '2.1.24' }, new: { pass: false, game_version: '2.1.24' } };
        const verdict = pair(steady(360), steady(360), { sim_game, game_version: '2.1.24' });
        expect(verdict.pass).toBe(false);
        expect(verdict.reason).toContain('new: the clock check against the game did not pass');
        expect(verdict.not_checked.some(line => line.includes('against the game'))).toBe(false);
    });
    it('always says that the lane was not read', () => {
        expect(pair(steady(360), steady(360)).not_checked[0]).toContain('the lane itself');
    });
});

describe('pair-check setpointOf', () => {
    it('reads a reduced config pair for measurement and preserves the rate in metadata', () => {
        const config = (rate: unknown) => ({ setpoint: { item: 'gear', items_per_second: rate } });
        const options = { amount: 1, builds_per_copy: 1 };
        expect(setpointOf(config({ denominator: 7, numerator: 16 }), options).rate).toEqual({ numerator: 16, denominator: 7 });
        expect(() => setpointOf(config({ numerator: 32, denominator: 14 }), options)).toThrow('reduced');
        expect(setpointOf(config({ denominator: 7, numerator: 16 }), { ...options, rate: 2 }).rate).toBe(2);
    });
    it('takes the item and rate of a config, and needs the amount and builds a copy stated', () => {
        const config = { setpoint: { item: 'science', items_per_second: 240, copies: 9 } };
        expect(() => setpointOf(config)).toThrow('--amount');
        expect(setpointOf(config, { amount: 1, builds_per_copy: 1 })).toMatchObject({ item: 'science', rate: 240, amount: 1, builds_per_copy: 1 });
    });
    it('takes a claim file, and options win over it', () => {
        expect(setpointOf({ item: 'science', claim: 360 })).toMatchObject({ item: 'science', claim: 360 });
        expect(setpointOf({ item: 'science', claim: 360 }, { claim: 350 })).toMatchObject({ claim: 350 });
    });
    it('refuses a setpoint with no item or no figure', () => {
        expect(() => setpointOf({ claim: 360 })).toThrow('no item');
        expect(() => setpointOf({ item: 'science' })).toThrow('no figure');
    });
});

describe('pair-check command', () => {
    const write = (name: string, content: unknown) => {
        const file = path.join(folder, name);
        fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
        return file;
    };
    const run = (name: string, today: unknown, other: unknown, extra: string[] = []) => {
        const out = path.join(folder, `${name}.json`);
        const result = spawnSync('node', [script, `--today-save=${write(`${name}-today.zip`, `today ${name}`)}`, `--new-save=${write(`${name}-new.zip`, `new ${name}`)}`,
            `--today-copy-check=${write(`${name}-today-cc.json`, today)}`, `--new-copy-check=${write(`${name}-new-cc.json`, other)}`,
            '--item=science', '--claim=360', '--game-version=2.1.24', `--out=${out}`, ...extra], { encoding: 'utf-8' });
        return { status: result.status, stderr: result.stderr, result: fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf-8')) : null };
    };
    it('writes the result the check gate and the scorer read, tied to both saves', () => {
        const { status, result } = run('ok', steady(360), steady(360));
        expect(status).toBe(0);
        expect(result.pass).toBe(true);
        expect(result.game_version).toBe('2.1.24');
        expect(typeof result.reason).toBe('string');
        expect(Number.isNaN(Date.parse(result.made))).toBe(false);
        expect(Object.keys(result.inputs).sort()).toEqual(['new', 'new_copy_check', 'today', 'today_copy_check']);
        expect(result.inputs.today).toMatch(/^[0-9a-f]{64}$/);
        expect(result.inputs.today).not.toBe(result.inputs.new);
    });
    it('writes pass false with the reason, and exits 1, when it refuses counts by inserter', () => {
        const { status, result } = run('refused', copyCheck({ finished: [360, 360], product: null }), steady(360, 2));
        expect(status).toBe(1);
        expect(result.pass).toBe(false);
        expect(result.refused).toBe(true);
        expect(result.reason).toContain('by inserter');
    });
    it('names the keys of inputs as asked', () => {
        const { result } = run('names', steady(360), steady(360), ['--names=a,b']);
        expect(Object.keys(result.inputs)).toContain('a');
        expect(Object.keys(result.inputs)).toContain('b');
    });
    it('exits 2 and writes nothing for a bad option or a file that is not there', () => {
        const out = path.join(folder, 'never.json');
        expect(spawnSync('node', [script, '--bogus', `--out=${out}`], { encoding: 'utf-8' }).status).toBe(2);
        const missing = spawnSync('node', [script, `--today-save=${path.join(folder, 'none.zip')}`, `--new-save=${path.join(folder, 'none.zip')}`,
            '--today-copy-check=a', '--new-copy-check=b', '--game-version=2.1.24', `--out=${out}`], { encoding: 'utf-8' });
        expect(missing.status).toBe(2);
        expect(fs.existsSync(out)).toBe(false);
    });
});
