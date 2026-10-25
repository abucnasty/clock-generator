import fs from 'fs';
import os from 'os';
import path from 'path';
import {createHash} from 'crypto';
import {expect, test} from 'vitest';
import {loadConfigFromFile} from '../../../src/config/loader';
import {findRepeatedUnits} from '../../../src/config/copies-validator';
import {generateClockAlternatives} from '../../../src/crafting/generate-blueprint';
import {clockFromWindows} from '../../../src/crafting/trial';
import {rotateRanges} from '../../../src/crafting/clock';
import {OpenRange} from '../../../src/data-types';
import {encodeBlueprintFile} from '../../../src/blueprints/serde';
import {recordInFactorio} from '../../../src/harness/factorio-harness';
import {composeProbeSource} from '../helpers/probe-source';

const quiet = {log() {}, info() {}, warn() {}, error() {}, debug() {}};
const sample = path.resolve(__dirname, '../../../resources/config-samples/real/owner/pink-science-original/pink-science-original.json');
const scaffold = sample.replace(/\.json$/, '-scaffold.txt');
const originalHash = '3cb6ca71400bda8580d605cbbc3eff69f4db594ee761a27311bdefe2487573a5';
let generated: Promise<Awaited<ReturnType<typeof fixture>>> | undefined;
async function fixture() {
    const config = await loadConfigFromFile(sample);
    const alternatives = generateClockAlternatives(config, {logger: quiet});
    return {config, selected: alternatives.alternatives[alternatives.selected_index]};
}
async function clockedFixture() { return generated ??= fixture(); }

type Trial = {
    kind: string; item: string; phase_offset: number; cut_phase: number; stopped: boolean; recovered: boolean;
    craft_quiet_ticks: number; output_quiet_ticks: number; joint_quiet_ticks: number;
    hold_periods: number; hold_stock_drift: number; hold_products_finished: number; last_periods: number[][];
    partial_hands_at_restore: {relevant: boolean; count: number; role: string}[];
    advanced_disposal_blocked?: boolean; advanced_disposal_cleared?: boolean;
    red_max: number[]; red_stack_size?: number; red_stop_min: number; recycler_full_ticks?: number[]; red_at_recovery?: number[];
};
type Report = {error?: string; finished: boolean; baseline: number[][]; trials: Trial[];
    topology: {outputs: number; science: number; recyclers: number; capacitors: number; disposal: number};
    maximum_hold_stock_drain: number};
const losses = [
    {kind: 'supply', item: 'accumulator', phase_offset: 0},
    {kind: 'supply', item: 'processing-unit', phase_offset: 7},
    {kind: 'supply', item: 'battery', phase_offset: 13},
    {kind: 'supply', item: 'holmium-plate', phase_offset: 19},
    {kind: 'supply', item: 'superconductor', phase_offset: 27},
    {kind: 'output', item: 'electromagnetic-science-pack', phase_offset: 3},
    {kind: 'output', item: 'advanced-circuit', phase_offset: 31},
];

function exactBaseline(report: Report, periods: number) {
    expect(report.error).toBeUndefined();
    expect(report.finished).toBe(true);
    expect(report.topology).toMatchObject({outputs: 4, science: 4, recyclers: 2, capacitors: 2, disposal: 1});
    expect(report.baseline).toHaveLength(periods);
    expect(report.baseline.every(counts => counts.length === 4 && counts.every(count => count === 16))).toBe(true);
}

for (const run of [
    {name: 'baseline-and-losses', cold: false, order: 'ascending' as const, offset: 0},
    {name: 'cold-start', cold: true, order: 'ascending' as const, offset: 0},
    {name: 'cold-start-reversed-phase13', cold: true, order: 'descending' as const, offset: 13},
]) test(`original electromagnetic science scaffold: ${run.name}`, async context => {
    const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
    context.skip(!factorio || !save || !fs.existsSync(save), 'Factorio harness is not configured');
    const retained = process.env.RECYCLER_ORIGINAL_CAPTURE_DIR;
    const parent = retained ? path.resolve(retained) : fs.mkdtempSync(path.join(os.tmpdir(), 'recycler-original-'));
    const directory = path.join(parent, run.name);
    fs.mkdirSync(directory, {recursive: true});
    try {
        const bytes = fs.readFileSync(scaffold);
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(originalHash);
        const {config, selected} = await clockedFixture();
        expect(config.target_output).toMatchObject({items_per_second: 240, copies: 5});
        expect(selected.verdict).toBe('stable');
        expect(selected.assessment.backpressure_loss?.survives).toBe(true);
        expect(selected.result.simulation_duration.ticks).toBe(40);
        fs.writeFileSync(path.join(directory, 'generation.json'), JSON.stringify({
            selected: selected.id, verdict: selected.verdict, assessment: selected.assessment,
            period: selected.result.simulation_duration.ticks, windows: selected.result.clock_windows,
        }, null, 2));
        const period = 40;
        const windows = Object.fromEntries(Object.entries(selected.result.clock_windows).map(([id, ranges]) => [id,
            rotateRanges(ranges.map(range => OpenRange.from(range.start, range.end)), run.offset, period)
                .map(range => ({start: range.start_inclusive, end: range.end_inclusive})),
        ]));
        const result = run.offset === 0 ? selected.result : clockFromWindows(config, windows, period, quiet);
        const clock = result.subtick ?? result;
        // The engine describes one repeated unit. The normal run wires that unit's clock to both physical copies.
        // For staged cold starts, the harness needs all physical entities so it can rebuild them in a chosen order.
        // Expand only the wiring IDs; combinator conditions and clock windows remain the generated ones.
        const physical = run.cold ? await loadConfigFromFile(path.join(__dirname, 'recycler-original-full-config.json')) : config;
        let schedule = clock.schedule;
        if (run.cold) {
            const groups = findRepeatedUnits(physical).copies;
            expect(groups).toHaveLength(2);
            const reference = config.machines[0].position!;
            const expanded = new Map(config.inserters.map(inserter => [inserter.id!, groups.map(group => {
                const anchor = physical.machines.find(machine => machine.id === group.machine_ids[0])!.position!;
                const x = inserter.position!.x + anchor.x - reference.x;
                const y = inserter.position!.y + anchor.y - reference.y;
                const matched = physical.inserters.filter(other => other.position?.x === x && other.position?.y === y);
                expect(matched).toHaveLength(1);
                return matched[0].id!;
            })]));
            schedule = {...schedule, inserter_combinators: schedule.inserter_combinators.map(combinator => ({...combinator,
                inserter_ids: combinator.inserter_ids.flatMap(id => expanded.get(id)!),
            }))};
        }
        const options = {period, initialization_delay_ticks: run.cold ? 2 : 0, settle_ticks: 24_000, baseline_periods: run.cold ? 600 : 3600,
            minimum_cut_ticks: 12_000, maximum_cut_ticks: 120_000, stopped_ticks: 2400,
            maximum_recovery_ticks: 120_000, recovery_hold_periods: 726, trials: run.cold ? [] : losses,
            last_tick: run.cold ? 48_080 : 1_848_000};
        const {recording} = await recordInFactorio({factorio: factorio!, save: save!, config: physical,
            ...(!run.cold && {copies: 2}),
            blueprint: bytes.toString('utf8').trim(),
            clock: {blueprint: encodeBlueprintFile({blueprint: clock.blueprint}), schedule},
            out: path.join(directory, 'recording.json'), work_dir: path.join(directory, 'game'),
            ticks: run.cold ? options.last_tick : 2 * period, warmup_ticks: 600,
            ...(run.cold ? {staged_start: {build_order: run.order}} : {settle_ticks: options.last_tick + 40}),
            lua: composeProbeSource(path.join(__dirname, 'recycler-original-clock-probe.lua'), options),
            seed: [], unclocked: false, game_speed: 1000, watch: false, timeout_seconds: 1500, log() {},
        });
        const report = JSON.parse(fs.readFileSync(path.join(directory, 'game/script-output/recycler-original.json'), 'utf8')) as Report;
        exactBaseline(report, options.baseline_periods);
        expect(report.baseline.flat().reduce((a, b) => a + b, 0) / (options.baseline_periods * period) * 60).toBe(96);
        const pickups = recording.config.inserters as {source: {pickup_layout?: string; pickup_capture?: {status: string; model_version?: number}}}[];
        const bends = pickups.filter(inserter => inserter.source.pickup_layout === 'bend-right-upstream');
        expect(bends).toHaveLength(2);
        expect(bends.every(inserter => inserter.source.pickup_capture?.status === 'supported'
            && inserter.source.pickup_capture.model_version === 3)).toBe(true);
        if (run.cold) {
            expect(recording.machines.every(machine => machine.samples.products_finished[0] === 0)).toBe(true);
            expect(Object.keys(report.trials).length).toBe(0);
        } else {
            expect(report.trials).toHaveLength(losses.length);
            for (const [index, trial] of report.trials.entries()) {
                expect(trial, trial.item).toMatchObject({kind: losses[index].kind, item: losses[index].item,
                    cut_phase: losses[index].phase_offset, stopped: true, recovered: true, hold_periods: options.recovery_hold_periods});
                expect(trial.craft_quiet_ticks).toBeGreaterThanOrEqual(options.stopped_ticks);
                expect(trial.output_quiet_ticks).toBeGreaterThanOrEqual(options.stopped_ticks);
                expect(trial.hold_stock_drift).toBeGreaterThanOrEqual(-report.maximum_hold_stock_drain);
                expect(trial.hold_products_finished).toBeGreaterThan(0);
                expect(trial.last_periods.every(counts => counts.every(count => count === 16))).toBe(true);
            }
            expect(report.trials.some(trial => trial.partial_hands_at_restore.some(hand => hand.relevant && hand.count > 0 && hand.count < 16)),
                'at least one restoration resumes a relevant partially filled hand').toBe(true);
            const red = report.trials.find(trial => trial.item === 'advanced-circuit')!;
            expect(red.advanced_disposal_blocked).toBe(true);
            expect(red.advanced_disposal_cleared).toBe(true);
            expect(red.red_max.every(count => count >= red.red_stop_min)).toBe(true);
            expect(red.recycler_full_ticks!.every(ticks => ticks > 0)).toBe(true);
            expect(red.red_at_recovery!.every(count => count <= 16)).toBe(true);
        }
        fs.writeFileSync(path.join(directory, 'summary.json'), JSON.stringify({run: run.name, original_scaffold_sha256: originalHash,
            verdict: selected.verdict, science_per_second: 96, all_copies_per_second: 240, copies: 2.5,
            clock_period: period, clock_phase_offset: run.offset, wake_ups_per_minute: selected.assessment.wake_ups_per_minute,
            ...report}, null, 2));
    } finally { if (!retained) fs.rmSync(parent, {recursive: true, force: true}); }
}, 1_800_000);
