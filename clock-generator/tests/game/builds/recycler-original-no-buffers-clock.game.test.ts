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
import {clockHash, runHolds} from './clock-controls';
import {RUN_PROTOCOL, runSummary} from './pickup-clock-capture';

/**
 * The 203-entity scaffold of #100 without its buffer chests (each replaced in place by an infinity chest that removes all,
 * the final takers removed: two cells, 96 science a second) under the clock the generator selects for the sample's
 * automatic config (one cell at 48 a second, five copies for 240). The science plants' drains are the terminals and drop
 * into sinks that never block, so each branch (a plant and its drain) is judged by its rate: never more than a hand behind
 * its share of 16 a period from the start of the baseline or of a hold, its surplus taken by the sink (the probe's "rate"
 * gate, chosen by the sink the drain drops into). The runs follow the game tests' protocol (helpers/lua/steady.lua), counted in
 * the science the four drains drop into their infinity chests: a warm run with steady state, a baseline of 3,600 ticks and seven
 * disturbances (each distinct kind once), and two cold (staged) starts that record from the placement until steady state and one
 * more minute. The clock is the generator's, never changed in the game: the clock's blueprint and schedule of the selected
 * alternative wire both physical copies. recycler-original-clock.game.test.ts is the same proof of the build with its buffers,
 * judged exactly.
 */
const quiet = {log() {}, info() {}, warn() {}, error() {}, debug() {}};
const sample = path.resolve(__dirname, '../../../resources/config-samples/real/owner/pink-science-original-no-buffers/pink-science-original-no-buffers.json');
const scaffold = sample.replace(/\.json$/, '-scaffold.txt');
const scaffoldHash = '04db19a009a09bad17a15b0615b8c938ddb5c94857b29da9ff4931bfe256417a';
const probe = path.join(__dirname, 'recycler-original-clock-probe.lua');
const period = 40;
// each science plant's share of the cell's 48 a second in a period, and the hand of its drain
const share = 16, hand = 16;
// the disturbances of the warm run, each distinct kind once: the five supplies cut (the feeders off and the item taken from the
// belt lanes and the supply chests upstream), the output blocked at the four drains, the advanced-circuit disposal blocked
const disturbanceKinds = ['cut accumulator', 'cut processing-unit', 'cut battery', 'cut holmium-plate', 'cut superconductor',
    'block output', 'block advanced-circuit disposal'];
// The two copies of the config the scaffold holds: 96 science a second, 5,760 in the trailing minute
const COPIES = 2;
// Ticks from the probe's start (after a warm-up of 3,600), by arithmetic. Steady state is no earlier than the window plus a window
// back (7,200); the baseline 3,600; a supply cut falls within ~200 ticks and recovers 3,600 + ~300 after its release (the
// recorded runs of the other families: 3,750-3,990 from the release), so ~4,300 each; the output block falls at once, ~4,100; the
// disposal block must fill the recyclers' advanced circuits (a stack of 200 at ~2.5 a second a recycler, ~4,800 ticks) and the
// belt before them, then starve the plants, ~9,000 to fall, then ~4,200 to recover. A cold start is steady state at 7,200 or when
// the plants have filled (~3,000 ticks) plus the window, whichever is later, and the baseline.
const WARM_ESTIMATE = 7_200 + 3_600 + 5 * 4_300 + 4_100 + (9_000 + 4_200);
const COLD_ESTIMATE = 7_200 + 3_600;
const COLD_CAP = 36_000;

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

for (const run of runs) test(`original electromagnetic science scaffold without buffer chests, automatic clock: ${run.name}`, async context => {
    const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
    context.skip(!factorio || !save || !fs.existsSync(save), 'Factorio harness is not configured');
    const estimate = run.cold ? COLD_ESTIMATE : WARM_ESTIMATE, cap = run.cold ? COLD_CAP : RUN_PROTOCOL.cap;
    context.skip(estimate > cap, `the run is estimated at ${estimate} ticks, over the ${cap} it may take`);
    const retained = process.env.RECYCLER_ORIGINAL_NO_BUFFERS_CAPTURE_DIR;
    const parent = retained ? path.resolve(retained) : fs.mkdtempSync(path.join(os.tmpdir(), 'recycler-original-no-buffers-'));
    const directory = path.join(parent, run.name);
    fs.mkdirSync(directory, {recursive: true});
    try {
        const bytes = fs.readFileSync(scaffold);
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(scaffoldHash);
        const entities = JSON.parse(zlib.inflateSync(Buffer.from(bytes.toString('utf8').trim().slice(1), 'base64')).toString('utf8')).blueprint.entities;
        expect(entities).toHaveLength(203);
        const {config, selected} = await clockedFixture();

        // The sample is automatic: nothing fixed, and the selected clock is the one built for it
        expect(config.target_output).toMatchObject({items_per_second: 240, copies: 5});
        expect(config.overrides?.lcm).toBeUndefined();
        expect(config.overrides?.terminal_swing_count).toBeUndefined();
        const result = selected.result;
        expect(selected.id).toBe('primitive-grouped');
        expect(selected.verdict).toBe('stable');
        expect(selected.assessment.backpressure_loss?.survives).toBe(true);
        expect(selected.assessment.backpressure_loss?.not_tried ?? []).toHaveLength(0);
        expect(result.stability_check.as_built?.holds).toBe(true);
        expect(result.simulation_duration.ticks).toBe(period);
        expect(Object.keys(result.always_on_reasons ?? {})).toHaveLength(0);
        const ids = config.inserters.map((row, index) => row.id ?? index + 1).sort((a, b) => a - b);
        expect(ids).toHaveLength(10);
        expect(scheduledInserterIds(result.schedule)).toEqual(ids);
        expect(share).toBe(config.target_output.items_per_second / config.target_output.copies / 2 * period / 60);
        // the two arms that take from the supercapacitor plants take turns: never open in the same tick
        const open = (windows: {start: number; end: number}[] | undefined, tick: number) => (windows ?? []).some(w => tick >= w.start && tick <= w.end);
        const [turnsA, turnsB] = [result.clock_windows['inserter:6'], result.clock_windows['inserter:7']];
        expect(turnsA && turnsB).toBeTruthy();
        expect([...Array(period).keys()].filter(tick => open(turnsA, tick) && open(turnsB, tick))).toEqual([]);
        // the turns of the two arms that take from the supercapacitor plants (the selection's pin)
        expect(turnsA).toEqual([{start: 39, end: 39}, {start: 0, end: 8}]);
        expect(turnsB).toEqual([{start: 19, end: 28}]);
        fs.writeFileSync(path.join(directory, 'generation.json'), JSON.stringify({
            selected: selected.id, verdict: selected.verdict, assessment: selected.assessment,
            period, windows: result.clock_windows, share_per_period: share, hand,
        }, null, 2));
        const combinatorOf = new Map<number, number>(result.schedule.inserter_combinators
            .flatMap((row: any) => row.inserter_ids.map((id: number) => [id, row.entity_number] as const)));

        // the build is two of the config's copies: 96 science a second, 5,760 in the trailing minute
        const target = config.target_output.items_per_second / (config.target_output.copies ?? 1) * COPIES;
        expect(target).toBe(96);
        const options = {period, share_per_period: share, hand, cold: run.cold, initialization_delay_ticks: run.cold ? 2 : 0,
            window: RUN_PROTOCOL.window, expected: Math.round(target * RUN_PROTOCOL.window / 60 * 1e6) / 1e6, baseline: RUN_PROTOCOL.baseline, cap};
        const {recording, build, start} = await recordInFactorio({factorio: factorio!, save: save!, config, copies: COPIES,
            blueprint: bytes.toString('utf8').trim(),
            clock: {blueprint: encodeBlueprintFile({blueprint: result.blueprint}), schedule: result.schedule},
            out: path.join(directory, 'recording.json'), work_dir: path.join(directory, 'game'),
            ...(run.cold
                // from the placement until steady state and one more minute (the probe cuts the recording there), at most 10 minutes
                ? {ticks: COLD_CAP, warmup_ticks: 0, staged_start: {build_order: run.order, clock_phase: run.phase}}
                : {ticks: 3600, record_at_once: true, warmup_ticks: 3600, settle_ticks: RUN_PROTOCOL.cap + 1}),
            lua: composeProbeSource(probe, options),
            seed: [], unclocked: false, game_speed: 1000, watch: false, timeout_seconds: 1500, log() {},
        }) as any;
        const report = JSON.parse(fs.readFileSync(path.join(directory, 'game/script-output/recycler-original.json'), 'utf8'));
        expect(report.error).toBeUndefined();
        expect(report.protocol.error, 'the probe failed in the game').toBeUndefined();
        expect(report.protocol.result, 'the run did not end before the recording').toBeDefined();
        expect(report.topology).toMatchObject({outputs: 4, science: 4, recyclers: 2, capacitors: 2, disposal: 1});
        expect(report.topology.red_outlets).toHaveLength(2);
        // every terminal is a science plant's drain into an infinity chest: no buffer, judged by its rate
        expect(values(report.topology.branches).every((branch: any) => branch.gate === 'rate' && !branch.buffer
            && branch.terminal.unit === branch.drain.unit)).toBe(true);
        expect(report).toMatchObject({share_per_period: share, hand});
        // the protocol: steady state, a baseline whose whole clock cycles make the target, each disturbance recovered
        const summary = runSummary(report.protocol, {generationVerdict: selected.verdict, target, period});
        fs.writeFileSync(path.join(directory, 'summary.json'), JSON.stringify(summary) + '\n');
        expect(summary.result).toBe('holds');
        expect(summary.steady).not.toBeNull();
        expect(summary.disturbances.map(disturbance => disturbance.kind)).toEqual(run.cold ? [] : disturbanceKinds);
        expect(runHolds(summary), JSON.stringify(summary)).toBe(true);
        // the science of each branch (a plant and its drain) closes over the baseline's whole clock cycles: what its plant made is
        // what its drain dropped and what it holds more. The drain takes the plant's surplus a hand at a time: it drops at least
        // its share in every cycle, less one hand, and no branch loses more than the probe's own bound
        const ledger = report.baseline_ledger;
        expect(ledger.ticks).toBeGreaterThan(0);
        expect(ledger.ticks).toBe(summary.baseline!.measured!.ticks);
        expect(ledger.ticks % period).toBe(0);
        expect(ledger.branches).toHaveLength(4);
        for (const [index, branch] of ledger.branches.entries()) {
            expect(branch.gate).toBe('rate');
            expect(branch.residual, `branch ${index} closes`).toBe(0);
            expect(branch.delivered, `branch ${index} drops its share, less a hand`).toBeGreaterThanOrEqual(share * ledger.ticks / period - hand);
            expect(branch.reserve_delta).toBeGreaterThanOrEqual(-64);
        }

        // Wiring: 20 arms, two for each of the 10 configured inserters, and none of the six feeders the scaffold brings
        const wired = values(start.clock?.wired);
        const wiredUnits = new Set<number>(wired.map(row => row.unit_number));
        expect(build.removed_clock_combinators).toBe(0);
        expect(build.clocked_inserters).toBe(0);
        expect(values(build.failed)).toHaveLength(0);
        expect(wired).toHaveLength(20);
        expect(wiredUnits.size).toBe(20);
        expect(values(start.clock?.running_free)).toHaveLength(0);
        for (const id of ids) expect(wired.filter(row => row.inserter === id), `two arms for inserter ${id}`).toHaveLength(2);
        const recordedConfig = (recorded: any) => recording.config.inserters.find((row: any, index: number) => (row.id ?? index + 1) === recorded.id);
        const external = recording.inserters.filter((row: any) => row.source.type === 'chest' && row.sink.type === 'belt');
        const chestTypes = new Map<number, string>((recording.config.chests ?? []).map((row: any, index: number) => [row.id ?? index + 1, row.type]));
        expect(external).toHaveLength(6);
        expect(external.every((row: any) => chestTypes.get(row.source.id) === 'infinity-chest' && !wiredUnits.has(row.unit_number))).toBe(true);
        // positions: per schedule combinator the arms a copy wires stand at the modeled positions of their ids, moved by the
        // copy's translation, copies 13 tiles apart
        const arms: {copy: number; config_id: number; unit: number; at: {x: number; y: number}}[] = [];
        if (run.cold) {
            const staged = start.staged;
            const placed = values(staged.placed), preexisting = values(staged.preexisting);
            const positions = new Map<number, {x: number; y: number}>(values(report.topology.arms).map((row: any) => [row.unit, row.position]));
            for (const row of [...placed, ...preexisting]) arms.push({copy: row.copy, config_id: row.config_id, unit: row.unit_number, at: positions.get(row.unit_number)!});
            expect(arms).toHaveLength(20);
            expect(arms.every(arm => arm.at && wired.some(w => w.inserter === arm.config_id && w.unit_number === arm.unit))).toBe(true);
            expect(arms.map(arm => arm.unit).sort((a, b) => a - b)).toEqual([...wiredUnits].sort((a, b) => a - b));
        } else {
            const described = {config: recording.config, inserters: Object.fromEntries(recording.inserters.map((row: any) => [row.id, row])),
                machines: Object.fromEntries(recording.machines.map((row: any) => [row.id, row]))};
            const copies = matchBuiltCopies(described, config, 2);
            const recordedByUnit = new Map<number, any>(recording.inserters.map((row: any) => [row.unit_number, row]));
            expect(copies).toHaveLength(2);
            copies.forEach((copy, index) => {
                expect(copy.size).toBe(10);
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

        if (run.cold) {
            // The clock is placed first and runs alone until its counter reads the phase; in that tick the arms are built, in the
            // order asked for, and wired to that same clock, which is not built again. Machines and buffers are empty then.
            const staged = start.staged, attach = staged.clock_attach, priming = staged.clock_priming;
            const placed = values(staged.placed), preexisting = values(staged.preexisting);
            expect(build.staged.cell_inserters).toBe(placed.length);
            expect(build.built + placed.length).toBe(203);
            expect(placed.length + preexisting.length).toBe(20);
            const known = [0, 1].map(copy => new Map<number, {x: number; y: number}>([...placed, ...preexisting]
                .filter(row => row.copy === copy).map(row => [row.config_id, {x: row.x, y: row.y}])));
            expect(known.map(stands => stands.size)).toEqual([10, 10]);
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
            expect(summary.disturbances).toHaveLength(0);
        } else {
            expect(build.built).toBe(203);
            // each cut took the item from the belt lanes upstream of the clocked machines
            const cuts = report.events.filter((row: any) => row.action.startsWith('cut '));
            expect(cuts).toHaveLength(5);
            for (const row of cuts) expect(row.from_belts, row.action).toBeGreaterThan(0);
            // the disposal block stopped a recycler on its advanced circuits (the stop that starves the plants): it waited for space.
            // The block lasts until the output falls (the protocol), which comes before a recycler's output holds a stack
            const evidence = report.evidence;
            expect(evidence.recycler_full_ticks.some((ticks: number) => ticks > 0), JSON.stringify(evidence)).toBe(true);
        }
        fs.writeFileSync(path.join(directory, 'figures.json'), JSON.stringify({run: run.name, scaffold_sha256: scaffoldHash,
            verdict: selected.verdict, science_per_second: 96, all_copies_per_second: 240, copies: 2.5,
            clock_period: period, clock_start_phase: run.phase, build_order: run.order, clock_sha256: clockHash(result.subtick ?? result),
            wake_ups_per_minute: selected.assessment.wake_ups_per_minute, estimated_ticks: estimate, ended: summary.ended, ...report}, null, 2));
    } finally { if (!retained) fs.rmSync(parent, {recursive: true, force: true}); }
}, 1_800_000);
