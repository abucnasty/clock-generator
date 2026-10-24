// The blast radius: generate every sample config (as it is and with backed-up belts) and every pickup, over-hood, front
// and blocked-output fixture and every container config, and hash every alternative's exported clock as over-hood-clock.generation.test.ts does
// (clock_sha256: sha256 of its identity, clockIdentity of subtick ?? result: the blueprint without its text or metadata,
// and the schedule; text_sha256: sha256 of {blueprint, schedule} with the text, which moves with any description); the samples that exist to be refused (ExpectedRefusals in
// src/config/config-paths.ts) are checked instead: each must fail with its error, as it is and backed up. Run by
// scripts/blast/blast.sh, which installs it into the worktree's tests/game/builds/.scratch/ (gitignored), where its
// imports resolve, with vitest.scratch-dist.config.ts (the engine from dist/); it is not run from scripts/.
// Env: BLAST_OUT (folder; one JSON per job, and _jobs.json, the job list with each config's sha256), BLAST_CLAIMS
// (folder shared by parallel processes, default <BLAST_OUT>/.claims: a job is claimed by creating <claims>/<job>),
// BLAST_MODE (generate, the default, or jobs: write _jobs.json only), BLAST_ONLY (comma list of job names),
// BLAST_GROUPS (default config,config-backed,pickup,overhood,front,blocked,containers,refusal), BLAST_SKIP (default
// REAL_THAELN_CELL09; "" runs it), BLAST_FUNCTIONS (0: do not record the functions each job runs; see below), BLAST_ONE (1:
// the process runs the first job nobody has claimed and stops, and leaves <BLAST_OUT>/.drained when none is left: blast.sh
// starts a process for every job, so that no job meets what an earlier one left in the engine's memory, a memo for one).
//
// In generate mode every job also leaves <BLAST_OUT>/.functions/<job>.json: the byte ranges of the functions of the engine's
// build (dist/) that ran during the job, and the files of dist/ loaded so far in this process (V8 binary precise coverage,
// stopped and started again around every job, so that a job's record holds what it ran and not what an earlier job did),
// and <BLAST_OUT>/.functions/.startup.json: what ran before the first job (blast.recorder.ts starts the coverage before
// the engine loads), which every job counts as its own. scripts/blast/functions.js turns these into the job's footprint;
// blast.sh uses footprints to rerun only the jobs a change reaches.
import fs from 'fs'; import path from 'path'; import { createHash } from 'crypto';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import { generateClockAlternatives } from '../../../../src/crafting/generate-blueprint';
import { encodeBlueprintFile } from '../../../../src/blueprints/serde';
import { clockIdentity } from '../../../../src/crafting/clock-identity';
import * as playerDescription from '../../../../src/blueprints/components/player-description';
import { loadConfigFromFile } from '../../../../src/config/loader';
import * as configPaths from '../../../../src/config/config-paths';
import { pickupClockConfig, pickupClockSpeedCases } from '../pickup-clock-speed-coverage';
import { overHoodClockCases, overHoodClockConfig } from '../over-hood-clock-fixtures';

/** The job file format; blast.sh puts it in the cache key, so a change here never hits an older cache entry. 2: clock_sha256
 * is the hash of the clock's identity, without its text (1 hashed the text too) */
const FORMAT = 't1-blast-2';
const quiet = { log() { }, info() { }, warn() { }, error() { }, debug() { } };
const OUT = process.env.BLAST_OUT;
const CLAIMS = process.env.BLAST_CLAIMS || (OUT && path.join(OUT, '.claims'));
const MODE = process.env.BLAST_MODE ?? 'generate';
const ONE = process.env.BLAST_ONE === '1';
const ONLY = process.env.BLAST_ONLY ? process.env.BLAST_ONLY.split(',') : undefined;
// Thaeln's cell 09 is out of scope for 0.19.0 (decided 2026-10-20) and takes ~1,000 s alone: skipped unless BLAST_SKIP
// is set ("" runs it)
const SKIP = (process.env.BLAST_SKIP ?? 'REAL_THAELN_CELL09').split(',').filter(Boolean);
const GROUPS = (process.env.BLAST_GROUPS || 'config,config-backed,pickup,overhood,front,blocked,containers,refusal').split(',');
const { ConfigPaths } = configPaths;
// the samples that exist to be refused, by ConfigPaths key, with the error each must fail with; a worktree from before
// the list has none, and its config groups keep every sample
const REFUSALS: Record<string, { error: string }> = (configPaths as any).ExpectedRefusals ?? {};
// the slowest first, so the parallel processes finish together
const SLOW = ['AGRICULTURAL_SCIENCE', 'REAL_THAELN_CELL09', 'UTILITY_SCIENCE', 'METALLURGIC_SCIENCE_PACK', 'JELLYNUT_PROCESSING_ROCKET_FUEL_BIOCHAMBERS'];

interface Job { group: string; name: string; config: () => Promise<any>; refusal?: { error: string } }
/** The front entrance (32) and front exit, backed up and on a moving config (16; #274); a worktree from before master
 * b77cc09f has no front fixtures and so no front jobs (its job list, and key, stay the 166 of the four other groups) */
async function frontJobs(): Promise<Job[]> {
    const file = path.join(__dirname, '..', 'front-clock-fixtures.ts');
    if (!fs.existsSync(file)) return [];
    // a path, not a literal, so that a worktree without the file neither resolves nor typechecks the import
    const front = await import(file);
    return [...front.frontEntranceClockCases('different-items'), ...front.frontEntranceClockCases('same-item'),
        ...front.frontExitClockCases(true), ...front.frontExitClockCases(false)]
        .map(variant => ({ group: 'front', name: variant.name, config: async () => front.frontClockConfig(variant) }));
}
/** The 16 blocked-output configs (#277: every speed at stack sizes 1-4); none in a worktree from before fb515464 */
async function blockedJobs(): Promise<Job[]> {
    const file = path.join(__dirname, '..', 'blocked-output-clock-fixtures.ts');
    if (!fs.existsSync(file)) return [];
    const blocked = await import(file);
    return blocked.blockedOutputClockCases()
        .map((variant: any) => ({ group: 'blocked', name: variant.name, config: async () => blocked.blockedOutputClockConfig(variant) }));
}
/** The container configs (a car, a tank, a cargo wagon between two inserters); none in a worktree from before them */
async function containerJobs(): Promise<Job[]> {
    const file = path.join(__dirname, '..', 'container-clock-fixtures.ts');
    if (!fs.existsSync(file)) return [];
    const containers = await import(file);
    return containers.containerClockCases()
        .map((variant: any) => ({ group: 'containers', name: variant.name, config: async () => containers.containerClockConfig(variant) }));
}
// as the scaffold recordings generate a backed-up variant: overrides.backed_up_belts
const backedUp = (config: any) => ({ ...config, overrides: { ...config.overrides, backed_up_belts: true } });
const samples = Object.entries(ConfigPaths).filter(([name]) => !(name in REFUSALS));
const baseJobs: Job[] = [
    ...samples.map(([name, file]) => ({ group: 'config', name, config: () => loadConfigFromFile(file as string) })),
    ...samples.map(([name, file]) => ({ group: 'config-backed', name, config: async () => backedUp(await loadConfigFromFile(file as string)) })),
    ...Object.entries(REFUSALS).map(([name, refusal]) => ({ group: 'refusal', name, refusal,
        config: () => loadConfigFromFile((ConfigPaths as Record<string, string>)[name]) })),
    ...(['electromagnetic', 'same-item'] as const).flatMap(family => pickupClockSpeedCases(family).map(variant =>
        ({ group: 'pickup', name: variant.name, config: () => pickupClockConfig(variant) }))),
    ...(['different-items', 'same-item'] as const).flatMap(family => overHoodClockCases(family).map(variant =>
        ({ group: 'overhood', name: variant.name, config: async () => overHoodClockConfig(variant) }))),
];
async function loadJobs(): Promise<Job[]> {
    return [...baseJobs, ...await frontJobs(), ...await blockedJobs(), ...await containerJobs()]
        .sort((a, b) => (SLOW.includes(b.name) ? 1 : 0) - (SLOW.includes(a.name) ? 1 : 0))
        .filter(job => GROUPS.includes(job.group) && !SKIP.includes(job.name) && (!ONLY || ONLY.includes(job.name)));
}
const keyOf = (job: Job) => `${job.group}-${job.name}`;

/** Records the functions of dist/ that run between two takes (V8 coverage that blast.recorder.ts started before the engine
 * loaded; none if BLAST_FUNCTIONS is 0 or the inspector is not there) */
function functionRecorder() {
    const coverage = (globalThis as any).__blastCoverage as { post: (method: string, params?: object) => Promise<any> } | undefined;
    if (process.env.BLAST_FUNCTIONS === '0' || !coverage) return undefined;
    const { post } = coverage;
    const dist = path.resolve(__dirname, '../../../..', 'dist') + path.sep;
    const loaded = new Set<string>();
    const start = () => post('Profiler.startPreciseCoverage', { callCount: false, detailed: false });
    return {
        /** What ran since the last take (or since the recorder started): { loaded, executed } with paths relative to dist/ */
        async take() {
            const { result } = await post('Profiler.takePreciseCoverage');
            await post('Profiler.stopPreciseCoverage'); await start();
            const executed: Record<string, number[][]> = {};
            for (const script of result as { url: string; functions: { ranges: { startOffset: number; endOffset: number; count: number }[] }[] }[]) {
                if (!script.url.startsWith('file://')) continue;
                const file = fileURLToPath(script.url);
                if (!file.startsWith(dist) || !file.endsWith('.js')) continue;
                const rel = path.relative(dist, file).split(path.sep).join('/');
                loaded.add(rel);
                const ran = script.functions.filter(fn => fn.ranges[0].count > 0).map(fn => [fn.ranges[0].startOffset, fn.ranges[0].endOffset]);
                if (ran.length) executed[rel] = ran;
            }
            return { loaded: [...loaded].sort(), executed };
        },
    };
}

const sha = (x: unknown) => createHash('sha256').update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex');
/** JSON with every object's keys sorted; anything that is not plain data is named, so that it cannot hash as {} */
function canonical(x: unknown): unknown {
    if (x === null || typeof x !== 'object') return typeof x === 'function' ? `<function ${(x as any).name}>` : x;
    if (Array.isArray(x)) return x.map(canonical);
    if (x instanceof Map) return { '<Map>': [...x.entries()].map(([k, v]) => [canonical(k), canonical(v)]) };
    if (x instanceof Set) return { '<Set>': [...x.values()].map(canonical) };
    const proto = Object.getPrototypeOf(x);
    const named = proto && proto !== Object.prototype ? { '<class>': proto.constructor?.name } : {};
    return Object.fromEntries([...Object.entries(named), ...Object.keys(x).sort().map(k => [k, canonical((x as any)[k])])]);
}

/** The job list and each job's input, which blast.sh puts in the cache key (rewritten, atomically, when it differs) */
async function writeJobList(jobs: Job[]) {
    const file = path.join(OUT!, '_jobs.json');
    const list = [];
    for (const job of jobs) {
        let config_sha256: string;
        try { config_sha256 = sha(JSON.stringify(canonical(await job.config()))); }
        catch (error: any) { config_sha256 = 'error:' + sha(`${error?.name}: ${error?.message}`); }
        list.push({ key: keyOf(job), group: job.group, name: job.name, config_sha256 });
    }
    list.sort((a, b) => a.key.localeCompare(b.key));
    const jobs_sha256 = sha(JSON.stringify({ format: FORMAT, list }));
    try { if (JSON.parse(fs.readFileSync(file, 'utf8')).jobs_sha256 === jobs_sha256) return; } catch { /* absent or partial */ }
    const body = { format: FORMAT, groups: GROUPS, skip: SKIP, only: ONLY ?? null, count: list.length, jobs_sha256, jobs: list };
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(body, null, 1));
    fs.renameSync(tmp, file);
}

/** Descriptions Factorio's 500 bytes cut, the blueprints' own and their combinators', in an alternative's plain, modulo
 * and subtick blueprints (null in a worktree from before the count); compare.py lists any */
function descriptionsCut(result: any): number | null {
    const wasCut = (playerDescription as any).wasCut as ((description: string) => boolean) | undefined;
    if (!wasCut) return null;
    const blueprints = [result.blueprint, result.modulo_blueprint, result.subtick?.blueprint].filter(Boolean);
    return blueprints.filter((blueprint: any) => wasCut(blueprint.description ?? '')).length
        + blueprints.flatMap((blueprint: any) => blueprint.entities ?? [])
            .filter((entity: any) => wasCut(entity.player_description ?? '')).length;
}

/** Every alternative of a config, each exported clock hashed, and the selected one */
function clocksOf(config: any) {
    const generated = generateClockAlternatives(config, { logger: quiet });
    const summary = (a: any) => {
        const exported = a.result.subtick ?? a.result;
        const with_text = { blueprint: encodeBlueprintFile({ blueprint: exported.blueprint }), schedule: exported.schedule };
        return {
            id: a.id, verdict: a.verdict, holds: a.assessment.holds, rate: a.assessment.items_per_second,
            supply: a.belt?.kind ?? null, period: a.result.subtick?.clock.period_ticks ?? a.result.simulation_duration.ticks,
            wake_ups: a.assessment.wake_ups?.wake_ups_per_minute ?? a.result.stability_check?.as_built?.wake_ups?.wake_ups_per_minute ?? null,
            clock_sha256: sha(clockIdentity(exported)), text_sha256: sha(with_text), descriptions_cut: descriptionsCut(a.result), windows_sha256: sha(a.result.clock_windows), windows: a.result.clock_windows,
        };
    };
    return {
        selected_index: generated.selected_index,
        selected: summary(generated.alternatives[generated.selected_index]), alternatives: generated.alternatives.map(summary),
    };
}

/** A refusal check: generating the sample as it is and backed up must throw an error whose message holds the list's
 * (as `expected-refusals.test.ts`); `refused` is whether both did. No `error` field: a check is not a config error */
function refusalCheck(config: any, refusal: { error: string }) {
    const outcome = (c: any) => {
        try { generateClockAlternatives(c, { logger: quiet }); return { error: null, as_expected: false }; }
        catch (error: any) { return { error: `${error?.name}: ${error?.message}`, as_expected: String(error?.message).includes(refusal.error) }; }
    };
    const as_is = outcome(config), backed_up = outcome(backedUp(config));
    return { expected_error: refusal.error, refused: as_is.as_expected && backed_up.as_expected,
        errors: { as_is: as_is.error, backed_up: backed_up.error } };
}

test.skipIf(!OUT)('blast', async () => {
    fs.mkdirSync(OUT!, { recursive: true }); fs.mkdirSync(CLAIMS!, { recursive: true });
    const jobs = await loadJobs();
    // one job per process: blast.sh writes the job list first, and each process would build every config again
    if (!ONE || MODE === 'jobs' || !fs.existsSync(path.join(OUT!, '_jobs.json'))) await writeJobList(jobs);
    if (MODE === 'jobs') return;
    const recorder = functionRecorder();
    if (recorder) {
        // what ran before the first job: the engine loading and the job list. Every job depends on it, so it is a record of its own
        const startup = path.join(OUT!, '.functions', '.startup.json');
        fs.mkdirSync(path.dirname(startup), { recursive: true });
        fs.writeFileSync(`${startup}.${process.pid}.tmp`, JSON.stringify(await recorder.take()));
        fs.renameSync(`${startup}.${process.pid}.tmp`, startup);
    }
    for (const job of jobs) {
        const key = keyOf(job);
        try { fs.mkdirSync(path.join(CLAIMS!, key)); } catch { continue; }
        await recorder?.take();
        const started = Date.now();
        let body: any;
        try {
            const config = await job.config();
            body = { group: job.group, name: job.name, ...(job.refusal ? refusalCheck(config, job.refusal) : clocksOf(config)) };
        } catch (error: any) {
            body = { group: job.group, name: job.name, error: `${error?.name}: ${error?.message}` };
        }
        body.seconds = (Date.now() - started) / 1000;
        if (recorder) {
            // before the job's result: a result without its record cannot be carried forward, a record without a result is overwritten
            const footprint = path.join(OUT!, '.functions', `${key}.json`);
            fs.writeFileSync(`${footprint}.${process.pid}.tmp`, JSON.stringify(await recorder.take()));
            fs.renameSync(`${footprint}.${process.pid}.tmp`, footprint);
        }
        const tmp = path.join(OUT!, `.${key}.json.${process.pid}.tmp`);
        fs.writeFileSync(tmp, JSON.stringify(body));
        fs.renameSync(tmp, path.join(OUT!, `${key}.json`));
        if (ONE) return;
    }
    if (ONE) fs.writeFileSync(path.join(OUT!, '.drained'), '');
}, 24 * 3600_000);
