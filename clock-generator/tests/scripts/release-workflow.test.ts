// .github/workflows/release.yml: a job that needs another job has a status function in its `if`. Without one GitHub adds
// `success()`, which is false when a job further up the chain was skipped, and `tests` is skipped when a pull request
// already tested the same tree. Before this check, `production` and `sidecar` were skipped on such a release.
// It also checks where the variable `PREVIEW_COMMIT` is set: on the build line of the `preview` job and nowhere else,
// so that the page of the preview has a banner with the commit and the page of production has none.
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

/** The text of one job: from its `  <id>:` line to the next job's line, or to the end of the file */
function jobBody(text: string, id: string): string {
    const lines = text.split('\n');
    const start = lines.findIndex(line => line === `  ${id}:`);
    if (start < 0) return '';
    const next = lines.findIndex((line, index) => index > start && /^ {2}[\w-]+:\s*$/.test(line));
    return lines.slice(start, next < 0 ? undefined : next).join('\n');
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

    describe('PREVIEW_COMMIT', () => {
        const text = fs.readFileSync(releaseYml, 'utf8');
        const buildLine = 'PREVIEW_COMMIT="${GITHUB_SHA::7}" npm run build';

        it('is set on the build line of the preview job', () => {
            const lines = jobBody(text, 'preview').split('\n').map(line => line.trim());
            expect(lines).toContain(buildLine);
        });

        it('is set nowhere in the production job, so production has no banner', () => {
            expect(jobBody(text, 'production')).not.toContain('PREVIEW_COMMIT');
        });

        it('is set in no other job and not at the level of the workflow', () => {
            const outside = text.replace(jobBody(text, 'preview'), '');
            expect(outside).not.toContain('PREVIEW_COMMIT');
        });

        it('is not set in an env of the preview job, where wrangler and every later command would read it', () => {
            const envLines = jobBody(text, 'preview').split('\n').filter(line => /^\s*PREVIEW_COMMIT:/.test(line));
            expect(envLines).toEqual([]);
        });

        it('cuts a job out of a workflow by its line', () => {
            const parsed = ['jobs:', '  a:', '    run: one', '  b:', '    run: two', ''].join('\n');
            expect(jobBody(parsed, 'a')).toBe('  a:\n    run: one');
            expect(jobBody(parsed, 'b')).toBe('  b:\n    run: two\n');
            expect(jobBody(parsed, 'c')).toBe('');
        });
    });
});

// The sidecar mod's version is written twice: in its info.json and in the newest entry of its changelog.txt. A release
// that bumps one and not the other ships a mod whose changelog does not name it.
describe('the sidecar mod version', () => {
    const sidecar = path.resolve(__dirname, '../../../clock-generator-sidecar');

    it('is the same in info.json and in the newest entry of changelog.txt', () => {
        const version = (JSON.parse(fs.readFileSync(path.join(sidecar, 'info.json'), 'utf8')) as { version: string }).version;
        const changelog = fs.readFileSync(path.join(sidecar, 'changelog.txt'), 'utf8');
        expect(changelog.match(/^Version: (\S+)/m)?.[1]).toBe(version);
    });
});
