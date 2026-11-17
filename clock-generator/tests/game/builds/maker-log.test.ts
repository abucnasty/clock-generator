import fs from 'fs'; import path from 'path';
import { beforeAll, describe, expect, it } from 'vitest';
import { generateClockAlternatives } from '../../../src/crafting/generate-blueprint';
import { loadConfigFromFile } from '../../../src/config/loader';
import { ConfigPaths } from '../../../src/config/config-paths';
import { MAKER_LOG_EVENTS, MAKER_LOG_FORMAT, MAKER_REASON_CODES, type MakerLogEvent } from '../../../src/crafting/maker-log';
import { generatedWithMakerLog, makerLogFolder, makerLogLines, makerLogSwitchedOn, repeatCheckSwitchedOn } from './blast-log';
import { digestAlternative, digestJob } from '../../../scripts/blast/blast.digest';
import { handConditionRecorders } from '../../../src/crafting/hand-conditions';
import { windowsHashOf } from '../../../src/crafting/maker-log-events';
import { timetableRecorders } from '../../../src/crafting/timetable';

/** The kinds of event a job gives only where its copies share a lane */
const LANE_KINDS = ['job_lanes', 'lane_facts', 'missed_swings'];

/** The fields of each kind of event that format maker-log-1 had, which maker-log-2 keeps as they were */
const FIRST_FORMAT_FIELDS: Record<string, string[]> = {
    job: ['copies', 'copy_offset', 'event', 'format', 'group', 'job', 'name', 'recipe', 'shared_lanes', 'unknown_end_lanes'],
    clock: ['event', 'holds', 'id', 'job', 'listed_index', 'loss_trials', 'maker', 'meets_target_rate', 'ranked_wake_ups', 'selected',
        'shared_lane_losses', 'shared_lanes_not_checked', 'verdict', 'wake_ups', 'window_cycle_ticks'],
};

const quiet = { log() { }, info() { }, warn() { }, error() { }, debug() { } };
// ignored by git: the package's scratch folder
const SCRATCH = path.resolve(__dirname, '../../../.scratch/maker-log-test');

/** The generation of a job as the blast makes it, with the log a run with BLAST_LOG=1 writes, or without */
function generated(name: keyof typeof ConfigPaths, env: Record<string, string>, out: string) {
    return loadConfigFromFile(ConfigPaths[name]).then(config => generatedWithMakerLog(env, out, { key: `config-${name}`, group: 'config', name },
        (sink, repeat_check) => generateClockAlternatives(config, { logger: quiet, ...(sink && { maker_log: sink }), ...(repeat_check && { maker_log_repeat_check: true }) })));
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
        result = await generated('ACCUMULATOR_320', { BLAST_LOG: '1', BLAST_REPEAT_CHECK: '1' }, out);
        events = readLog(out, 'config-ACCUMULATOR_320');
    }, 120_000);

    it('has every event of the schema but those of the lanes the copies share, each line of the job', () => {
        for (const kind of MAKER_LOG_EVENTS.filter(it => !LANE_KINDS.includes(it))) expect(events.filter(it => it.event === kind).length, `no ${kind} event`).toBeGreaterThan(0);
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

    it('has a timetable and a ledger for each listed clock, and a ledger that adds up to the wakeups the record holds', () => {
        const clocks = events.filter(it => it.event === 'clock');
        const ids = clocks.map(it => it.id);
        expect(events.filter(it => it.event === 'timetable').map(it => it.id)).toEqual(ids);
        expect(events.filter(it => it.event === 'ledger').map(it => it.id)).toEqual(ids);
        for (const clock of clocks) {
            const ledger = events.find(it => it.event === 'ledger' && it.id === clock.id)!;
            const timetable = events.find(it => it.event === 'timetable' && it.id === clock.id)!;
            if (clock.wake_ups === null) {
                expect(ledger.reason, String(clock.id)).toEqual({ code: 'no_run_of_one_copy', cause: 'no_long_run' });
                continue;
            }
            // the ledger of the run whose wakeups the record holds gives the same count over the same ticks
            expect(ledger.reason, String(clock.id)).toBeNull();
            expect(ledger.adds_up, String(clock.id)).toBe(true);
            expect((ledger.record as { wake_ups_per_minute: number }).wake_ups_per_minute).toBe(clock.wake_ups);
            expect(timetable.reason, String(clock.id)).toBeNull();
            const line = timetable.one_copy as { rows: { unmapped_open_ticks: number; windows: unknown[] }[]; errors: string[] };
            expect(line.errors).toEqual([]);
            expect(line.rows.every(row => row.unmapped_open_ticks === 0), String(clock.id)).toBe(true);
        }
    });

    it('has a repeat check for each listed clock where the switch asks for it, run on the clocks that hold on one copy', () => {
        const checks = events.filter(it => it.event === 'repeat_check');
        expect(checks.map(it => it.id)).toEqual(result.alternatives.map(it => it.id));
        for (const check of checks) {
            const clock = events.find(it => it.event === 'clock' && it.id === check.id)!;
            if (!clock.holds) {
                expect(check.reason).toEqual({ code: 'not_repeat_checked', cause: 'does_not_hold_one_copy' });
                continue;
            }
            expect(check.reason, JSON.stringify(check)).toBeNull();
            // the run again on the clock's own windows repeats the first, and the first is the run whose wakeups the record holds
            expect(check.check).toMatchObject({ control_repeats: true, same_needed_as_timetable: true });
        }
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

    it('has the repeat check on for BLAST_REPEAT_CHECK=1 with the log only', () => {
        expect(repeatCheckSwitchedOn({ BLAST_REPEAT_CHECK: '1' })).toBe(false);
        expect(repeatCheckSwitchedOn({ BLAST_LOG: '1' })).toBe(false);
        expect(repeatCheckSwitchedOn({ BLAST_LOG: '1', BLAST_REPEAT_CHECK: '0' })).toBe(false);
        expect(repeatCheckSwitchedOn({ BLAST_LOG: '1', BLAST_REPEAT_CHECK: '1' })).toBe(true);
    });

    it('writes no log, not even its folder, when it is off; and the log changes no clock when it is on', async () => {
        const off = path.join(SCRATCH, 'off');
        const on = path.join(SCRATCH, 'switched-on');
        // with the log off, no recorder of the four conditions goes into any run
        // nor any recorder of the timetable
        const recorders = handConditionRecorders.made;
        const timetables = timetableRecorders.made;
        const without = await generated('FLYING_ROBOT_FRAME_80', {}, off);
        expect(handConditionRecorders.made).toBe(recorders);
        expect(timetableRecorders.made).toBe(timetables);
        expect(fs.existsSync(off)).toBe(false);
        const with_log = await generated('FLYING_ROBOT_FRAME_80', { BLAST_LOG: '1' }, on);
        expect(handConditionRecorders.made).toBeGreaterThan(recorders);
        expect(timetableRecorders.made).toBeGreaterThan(timetables);
        expect(fs.existsSync(makerLogFolder(on))).toBe(true);
        // the results the record holds a digest of are the same with and without the log
        expect(digestJob(with_log).results_sha256).toBe(digestJob(without).results_sha256);
        expect(with_log.alternatives.map(it => digestAlternative(it, undefined).results_sha256)).toEqual(without.alternatives.map(it => digestAlternative(it, undefined).results_sha256));
        expect(with_log.not_made).toEqual(without.not_made);
        // nothing the log keeps reaches an alternative: no component the digest hashes, and no part of the result that shows the lanes
        for (const alternative of with_log.alternatives) {
            expect(JSON.stringify(alternative)).not.toMatch(/for_log|claimed_stacks|lane_load|hand_at_source|missed_swings|readings|needed_by|open_without_pickup|ticks_to_swing|empty_hand_enabled_ticks|ticks_before_stock/);
        }
        expect(with_log.alternatives.map(it => [it.checked_lanes, it.shared_lane_loss_note])).toEqual(without.alternatives.map(it => [it.checked_lanes, it.shared_lane_loss_note]));
        expect(without.alternatives.some(it => it.shared_lane_loss_note !== undefined)).toBe(true);
        // and a clock that loses swings on a lane its copies share says which lane, which item, which copies and how many swings
        const events = readLog(on, 'config-FLYING_ROBOT_FRAME_80');
        const lost = events.filter(it => it.event === 'clock').flatMap(it => it.shared_lane_losses as { belt_id: number; lane: number; item: string; copies: number[]; swings_lost: number }[]);
        expect(lost).toContainEqual({ belt_id: 5, lane: 1, item: 'electronic-circuit', copies: [4, 5, 6], takers_losing: 3, swings_lost: 186 });
        expect(events.find(it => it.event === 'job')!.shared_lanes).toContainEqual({ belt_id: 5, lane: 1, item: 'electronic-circuit' });
        // the events of the first format keep their fields
        for (const [kind, fields] of Object.entries(FIRST_FORMAT_FIELDS)) {
            for (const event of events.filter(it => it.event === kind)) expect(Object.keys(event).sort()).toEqual(fields);
        }
        // every listed clock has one lane_facts event, joined to its windows event by its window cycle and its windows
        const windows = events.filter(it => it.event === 'windows');
        const facts = events.filter(it => it.event === 'lane_facts');
        expect(facts.map(it => it.id)).toEqual(with_log.alternatives.map(it => it.id));
        for (const fact of facts) {
            const own = windows.find(it => it.id === fact.id)!;
            expect([fact.window_cycle_ticks, fact.windows_hash]).toEqual([own.window_cycle_ticks, windowsHashOf(own.windows as Record<string, [number, number][]>)]);
        }
        // a clock that holds on one copy has its facts; one that does not has the reason
        for (const clock of events.filter(it => it.event === 'clock')) {
            const fact = facts.find(it => it.id === clock.id)!;
            if (clock.holds) expect(fact.reason, String(clock.id)).toBeNull();
            else expect(fact.reason).toEqual({ code: 'not_run_with_copies', cause: 'does_not_hold_one_copy' });
        }
        // each taker that loses swings has a missed_swings event, with its copy
        const missed = events.filter(it => it.event === 'missed_swings' && it.id === 'takt_batches_observed' && it.item === 'electronic-circuit');
        expect(missed.map(it => [it.copy, it.belt_id, it.lanes])).toEqual([[4, 5, [1]], [5, 5, [1]], [6, 5, [1]]]);
        expect(events.filter(it => it.event === 'job_lanes')).toHaveLength(1);
        // with the log alone, no repeat check; a clock that holds on one copy has the timetable of each run of the copies
        expect(events.filter(it => it.event === 'repeat_check')).toHaveLength(0);
        for (const clock of events.filter(it => it.event === 'clock' && it.holds)) {
            const timetable = events.find(it => it.event === 'timetable' && it.id === clock.id)!;
            expect((timetable.copies as unknown[]).length, String(clock.id)).toBeGreaterThan(0);
            expect(events.find(it => it.event === 'ledger' && it.id === clock.id)!.adds_up, String(clock.id)).toBe(true);
        }
    }, 120_000);
});
