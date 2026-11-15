import fs from 'fs'; import path from 'path';
import { beforeAll, describe, expect, it } from 'vitest';
import { generateClockAlternatives } from '../../../src/crafting/generate-blueprint';
import { loadConfigFromFile } from '../../../src/config/loader';
import { ConfigPaths } from '../../../src/config/config-paths';
import { MAKER_LOG_EVENTS, MAKER_LOG_FORMAT, MAKER_REASON_CODES, type MakerLogEvent } from '../../../src/crafting/maker-log';
import { generatedWithMakerLog, makerLogFolder, makerLogLines, makerLogSwitchedOn } from './blast-log';
import { digestAlternative, digestJob } from '../../../scripts/blast/blast.digest';

const quiet = { log() { }, info() { }, warn() { }, error() { }, debug() { } };
// ignored by git: the package's scratch folder
const SCRATCH = path.resolve(__dirname, '../../../.scratch/maker-log-test');

/** The generation of a job as the blast makes it, with the log a run with BLAST_LOG=1 writes, or without */
function generated(name: keyof typeof ConfigPaths, env: Record<string, string>, out: string) {
    return loadConfigFromFile(ConfigPaths[name]).then(config => generatedWithMakerLog(env, out, { key: `config-${name}`, group: 'config', name },
        sink => generateClockAlternatives(config, { logger: quiet, ...(sink && { maker_log: sink }) })));
}

const readLog = (out: string, key: string): MakerLogEvent[] =>
    fs.readFileSync(path.join(makerLogFolder(out), `${key}.jsonl`), 'utf8').trim().split('\n').map(line => JSON.parse(line));

describe('the maker log of a blast job', () => {
    // a small job that shows every kind of event: several makers, parts left out, compositions dropped, a maker that made nothing
    const out = path.join(SCRATCH, 'on');
    let result: Awaited<ReturnType<typeof generated>>;
    let events: MakerLogEvent[];
    beforeAll(async () => {
        fs.rmSync(SCRATCH, { recursive: true, force: true });
        result = await generated('ACCUMULATOR_320', { BLAST_LOG: '1' }, out);
        events = readLog(out, 'config-ACCUMULATOR_320');
    }, 120_000);

    it('has every event of the schema, each line of the job', () => {
        for (const kind of MAKER_LOG_EVENTS) expect(events.filter(it => it.event === kind).length, `no ${kind} event`).toBeGreaterThan(0);
        expect(events.every(it => it.job === 'config-ACCUMULATOR_320')).toBe(true);
        expect(events.every(it => (MAKER_LOG_EVENTS as readonly string[]).includes(it.event))).toBe(true);
    });

    it('lists the events in the order of their kinds, the job first and the seconds last', () => {
        const kinds = events.map(it => MAKER_LOG_EVENTS.indexOf(it.event as (typeof MAKER_LOG_EVENTS)[number]));
        expect(kinds).toEqual([...kinds].sort((a, b) => a - b));
        expect(events[0]).toMatchObject({ event: 'job', format: MAKER_LOG_FORMAT, group: 'config', name: 'ACCUMULATOR_320' });
        expect(events.at(-1)!.event).toBe('seconds');
    });

    it('has a clock event and a windows event for each listed clock, the selected one marked once', () => {
        const clocks = events.filter(it => it.event === 'clock');
        expect(clocks.map(it => it.id)).toEqual(result.alternatives.map(it => it.id));
        expect(events.filter(it => it.event === 'windows').map(it => it.id)).toEqual(result.alternatives.map(it => it.id));
        expect(clocks.filter(it => it.selected).map(it => it.listed_index)).toEqual([result.selected_index]);
        for (const clock of clocks) expect(clock).toMatchObject({ verdict: expect.any(String), holds: expect.any(Boolean), maker: expect.any(String) });
    });

    it('gives the reason of each maker that made nothing as a code, and every code is one the schema knows', () => {
        const reasons = events.flatMap(it => (it.reasons as unknown[] | undefined) ?? (it.reason ? [it.reason] : [])).filter(Boolean) as { code: string }[];
        expect(reasons.length).toBeGreaterThan(0);
        for (const reason of reasons) {
            expect(Object.keys(MAKER_REASON_CODES), JSON.stringify(reason)).toContain(reason.code);
            expect(reason.code, 'a reason no site gave a code').not.toBe('other');
            expect(Object.keys(reason).filter(field => field !== 'code').sort()).toEqual([...MAKER_REASON_CODES[reason.code as keyof typeof MAKER_REASON_CODES]].sort());
        }
        expect(events.filter(it => it.event === 'not_made').length).toBe(result.not_made.length);
    });

    it('is written with the job on every line, in an order that does not depend on the order the events were made in', () => {
        const job = { key: 'k', group: 'g', name: 'n' };
        const reversed = [...events].reverse();
        expect(makerLogLines(job, reversed)).toHaveLength(events.length);
        expect(makerLogLines(job, reversed).map(line => JSON.parse(line).event)).toEqual(events.map(it => it.event));
    });
});

describe('the switch of the maker log', () => {
    it('is on for BLAST_LOG=1 only', () => {
        expect(makerLogSwitchedOn({})).toBe(false);
        expect(makerLogSwitchedOn({ BLAST_LOG: '' })).toBe(false);
        expect(makerLogSwitchedOn({ BLAST_LOG: '0' })).toBe(false);
        expect(makerLogSwitchedOn({ BLAST_LOG: '1' })).toBe(true);
    });

    it('writes no log, not even its folder, when it is off; and the log changes no clock when it is on', async () => {
        const off = path.join(SCRATCH, 'off');
        const on = path.join(SCRATCH, 'switched-on');
        const without = await generated('FLYING_ROBOT_FRAME_80', {}, off);
        expect(fs.existsSync(off)).toBe(false);
        const with_log = await generated('FLYING_ROBOT_FRAME_80', { BLAST_LOG: '1' }, on);
        expect(fs.existsSync(makerLogFolder(on))).toBe(true);
        // the results the record holds a digest of are the same with and without the log
        expect(digestJob(with_log).results_sha256).toBe(digestJob(without).results_sha256);
        expect(with_log.alternatives.map(it => digestAlternative(it, undefined).results_sha256)).toEqual(without.alternatives.map(it => digestAlternative(it, undefined).results_sha256));
        expect(with_log.not_made).toEqual(without.not_made);
        // and a clock that loses swings on a lane its copies share says which lane, which item, which copies and how many swings
        const events = readLog(on, 'config-FLYING_ROBOT_FRAME_80');
        const lost = events.filter(it => it.event === 'clock').flatMap(it => it.shared_lane_losses as { belt_id: number; lane: number; item: string; copies: number[]; swings_lost: number }[]);
        expect(lost).toContainEqual({ belt_id: 5, lane: 1, item: 'electronic-circuit', copies: [4, 5, 6], takers_losing: 3, swings_lost: 186 });
        expect(events.find(it => it.event === 'job')!.shared_lanes).toContainEqual({ belt_id: 5, lane: 1, item: 'electronic-circuit' });
    }, 120_000);
});
