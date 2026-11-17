// The maker log of a blast job, written beside the blast's output (scripts/blast/MAKER-LOG.md): one JSON line an event, one file
// a job, `<out>/maker-log/<job>.jsonl`. Off unless BLAST_LOG=1 (`blast.sh run --log`); its repeat check off unless BLAST_REPEAT_CHECK=1 too. Used by scripts/blast/blast.blastrun.ts, which
// finds this file beside the builds' tests, and by the tests of the log. The record never holds it: nothing here reaches a job file.
import fs from 'fs'; import path from 'path';
import { MAKER_LOG_EVENTS, type MakerLogEvent, type MakerLogSink } from '../../../src/crafting/maker-log';

/** Whether the blast writes the maker log: the switch of `blast.sh run --log` */
export function makerLogSwitchedOn(env: Record<string, string | undefined>): boolean {
    return env.BLAST_LOG === '1';
}

/** Whether the maker log also holds the repeat check of each listed clock: the switch of `blast.sh run --repeat-check`, with the log on */
export function repeatCheckSwitchedOn(env: Record<string, string | undefined>): boolean {
    return makerLogSwitchedOn(env) && env.BLAST_REPEAT_CHECK === '1';
}

/** The folder of the logs in a blast's output */
export function makerLogFolder(out: string): string {
    return path.join(out, 'maker-log');
}

/**
 * Runs a job's generation with a sink for the maker log and writes the job's log when it returns; where the switch is off the generation
 * is given no sink and nothing is written, not even the folder. A generation that throws writes no log. `repeat_check` says whether
 * the generation is asked for the repeat check (`repeatCheckSwitchedOn`).
 */
export function generatedWithMakerLog<T>(env: Record<string, string | undefined>, out: string, job: { key: string; group: string; name: string },
    generate: (sink: MakerLogSink | undefined, repeat_check: boolean) => T): T {
    if (!makerLogSwitchedOn(env)) return generate(undefined, false);
    const events: MakerLogEvent[] = [];
    const generated = generate(event => { events.push(event); }, repeatCheckSwitchedOn(env));
    writeMakerLog(out, job, events);
    return generated;
}

/**
 * The lines of a job's log: the events in the order of their kinds (`MAKER_LOG_EVENTS`), those of one kind in the order they were made, each
 * with the job's key first. The `job` event also names the job's group and name. The seconds are the last line, so that two logs of one job
 * are the same without it.
 */
export function makerLogLines(job: { key: string; group: string; name: string }, events: readonly MakerLogEvent[]): string[] {
    const rank = (event: MakerLogEvent) => MAKER_LOG_EVENTS.indexOf(event.event as (typeof MAKER_LOG_EVENTS)[number]);
    return events.map((event, index) => ({ event, index }))
        .sort((a, b) => rank(a.event) - rank(b.event) || a.index - b.index)
        .map(({ event }) => JSON.stringify({ job: job.key, ...(event.event === 'job' && { group: job.group, name: job.name }), ...event }));
}

/** Writes a job's log whole, through a temporary file and a rename, so that a job claimed again never leaves lines twice. Returns the file */
export function writeMakerLog(out: string, job: { key: string; group: string; name: string }, events: readonly MakerLogEvent[]): string {
    const folder = makerLogFolder(out);
    fs.mkdirSync(folder, { recursive: true });
    const file = path.join(folder, `${job.key}.jsonl`);
    const tmp = path.join(folder, `.${job.key}.jsonl.${process.pid}.tmp`);
    fs.writeFileSync(tmp, makerLogLines(job, events).join('\n') + '\n');
    fs.renameSync(tmp, file);
    return file;
}
