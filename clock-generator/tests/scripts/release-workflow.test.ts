// .github/workflows/release.yml: a job that needs another job has a status function in its `if`. Without one GitHub adds
// `success()`, which is false when a job further up the chain was skipped, and `tests` is skipped when a pull request
// already tested the same tree. Before this check, `production` and `sidecar` were skipped on such a release.
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const releaseYml = path.resolve(__dirname, '../../../.github/workflows/release.yml');

interface Job {
    id: string;
    needs: string[];
    condition: string | undefined;
}

/** The jobs of a workflow with the `needs` and the one-line `if` of each (the file keeps both on one line) */
function jobsOf(text: string): Job[] {
    const jobs: Job[] = [];
    let inJobs = false;
    for (const line of text.split('\n')) {
        if (/^jobs:\s*$/.test(line)) {
            inJobs = true;
            continue;
        }
        if (!inJobs) continue;
        if (/^\S/.test(line) && !line.startsWith('#')) break;
        const id = /^ {2}([\w-]+):\s*$/.exec(line);
        if (id) {
            jobs.push({ id: id[1], needs: [], condition: undefined });
            continue;
        }
        const job = jobs[jobs.length - 1];
        const needs = /^ {4}needs:\s*(.*)$/.exec(line);
        if (job && needs) job.needs = needs[1].replace(/[[\]]/g, '').split(',').map(name => name.trim()).filter(Boolean);
        const condition = /^ {4}if:\s*(.*)$/.exec(line);
        if (job && condition) job.condition = condition[1];
    }
    return jobs;
}

/** The jobs that need another job and have no status function in their `if` */
function withoutStatusFunction(jobs: Job[]): string[] {
    return jobs
        .filter(job => job.needs.length > 0)
        .filter(job => !job.condition || !/\b(always|cancelled|failure|success)\(\)/.test(job.condition))
        .map(job => job.id);
}

describe('release.yml', () => {
    const jobs = jobsOf(fs.readFileSync(releaseYml, 'utf8'));

    it('reads the jobs it is meant to have', () => {
        expect(jobs.map(job => job.id)).toEqual(['lookup', 'tests', 'release', 'production', 'sidecar', 'preview']);
        expect(jobs.find(job => job.id === 'production')?.needs).toEqual(['release']);
    });

    it('gives every job that needs another job a status function in its if', () => {
        expect(withoutStatusFunction(jobs)).toEqual([]);
    });

    it('runs production and sidecar only when release succeeded', () => {
        for (const id of ['production', 'sidecar']) {
            const condition = jobs.find(job => job.id === id)?.condition ?? '';
            expect(condition, id).toContain("needs.release.result == 'success'");
        }
    });

    it('finds a job that GitHub would skip after a skipped job further up', () => {
        const before = [
            '    needs: release',
            "    if: needs.release.outputs.sidecar == 'true'",
        ].join('\n');
        const parsed = jobsOf(`jobs:\n  sidecar:\n${before}\n`);
        expect(withoutStatusFunction(parsed)).toEqual(['sidecar']);
    });
});
