// The per-job checks of the record: what a test of one build checks on the result of a blast job that the record does not hold (the
// record holds each alternative's verdict, rate, period, wake-ups, windows and clock hash, and hashes the texts and the assessment,
// but cannot say what a text must read). blast.blastrun.ts runs them where the generated result is in hand, on the result the job already
// made, so a build that is a job of the record is generated once, not once for the record and again by a generation test. A failing
// check is written into the job file as `checks.failures`; `blast.sh record check` fails on any, naming the job, the check and the
// expected and actual values.
//
// A check is a function that throws (vitest's `expect`, whose error holds both values) when the result is not what it states. It
// may simulate again from the result (a loss, a clock-only run), but never generates: the generation is the job's. The checks are
// listed by job key in the files of job-checks/; a build that is not a job of the record, or an option or a search the record does not run,
// stays a generation test (CONTRIBUTING.md, "Which test a check belongs in").
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import type { Config } from '../../../src/config/schema';
import type { ClockAlternativesResult } from '../../../src/crafting/generate-blueprint';
import { SAMPLE_CHECKS } from './job-checks/samples';
import { VARIANT_CHECKS } from './job-checks/variants';
import { FIXTURE_CHECKS } from './job-checks/fixtures';

/** What a check is given: the job's key, its config and the result the job generated */
export interface JobCheckContext {
    job: string;
    config: Config;
    generated: ClockAlternativesResult;
}

export interface JobCheck {
    /** What the check states, as `record check` names it: short, and unique within the job */
    name: string;
    /** Throws when the result is not what the check states */
    run: (context: JobCheckContext) => void;
}

export interface JobCheckFailure {
    check: string;
    /** The failure's message: vitest's, with both values */
    message: string;
    expected?: string;
    actual?: string;
}

/** What the module found on one job */
export interface JobCheckReport {
    /** The hash of the module's files: `record check` refuses a job judged by another version of it */
    module_sha256: string;
    /** The names of the checks that ran */
    ran: string[];
    failures: JobCheckFailure[];
}

/** The checks of each job, by job key (the record's file name without `.json`) */
export const JOB_CHECKS: Record<string, JobCheck[]> = { ...SAMPLE_CHECKS, ...VARIANT_CHECKS, ...FIXTURE_CHECKS };

/** The files of the module, in the order they are hashed: this one, then those of job-checks/ by name */
export function moduleFiles(): string[] {
    const folder = path.join(__dirname, 'job-checks');
    return [__filename, ...fs.readdirSync(folder).filter(file => file.endsWith('.ts')).sort().map(file => path.join(folder, file))];
}

/** The sha256 of each file's path from this file's folder and its text (record.py hashes the same way) */
export function moduleSha256(): string {
    const hash = createHash('sha256');
    for (const file of moduleFiles()) {
        hash.update(path.relative(__dirname, file).split(path.sep).join('/'));
        hash.update('\0');
        hash.update(fs.readFileSync(file));
    }
    return hash.digest('hex');
}

const MOST_CHARACTERS = 1200;
const cut = (text: string) => text.length > MOST_CHARACTERS ? `${text.slice(0, MOST_CHARACTERS)}.. (${text.length} characters)` : text;

function failureOf(check: string, error: unknown): JobCheckFailure {
    const found = error as { message?: unknown; expected?: unknown; actual?: unknown };
    const shown = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value);
    return {
        check, message: cut(String(found?.message ?? error)),
        ...(found?.expected !== undefined && { expected: cut(shown(found.expected)) }),
        ...(found?.actual !== undefined && { actual: cut(shown(found.actual)) }),
    };
}

/** The checks of a job on its generated result (an empty report for a job with none) */
export function runJobChecks(job: string, config: Config, generated: ClockAlternativesResult, checks: JobCheck[] = JOB_CHECKS[job] ?? []): JobCheckReport {
    const failures: JobCheckFailure[] = [];
    for (const check of checks) {
        try { check.run({ job, config, generated }); }
        catch (error) { failures.push(failureOf(check.name, error)); }
    }
    return { module_sha256: moduleSha256(), ran: checks.map(check => check.name), failures };
}
