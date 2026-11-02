// scripts/export-clock.js: the clock files and the cells index that tools/place-clocks.js reads, made without a game.
// It runs the script on automation science (a few seconds) and reads what it wrote against the config and the scaffold.
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { spawnSync } from 'child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigPaths } from '../../src/config/config-paths';

const root = path.resolve(__dirname, '../..');
const script = (name: string) => path.join(root, 'scripts', name);
const config = JSON.parse(fs.readFileSync(ConfigPaths.AUTOMATION_SCIENCE, 'utf-8'));
const scaffold = JSON.parse(zlib.inflateSync(Buffer.from(
    fs.readFileSync(ConfigPaths.AUTOMATION_SCIENCE.replace(/\.json$/, '-scaffold.txt'), 'utf-8').trim().slice(1), 'base64')).toString('utf-8')).blueprint;
const decode = (text: string) => JSON.parse(zlib.inflateSync(Buffer.from(text.slice(1), 'base64')).toString('utf-8')).blueprint;
const read = (...parts: string[]) => JSON.parse(fs.readFileSync(path.join(...parts), 'utf-8'));
const tagOf = (entity: { tags?: Record<string, number[]> }) => entity.tags?.clock_generator_inserters;

let out: string;
let run: ReturnType<typeof spawnSync>;
beforeAll(() => {
    out = fs.mkdtempSync(path.join(os.tmpdir(), 'export-clock-'));
    run = spawnSync('node', [script('export-clock.js'), 'AUTOMATION_SCIENCE', `--out=${out}`, '--alternative=selected', '--always-on'], { cwd: root, encoding: 'utf-8' });
}, 120_000);
afterAll(() => fs.rmSync(out, { recursive: true, force: true }));

describe('export-clock.js on automation science', () => {
    it('writes the selected clock where place-clocks reads it, with the tag on each schedule combinator', () => {
        expect(run.status, String(run.stderr)).toBe(0);
        const arm = read(out, 'full-hand', 'arm.json');
        expect(arm).toMatchObject({ alternative: { id: 'full-hand' }, selected: true, always_on: false, verdict: 'stable', holds: true, recovers: true, config: 'AUTOMATION_SCIENCE' });
        expect(arm.wake_ups_per_minute).toBeGreaterThan(0);
        const clock = read(out, 'full-hand', 'automation-science.json');
        expect(clock.selected).toMatchObject({ id: 'full-hand', verdict: 'stable' });
        expect(clock.period_ticks).toBe(arm.period_ticks);
        expect(clock.counted_ticks).toBeGreaterThan(0);
        const combinators = clock.schedule.inserter_combinators as { entity_number: number; inserter_ids: number[] }[];
        const entities = decode(clock.blueprint).entities;
        for (const combinator of combinators) {
            expect(tagOf(entities.find((entity: { entity_number: number }) => entity.entity_number === combinator.entity_number))).toEqual(combinator.inserter_ids);
        }
        // every inserter the clock names is one of the config
        const ids = combinators.flatMap(it => it.inserter_ids);
        expect(ids.length).toBeGreaterThan(0);
        expect(ids.every(id => id >= 1 && id <= config.inserters.length)).toBe(true);
        expect(entities.filter((entity: object) => tagOf(entity) !== undefined)).toHaveLength(combinators.length);
    });

    it('writes the always-on arm as one combinator wired to the same inserters', () => {
        const clock = read(out, 'full-hand', 'automation-science.json');
        const on = read(out, 'always-on', 'automation-science.json');
        const ids = clock.schedule.inserter_combinators.flatMap((it: { inserter_ids: number[] }) => it.inserter_ids).sort();
        expect(on.schedule.inserter_combinators).toHaveLength(1);
        expect([...on.schedule.inserter_combinators[0].inserter_ids].sort()).toEqual(ids);
        const entities = decode(on.blueprint).entities;
        expect(entities).toHaveLength(1);
        expect(entities[0].name).toBe('arithmetic-combinator');
        expect(tagOf(entities[0])).toEqual(on.schedule.inserter_combinators[0].inserter_ids);
        expect(read(out, 'always-on', 'arm.json')).toMatchObject({ always_on: true, selected: false, inserters_wired: ids.length });
    });

    it('writes cells.json with the scaffold inserter behind each id of the config', () => {
        const { cells } = read(out, 'cells.json');
        expect(cells).toHaveLength(1);
        const [cell] = cells;
        expect(cell).toMatchObject({ name: 'automation-science', config: 'automation-science.json', problems: [], instances: [[0, 0]] });
        expect(Object.keys(cell.inserters).map(Number).sort()).toEqual(config.inserters.map((_: unknown, index: number) => index + 1));
        const at = new Set<string>();
        for (const [id, inserter] of Object.entries<{ name: string; offset: number[]; wired: boolean; has_wire: boolean }>(cell.inserters)) {
            // it stands where the scaffold has an inserter of that name, each once
            const [x, y] = inserter.offset;
            expect(scaffold.entities.some((entity: { name: string; position: { x: number; y: number } }) =>
                entity.name === inserter.name && entity.position.x === x && entity.position.y === y), `inserter ${id}`).toBe(true);
            at.add(`${x},${y}`);
            expect(inserter).toMatchObject({ wired: false, has_wire: false });
        }
        expect(at.size).toBe(config.inserters.length);
    });

    it('refuses an alternative the generator does not have, and says which there are', () => {
        const refused = spawnSync('node', [script('export-clock.js'), 'AUTOMATION_SCIENCE', `--out=${path.join(out, 'refused')}`, '--alternative=nothing', '--no-cells'], { cwd: root, encoding: 'utf-8' });
        expect(refused.status).toBe(1);
        expect(String(refused.stderr)).toContain('No potential clock nothing');
        expect(read(out, 'refused', 'error.json').error).toContain('full-hand');
    });
});

describe('the cells index of a scaffold with a car', () => {
    it('finds the inserters that take from a car and fill a furnace', () => {
        const code = `const { dist, loadSample } = require('./lib'); const { ConfigPaths } = dist('config/config-paths.js');
            const zlib = require('zlib'), fs = require('fs'); const { cellOf } = require('./scaffold-cells');
            loadSample('REAL_OWNER_CAR').then(config => {
                const text = fs.readFileSync(ConfigPaths.REAL_OWNER_CAR.replace(/\\.json$/, '-scaffold.txt'), 'utf-8').trim();
                const blueprint = JSON.parse(zlib.inflateSync(Buffer.from(text.slice(1), 'base64')).toString('utf-8'));
                const { cell, matched } = cellOf({ blueprint, config, name: 'car', clock_file: 'car.json' });
                console.log(JSON.stringify({ matched, count: config.inserters.length, problems: cell.problems, ids: Object.keys(cell.inserters) }));
            });`;
        const result = spawnSync('node', ['-e', code], { cwd: path.join(root, 'scripts'), encoding: 'utf-8' });
        expect(result.status, String(result.stderr)).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual({ matched: 4, count: 4, problems: [], ids: ['1', '2', '3', '4'] });
    });
});
