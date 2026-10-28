// The inputs of the replay check: for every job of the blast's job list (blast.blastrun.ts's loadJobs, the same groups and
// skips), the config as the job builds it and the selected clock's windows and period from a finished blast of the same
// job list, written as one JSON per job into REPLAY_INPUTS. A job whose blast file has no selected clock (a refusal, a
// config error) is written without windows. Run by scripts/replay/replay.sh record, which installs it into the worktree's
// tests/game/builds/.scratch/ beside blast.blastrun.ts (whose job list it reads) and runs it with the blast's
// vitest.scratch-dist.config.ts; it is not run from scripts/.
// Env: REPLAY_JOBS (the blast's jobs folder or cache entry), REPLAY_INPUTS (the folder to write), BLAST_GROUPS,
// BLAST_SKIP, BLAST_ONLY (as the blast reads them).
import fs from 'fs'; import path from 'path';
import { test } from 'vitest';
import { loadJobs, keyOf } from './blast.blastrun';

const JOBS = process.env.REPLAY_JOBS;
const INPUTS = process.env.REPLAY_INPUTS;

/** The value as JSON would write it, and whether that is the value: a config the replay reads back must be plain data */
function plain(config: unknown): boolean {
    const walk = (x: unknown): boolean => {
        if (x === null || ['string', 'boolean'].includes(typeof x)) return true;
        if (typeof x === 'number') return Number.isFinite(x);
        if (typeof x !== 'object') return typeof x === 'undefined';
        if (Array.isArray(x)) return x.every(walk);
        const proto = Object.getPrototypeOf(x);
        return (proto === Object.prototype || proto === null) && Object.values(x as object).every(walk);
    };
    return walk(config);
}

test.skipIf(!JOBS || !INPUTS)('replay inputs', async () => {
    fs.mkdirSync(INPUTS!, { recursive: true });
    const missing: string[] = [];
    let written = 0;
    for (const job of await loadJobs()) {
        const key = keyOf(job);
        const file = path.join(JOBS!, `${key}.json`);
        if (!fs.existsSync(file)) { missing.push(key); continue; }
        const blast = JSON.parse(fs.readFileSync(file, 'utf8'));
        let config: unknown;
        try { config = await job.config(); }
        catch (error: any) { config = null; blast.error ??= `${error?.name}: ${error?.message}`; }
        if (config !== null && !plain(config)) throw new Error(`replay: the config of ${key} is not plain data`);
        const selected = blast.selected;
        const input = { key, group: job.group, name: job.name, config,
            ...(selected?.windows && { windows: selected.windows, period: selected.period }) };
        fs.writeFileSync(path.join(INPUTS!, `${key}.json`), JSON.stringify(input));
        written++;
    }
    fs.writeFileSync(path.join(INPUTS!, '_inputs.json'), JSON.stringify({ written, missing }, null, 1));
    if (missing.length) throw new Error(`replay: ${missing.length} jobs have no blast file in ${JOBS}: ${missing.slice(0, 5).join(', ')}`);
}, 3600_000);
