// The per-job checks of the record (tests/game/builds/record-job-checks.ts): a check that throws is written into the job's report with the
// values it holds, one that does not is not, and every job a check names is a job of the record. No generation.
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { JOB_CHECKS, moduleFiles, moduleSha256, runJobChecks, type JobCheck } from '../game/builds/record-job-checks';
import type { Config } from '../../src/config/schema';
import type { ClockAlternativesResult } from '../../src/crafting/generate-blueprint';

const record = path.resolve(__dirname, '../../record');
const config = {} as Config;
const generated = {
    alternatives: [{ id: 'even-hands', label: 'Time-Division Windows: 5 hands brought in each output cycle', ranking: { meets_target_rate: true }, deciders: 12 }],
    selected_index: 0,
    skipped_searches: [],
} as unknown as ClockAlternativesResult;
const selected = (result: ClockAlternativesResult) => result.alternatives[result.selected_index] as unknown as { label: string; deciders: number; ranking: { meets_target_rate: boolean } };

/** One check of each kind the module's files use, with the value it states right and then wrong */
const kinds = (right: boolean): JobCheck[] => [
    { name: 'a text is what it must read', run: ({ generated: g }) => { expect(selected(g).label).toBe(right ? 'Time-Division Windows: 5 hands brought in each output cycle' : 'Time-Division Windows: 4 hands brought in each output cycle'); } },
    { name: 'a text contains a phrase', run: ({ generated: g }) => { expect(selected(g).label).toContain(right ? 'hands brought in' : 'share one wake window'); } },
    { name: 'a number is close to a figure', run: ({ generated: g }) => { expect(selected(g).deciders).toBeCloseTo(right ? 12.0001 : 13, 2); } },
    { name: 'a list holds', run: ({ generated: g }) => { expect(g.skipped_searches).toEqual(right ? [] : ['Moved Output Swing']); } },
    { name: 'a relation holds on every alternative', run: ({ generated: g }) => { for (const it of g.alternatives) expect(it.ranking.meets_target_rate, it.id).toBe(right); } },
];

describe('runJobChecks', () => {
    it('reports the names of the checks that ran and no failure when every check holds', () => {
        const report = runJobChecks('config-X', config, generated, kinds(true));
        expect(report.ran).toEqual(kinds(true).map(it => it.name));
        expect(report.failures).toEqual([]);
        expect(report.module_sha256).toBe(moduleSha256());
    });

    it('fails each kind of check when its expected value is wrong, with the check and both values', () => {
        const report = runJobChecks('config-X', config, generated, kinds(false));
        expect(report.failures.map(it => it.check)).toEqual(kinds(false).map(it => it.name));
        const [text, contains, close, list, relation] = report.failures;
        expect([text.expected, text.actual]).toEqual(['Time-Division Windows: 4 hands brought in each output cycle', 'Time-Division Windows: 5 hands brought in each output cycle']);
        expect(contains.message).toContain('share one wake window');
        expect(close.message).toContain('13');
        expect([list.expected, list.actual]).toEqual([JSON.stringify(['Moved Output Swing']), JSON.stringify([])]);
        expect(relation.message).toContain('even-hands');
    });

    it('keeps going after a failure, and reports a check that throws something that is not an assertion', () => {
        const report = runJobChecks('config-X', config, generated, [
            { name: 'first', run: () => { throw new Error('boom'); } },
            { name: 'second', run: () => { expect(1).toBe(1); } },
        ]);
        expect(report.ran).toEqual(['first', 'second']);
        expect(report.failures).toEqual([{ check: 'first', message: 'boom' }]);
    });

    it('has nothing to report for a job with no checks', () => {
        expect(runJobChecks('config-NO_CHECKS_HERE', config, generated)).toMatchObject({ ran: [], failures: [] });
    });
});

describe('the checks of the record jobs', () => {
    const keys = Object.keys(JOB_CHECKS);

    it('are of jobs that have a file in the record, with a name each that is its own', () => {
        expect(keys.length).toBeGreaterThan(0);
        for (const key of keys) {
            expect(fs.existsSync(path.join(record, `${key}.json`)), `${key} is a job of the record`).toBe(true);
            const names = JOB_CHECKS[key].map(it => it.name);
            expect(new Set(names).size, `${key}: a check name is used twice`).toBe(names.length);
        }
    });

    it('hash the module\'s files by name, so that a changed or added check is another version', () => {
        const files = moduleFiles().map(file => path.relative(path.resolve(__dirname, '../game/builds'), file));
        expect(files[0]).toBe('record-job-checks.ts');
        expect(files.slice(1)).toEqual(['job-checks/fixtures.ts', 'job-checks/samples.ts', 'job-checks/variants.ts']);
        expect(moduleSha256()).toMatch(/^[0-9a-f]{64}$/);
    });
});
