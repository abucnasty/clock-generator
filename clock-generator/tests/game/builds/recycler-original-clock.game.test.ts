import fs from 'fs';
import os from 'os';
import path from 'path';
import {createHash} from 'crypto';
import zlib from 'zlib';
import {expect, test} from 'vitest';
import {loadConfigFromFile} from '../../../src/config/loader';
import {generateClockAlternatives} from '../../../src/crafting/generate-blueprint';
import {encodeBlueprintFile} from '../../../src/blueprints/serde';
import {matchBuiltCopies, recordInFactorio, scheduledInserterIds, stagedBuildOrder} from '../../../src/harness/factorio-harness';
import {composeProbeSource} from '../helpers/probe-source';
import {branchSeriesLedger, nativeScienceLedger} from '../helpers/science-ledger';

/**
 * The exact 211-entity scaffold of #100 (two cells, 96 science a second) under the clock the generator selects for the
 * sample's automatic config (one cell at 48 a second, five copies for 240): no manual window, no Always, no fixed
 * count. One run of 3,600 periods with nine losses, and two cold starts. The clock is the generator's, never changed in the
 * game: the clock's blueprint and schedule of the selected alternative wire both physical copies.
 */
const quiet = {log() {}, info() {}, warn() {}, error() {}, debug() {}};
const sample = path.resolve(__dirname, '../../../resources/config-samples/real/owner/pink-science-original/pink-science-original.json');
const scaffold = sample.replace(/\.json$/, '-scaffold.txt');
const originalHash = '3cb6ca71400bda8580d605cbbc3eff69f4db594ee761a27311bdefe2487573a5';
const probe = path.join(__dirname, 'recycler-original-clock-probe.lua');
const period = 40;
const settleTicks = 24_000;
const holdPeriods = 726;
type Loss = {kind: 'supply' | 'output'; item: string; phase_offset: number};
// Losses at probe phases. The two battery cuts at 18 and 38 are the first ticks after each supercapacitor arm's turn
// (the clock's windows for the two arms that take from one plant are modeled 3-12 and 23-32; the probe reads 5 ticks later).
const losses: Loss[] = [
    {kind: 'supply', item: 'accumulator', phase_offset: 0},
    {kind: 'supply', item: 'processing-unit', phase_offset: 7},
    {kind: 'supply', item: 'battery', phase_offset: 13},
    {kind: 'supply', item: 'holmium-plate', phase_offset: 19},
    {kind: 'supply', item: 'superconductor', phase_offset: 27},
    {kind: 'output', item: 'electromagnetic-science-pack', phase_offset: 3},
    {kind: 'output', item: 'advanced-circuit', phase_offset: 31},
    {kind: 'supply', item: 'battery', phase_offset: 38},
    {kind: 'supply', item: 'battery', phase_offset: 18},
];
// the tick the probe may run to: the settle, the baseline and one allowance for each loss (cut, recovery and the hold)
const BASELINE_TICKS = 3600 * period, LOSS_TICKS = 240_000;
const lossesLastTick = settleTicks + BASELINE_TICKS + losses.length * LOSS_TICKS;
// the first seven losses must recover within the tick the run first allowed them, each later one within one more allowance
const recoveryCaps = losses.map((_, index) => lossesLastTick - (losses.length - Math.max(7, index + 1)) * LOSS_TICKS);

type Run = {name: string; cold: boolean; order: 'ascending' | 'descending'; phase: number};
const runs: Run[] = [
    {name: 'baseline-and-losses', cold: false, order: 'ascending', phase: 0},
    {name: 'cold-start', cold: true, order: 'ascending', phase: 0},
    {name: 'cold-start-reversed-phase13', cold: true, order: 'descending', phase: 13},
];

let generated: Promise<Awaited<ReturnType<typeof fixture>>> | undefined;
async function fixture() {
    const config = await loadConfigFromFile(sample);
    const alternatives = generateClockAlternatives(config, {logger: quiet});
    return {config, selected: alternatives.alternatives[alternatives.selected_index]};
}
const clockedFixture = () => generated ??= fixture();

const values = (value: unknown): any[] => Object.values(value ?? {});
const key = (at: {x: number; y: number}) => `${at.x},${at.y}`;

for (const run of runs) test(`original electromagnetic science scaffold, automatic clock: ${run.name}`, async context => {
    const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
    context.skip(!factorio || !save || !fs.existsSync(save), 'Factorio harness is not configured');
    const retained = process.env.RECYCLER_ORIGINAL_CAPTURE_DIR;
    const parent = retained ? path.resolve(retained) : fs.mkdtempSync(path.join(os.tmpdir(), 'recycler-original-'));
    const directory = path.join(parent, run.name);
    fs.mkdirSync(directory, {recursive: true});
    try {
        const bytes = fs.readFileSync(scaffold);
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(originalHash);
        const entities = JSON.parse(zlib.inflateSync(Buffer.from(bytes.toString('utf8').trim().slice(1), 'base64')).toString('utf8')).blueprint.entities;
        expect(entities).toHaveLength(211);
        const {config, selected} = await clockedFixture();

        // The sample is automatic: nothing fixed, and the selected clock is the one built for it
        expect(config.target_output).toMatchObject({items_per_second: 240, copies: 5});
        expect(config.overrides?.lcm).toBeUndefined();
        expect(config.overrides?.terminal_swing_count).toBeUndefined();
        const result = selected.result;
        expect(selected.verdict).toBe('stable');
        expect(selected.assessment.backpressure_loss?.survives).toBe(true);
        expect(selected.assessment.backpressure_loss?.not_tried ?? []).toHaveLength(0);
        expect(result.stability_check.as_built?.holds).toBe(true);
        expect(result.simulation_duration.ticks).toBe(period);
        expect(Object.keys(result.always_on_reasons ?? {})).toHaveLength(0);
        const ids = config.inserters.map((row, index) => row.id ?? index + 1).sort((a, b) => a - b);
        expect(ids).toHaveLength(12);
        expect(scheduledInserterIds(result.schedule)).toEqual(ids);
        // the two arms that take from the supercapacitor plants take turns: never open in the same tick
        const open = (windows: {start: number; end: number}[] | undefined, tick: number) => (windows ?? []).some(w => tick >= w.start && tick <= w.end);
        const [turnsA, turnsB] = [result.clock_windows['inserter:6'], result.clock_windows['inserter:7']];
        expect(turnsA && turnsB).toBeTruthy();
        expect([...Array(period).keys()].filter(tick => open(turnsA, tick) && open(turnsB, tick))).toEqual([]);
        fs.writeFileSync(path.join(directory, 'generation.json'), JSON.stringify({
            selected: selected.id, verdict: selected.verdict, assessment: selected.assessment,
            period, windows: result.clock_windows,
        }, null, 2));
        const combinatorOf = new Map<number, number>(result.schedule.inserter_combinators
            .flatMap((row: any) => row.inserter_ids.map((id: number) => [id, row.entity_number] as const)));

        const options = run.cold
            ? {period, initialization_delay_ticks: 2, settle_ticks: settleTicks, baseline_periods: 600, minimum_cut_ticks: 12_000, maximum_cut_ticks: 120_000,
                stopped_ticks: 2400, maximum_recovery_ticks: 120_000, recovery_hold_periods: holdPeriods, trials: [] as Loss[], last_tick: 48_080}
            : {period, initialization_delay_ticks: 0, settle_ticks: settleTicks, baseline_periods: 3600, minimum_cut_ticks: 12_000, maximum_cut_ticks: 120_000,
                stopped_ticks: 2400, maximum_recovery_ticks: 120_000, recovery_hold_periods: holdPeriods, trials: losses, last_tick: lossesLastTick};
        const {recording, build, start} = await recordInFactorio({factorio: factorio!, save: save!, config, copies: 2,
            blueprint: bytes.toString('utf8').trim(),
            clock: {blueprint: encodeBlueprintFile({blueprint: result.blueprint}), schedule: result.schedule},
            out: path.join(directory, 'recording.json'), work_dir: path.join(directory, 'game'),
            ticks: run.cold ? options.last_tick : 2 * period, warmup_ticks: 600,
            ...(run.cold ? {staged_start: {build_order: run.order, clock_phase: run.phase}} : {settle_ticks: options.last_tick + 40}),
            lua: composeProbeSource(probe, options),
            seed: [], unclocked: false, game_speed: 1000, watch: false, timeout_seconds: 1500, log() {},
        }) as any;
        const report = JSON.parse(fs.readFileSync(path.join(directory, 'game/script-output/recycler-original.json'), 'utf8'));
        expect(report.error).toBeUndefined();
        expect(report.finished).toBe(true);
        expect(report.topology).toMatchObject({outputs: 4, science: 4, recyclers: 2, capacitors: 2, disposal: 1});
        expect(report.topology.red_outlets).toHaveLength(2);
        expect(report.baseline).toHaveLength(options.baseline_periods);
        expect(report.baseline.every((counts: number[]) => counts.length === 4 && counts.every(count => count === 16))).toBe(true);
        expect(report.baseline.flat().reduce((a: number, b: number) => a + b, 0) / (options.baseline_periods * period) * 60).toBe(96);

        // Wiring: 24 arms, two for each of the 12 configured inserters, and none of the six feeders the scaffold brings
        const wired = values(start.clock?.wired);
        const wiredUnits = new Set<number>(wired.map(row => row.unit_number));
        expect(build.removed_clock_combinators).toBe(0);
        expect(build.clocked_inserters).toBe(0);
        expect(values(build.failed)).toHaveLength(0);
        expect(wired).toHaveLength(24);
        expect(wiredUnits.size).toBe(24);
        expect(values(start.clock?.running_free)).toHaveLength(0);
        for (const id of ids) expect(wired.filter(row => row.inserter === id), `two arms for inserter ${id}`).toHaveLength(2);
        const recordedConfig = (recorded: any) => recording.config.inserters.find((row: any, index: number) => (row.id ?? index + 1) === recorded.id);
        const external = recording.inserters.filter((row: any) => row.source.type === 'chest' && row.sink.type === 'belt');
        const chestTypes = new Map<number, string>((recording.config.chests ?? []).map((row: any, index: number) => [row.id ?? index + 1, row.type]));
        expect(external).toHaveLength(6);
        expect(external.every((row: any) => chestTypes.get(row.source.id) === 'infinity-chest' && !wiredUnits.has(row.unit_number))).toBe(true);
        // positions: per schedule combinator the arms a copy wires stand at the modeled positions of their ids, moved by the
        // copy's translation (arms with alike ends, the two final takers, cannot be told apart by structure), copies 13 tiles apart
        const arms: {copy: number; config_id: number; unit: number; at: {x: number; y: number}}[] = [];
        if (run.cold) {
            const staged = start.staged;
            const placed = values(staged.placed), preexisting = values(staged.preexisting);
            const positions = new Map<number, {x: number; y: number}>(values(report.topology.arms).map((row: any) => [row.unit, row.position]));
            for (const row of [...placed, ...preexisting]) arms.push({copy: row.copy, config_id: row.config_id, unit: row.unit_number, at: positions.get(row.unit_number)!});
            expect(arms).toHaveLength(24);
            expect(arms.every(arm => arm.at && wired.some(w => w.inserter === arm.config_id && w.unit_number === arm.unit))).toBe(true);
            expect(arms.map(arm => arm.unit).sort((a, b) => a - b)).toEqual([...wiredUnits].sort((a, b) => a - b));
        } else {
            const described = {config: recording.config, inserters: Object.fromEntries(recording.inserters.map((row: any) => [row.id, row])),
                machines: Object.fromEntries(recording.machines.map((row: any) => [row.id, row]))};
            const copies = matchBuiltCopies(described, config, 2);
            const recordedByUnit = new Map<number, any>(recording.inserters.map((row: any) => [row.unit_number, row]));
            expect(copies).toHaveLength(2);
            copies.forEach((copy, index) => {
                expect(copy.size).toBe(12);
                for (const id of ids) {
                    const unit = copy.get(id)!, recorded = recordedByUnit.get(unit);
                    expect(wired.some(row => row.inserter === id && row.unit_number === unit), `copy ${index + 1} arm ${id} is wired to its own id`).toBe(true);
                    arms.push({copy: index, config_id: id, unit, at: recordedConfig(recorded).position});
                }
            });
            expect(arms.map(arm => arm.unit).sort((a, b) => a - b)).toEqual([...wiredUnits].sort((a, b) => a - b));
        }
        const translations = [0, 1].map(copy => {
            const rows = arms.filter(arm => arm.copy === copy).map(arm => ({...arm,
                modeled: config.inserters.find((row, index) => (row.id ?? index + 1) === arm.config_id)!.position!}));
            const votes = new Map<string, number>();
            for (const row of rows) { const k = key({x: row.at.x - row.modeled.x, y: row.at.y - row.modeled.y}); votes.set(k, (votes.get(k) ?? 0) + 1); }
            const [tx, ty] = [...votes].sort((a, b) => b[1] - a[1])[0][0].split(',').map(Number);
            for (const combinator of new Set(rows.map(row => combinatorOf.get(row.config_id)))) {
                const group = rows.filter(row => combinatorOf.get(row.config_id) === combinator);
                expect(group.map(row => key(row.at)).sort(), `copy ${copy + 1}: the arms of schedule combinator ${combinator} stand at the modeled positions of their ids`)
                    .toEqual(group.map(row => key({x: row.modeled.x + tx, y: row.modeled.y + ty})).sort());
            }
            return {x: tx, y: ty};
        });
        expect(translations[1].x - translations[0].x).toBe(13);
        expect(translations[1].y).toBe(translations[0].y);
        const bends = recording.inserters.filter((row: any) => row.source.pickup_layout === 'bend-right-upstream');
        expect(bends).toHaveLength(2);
        expect(bends.every((row: any) => row.source.pickup_capture?.status === 'supported' && row.source.pickup_capture.model_version === 3)).toBe(true);
        expect(new Set(bends.map((row: any) => wired.find(w => w.unit_number === row.unit_number)?.inserter)).size, 'both curved pickups are one id, one in each copy').toBe(1);
        // (a cold recording starts before the recyclers have chosen a recipe, so it cannot name their targets)
        if (!run.cold) {
            expect(recording.config.machines.filter((row: any) => row.result_target)).toHaveLength(2);
            expect(report.topology.recycler_targets).toHaveLength(2);
        }

        // The science of each branch (a plant, its steel buffer and the arms between) closes at every period boundary
        const ledger = nativeScienceLedger(recording, report);
        const series = branchSeriesLedger(report, {settle_ticks: options.settle_ticks, baseline_periods: options.baseline_periods, hold_periods: holdPeriods});
        fs.writeFileSync(path.join(directory, 'branch-ledger.json'), JSON.stringify(ledger, null, 2));
        fs.writeFileSync(path.join(directory, 'branch-series-ledger.json'), JSON.stringify(series, null, 2));
        expect(ledger.endpoint_component_sums_match).toBe(true);
        expect(ledger.unassigned_science_hands).toHaveLength(0);
        expect(ledger.spans_without_recovered_hold).toHaveLength(0);
        expect(ledger.probe_branch_map_matches, 'the probe and the recorder name the same units for each branch').toBe(true);
        expect(series.columns_consistent).toBe(true);
        expect(series.boundary_gaps).toHaveLength(0);
        expect(series.first_tick).toBe(series.expected_first_tick);
        expect(series.baseline_bins).toBe(options.baseline_periods);
        const baseline = series.spans.find((span: any) => span.name === 'baseline');
        expect(baseline.branches.map((b: any) => b.reserve_start)).toEqual(report.baseline_stock_start.reserve_by_branch);
        expect(baseline.branches.map((b: any) => b.reserve_end)).toEqual(report.baseline_stock_end.reserve_by_branch);
        expect(series.residual_nonzero, JSON.stringify(series.first_residuals.slice(0, 3))).toBe(0);
        expect(series.reserve_sum_total_mismatch, JSON.stringify(series.first_reserve_sum_mismatches.slice(0, 3))).toBe(0);
        // no branch loses more than the probe's own bound over the baseline or a recovered hold; none drains while another fills
        expect(series.drift_failures, JSON.stringify(series.drift_failures)).toHaveLength(0);

        if (run.cold) {
            // The clock is placed first and runs alone until its counter reads the phase; in that tick the arms are built, in the
            // order asked for, and wired to that same clock, which is not built again. Machines and buffers are empty then.
            const staged = start.staged, attach = staged.clock_attach, priming = staged.clock_priming;
            const placed = values(staged.placed), preexisting = values(staged.preexisting);
            expect(build.staged.cell_inserters).toBe(placed.length);
            expect(build.built + placed.length).toBe(211);
            expect(placed.length + preexisting.length).toBe(24);
            const known = [0, 1].map(copy => new Map<number, {x: number; y: number}>([...placed, ...preexisting]
                .filter(row => row.copy === copy).map(row => [row.config_id, {x: row.x, y: row.y}])));
            expect(known.map(stands => stands.size)).toEqual([12, 12]);
            expect(placed.map(row => [row.config_id, row.copy]), `placed in the ${run.order} order`).toEqual(stagedBuildOrder(known, run.order)
                .filter(row => placed.some(p => p.config_id === row.config_id && p.copy === row.copy)).map(row => [row.config_id, row.copy]));
            expect(placed.every(row => row.tick === attach.tick)).toBe(true);
            const trace = priming.trace;
            expect(priming.target).toBe(run.phase);
            expect(trace[trace.length - 1].counter).toBe(run.phase);
            expect(trace.findIndex((row: any) => row.counter === run.phase)).toBe(trace.length - 1);
            expect(attach.tick).toBe(trace[trace.length - 1].tick);
            expect(attach.counter).toBe(run.phase);
            expect(priming.placed.tick).toBeGreaterThanOrEqual(build.saturation.saturated_tick);
            expect(priming.placed.cell_ghosts).toBe(placed.length);
            expect(attach.cell_ghosts).toBe(placed.length);
            expect(values(attach.combinators)).toEqual(values(priming.placed.combinators));
            expect(attach.main_unit).toBe(priming.placed.main_unit);
            expect(values(attach.combinators)).toHaveLength(result.blueprint.entities.length);
            const stock = values(attach.stock);
            expect(stock.filter(row => row.type !== 'container').every(row => row.input === 0 && row.output === 0)).toBe(true);
            expect(stock.filter(row => row.type === 'container').every(row => row.chest === 0)).toBe(true);
            expect(values(start.loop_seeds)).toHaveLength(0);
            expect(recording.machines.every((machine: any) => machine.samples.products_finished[0] === 0)).toBe(true);
            expect(Object.keys(report.trials)).toHaveLength(0);
        } else {
            expect(build.built).toBe(211);
            expect(report.trials).toHaveLength(losses.length);
            for (const [index, trial] of report.trials.entries()) {
                const loss = losses[index];
                expect(trial, `${loss.kind} ${loss.item} at ${loss.phase_offset}`).toMatchObject({kind: loss.kind, item: loss.item,
                    cut_phase: loss.phase_offset, stopped: true, recovered: true, hold_periods: holdPeriods});
                expect(trial.recovered_at).toBeLessThanOrEqual(recoveryCaps[index]);
                expect(trial.craft_quiet_ticks).toBeGreaterThanOrEqual(options.stopped_ticks);
                expect(trial.output_quiet_ticks).toBeGreaterThanOrEqual(options.stopped_ticks);
                expect(trial.hold_stock_drift).toBeGreaterThanOrEqual(-report.maximum_hold_stock_drain);
                expect(trial.hold_products_finished).toBeGreaterThan(0);
                expect(trial.last_periods).toHaveLength(holdPeriods);
                expect(trial.last_periods.every((counts: number[]) => counts.length === 4 && counts.every(count => count === 16))).toBe(true);
            }
            expect(report.trials.some((trial: any) => values(trial.partial_hands_at_restore).some(hand => hand.relevant && hand.count > 0 && hand.count < 16)),
                'at least one restoration resumes a relevant partially filled hand').toBe(true);
            const red = report.trials.find((trial: any) => trial.item === 'advanced-circuit');
            expect(red.advanced_disposal_blocked).toBe(true);
            expect(red.advanced_disposal_cleared).toBe(true);
            expect(red.red_max.every((count: number) => count >= red.red_stop_min)).toBe(true);
            expect(red.recycler_full_ticks.every((ticks: number) => ticks > 0)).toBe(true);
            expect(red.red_at_recovery.every((count: number) => count <= 16)).toBe(true);
        }
        fs.writeFileSync(path.join(directory, 'summary.json'), JSON.stringify({run: run.name, original_scaffold_sha256: originalHash,
            verdict: selected.verdict, science_per_second: 96, all_copies_per_second: 240, copies: 2.5,
            clock_period: period, clock_start_phase: run.phase, build_order: run.order,
            wake_ups_per_minute: selected.assessment.wake_ups_per_minute, per_branch_drift: series.drift,
            branches_needing_depletion_review: ledger.branches_needing_depletion_review, ...report}, null, 2));
    } finally { if (!retained) fs.rmSync(parent, {recursive: true, force: true}); }
}, 1_800_000);
