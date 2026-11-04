import fs from 'fs';
import os from 'os';
import path from 'path';
import {expect, test} from 'vitest';
import {ConfigPaths} from '../../../src/config/config-paths';
import {loadConfigFromFile} from '../../../src/config/loader';
import {generateClockAlternatives} from '../../../src/crafting/generate-blueprint';
import {encodeBlueprintFile} from '../../../src/blueprints/serde';
import {recordInFactorio} from '../../../src/harness/factorio-harness';
import {createEntityRegistryFromConfig} from '../../../src/crafting/sequence/simulation-context';
import {Entity} from '../../../src/entities';
import {directMachineInsertionLimit} from '../../../src/entities/drill/mining-drill-ext';
import {composeProbeSource} from '../helpers/probe-source';
import {runHolds} from './clock-controls';
import {RUN_PROTOCOL, runSummary} from './pickup-clock-capture';

const quiet = {log() {}, info() {}, warn() {}, error() {}, debug() {}};

// The run under the game tests' protocol (helpers/lua/steady.lua), counted in the science the two takers drop into their infinity
// chests (the clock sets the rate there; the plants empty freely into the chests): steady state, a baseline of 3,600 ticks and
// one disturbance, the supercapacitor plant stopped until the output falls. Then, with the protocol held, the plant is stopped
// once more with its input emptied for PROBE_TICKS and WAIT_TICKS, to show the drill stop: the protocol's disturbance ends when
// the output falls, which is before the recycler has filled the plant.
const PROBE_TICKS = 3600, WAIT_TICKS = 600;
// Ticks, from the probe's start (after a warm-up of 3,600): steady state no earlier than the window plus a window back (7,200);
// the baseline 3,600; the disturbance falls within ~200 ticks and recovers 3,600 + ~300 after its release (the recorded runs of
// the other families: 3,750-3,990 from the release); the stopped plant PROBE_TICKS + WAIT_TICKS.
const ESTIMATED_TICKS = 7_200 + 3_600 + (200 + 4_100) + PROBE_TICKS + WAIT_TICKS;
// the protocol ends in time for the stopped plant to be watched inside the run's cap
const PROTOCOL_CAP = RUN_PROTOCOL.cap - PROBE_TICKS - WAIT_TICKS - 1;

test('recycler direct insertion: the science clock holds its rate under the protocol and the plant fills to the drill stop', async context => {
    const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
    context.skip(!factorio || !save || !fs.existsSync(save), 'Factorio harness is not configured');
    context.skip(ESTIMATED_TICKS > RUN_PROTOCOL.cap, `the run is estimated at ${ESTIMATED_TICKS} ticks, over the ${RUN_PROTOCOL.cap} of a whole run`);
    const retained = process.env.RECYCLER_MACHINE_CAPTURE_DIR;
    const directory = retained ? path.resolve(retained) : fs.mkdtempSync(path.join(os.tmpdir(), 'recycler-machine-'));
    fs.mkdirSync(directory, {recursive: true});
    try {
        const config = await loadConfigFromFile(ConfigPaths.REAL_OWNER_PINK_SCIENCE_RECYCLER);
        const generated = generateClockAlternatives(config, {logger: quiet});
        const selected = generated.alternatives[generated.selected_index];
        expect(selected.verdict).toBe('stable'); // judged by its rate over the cycle into a sink that never blocks (terminal-rate.ts)
        const clock = selected.result.subtick ?? selected.result;
        const period = selected.result.simulation_duration.ticks;
        // this build is one of the config's copies: 240 science a second over five copies is 48 a second here, 24 from each taker
        const target = config.target_output.items_per_second / (config.target_output.copies ?? 1);
        const expected = Math.round(target * RUN_PROTOCOL.window / 60 * 1e6) / 1e6;
        const options = {period, window: RUN_PROTOCOL.window, expected, baseline: RUN_PROTOCOL.baseline, cap: PROTOCOL_CAP,
            probe_ticks: PROBE_TICKS, wait_ticks: WAIT_TICKS};
        const {recording} = await recordInFactorio({factorio: factorio!, save: save!, config,
            blueprint: fs.readFileSync(ConfigPaths.REAL_OWNER_PINK_SCIENCE_RECYCLER.replace(/\.json$/, '-scaffold.txt'), 'utf8').trim(),
            clock: {blueprint: encodeBlueprintFile({blueprint: clock.blueprint}), schedule: clock.schedule},
            out: path.join(directory, 'recording.json'), work_dir: path.join(directory, 'game'),
            ticks: 3600, record_at_once: true, warmup_ticks: 3600, settle_ticks: RUN_PROTOCOL.cap + 1,
            lua: composeProbeSource(path.join(__dirname, 'recycler-machine-clock-probe.lua'), options),
            seed: [], unclocked: false, game_speed: 1000, watch: false, timeout_seconds: 900, log() {},
        });
        const report = JSON.parse(fs.readFileSync(path.join(directory, 'game/script-output/recycler-machine.json'), 'utf8')) as {
            error?: string; protocol: Parameters<typeof runSummary>[0]; baseline_cycles: {ticks: number; delivered: number[]};
            target_max: number; target_advanced: number; red_max: number;
            stopped: {target_max: number; target_advanced: number; target_end: number; recycler_waiting: number; recycler_finished: number; recycler_finished_after: number};
        };
        expect(report.error).toBeUndefined();
        expect(report.protocol.error, 'the probe failed in the game').toBeUndefined();
        expect(report.protocol.result, 'the run did not end before the recording').toBeDefined();
        const summary = runSummary(report.protocol, {generationVerdict: selected.verdict, target, period});
        fs.writeFileSync(path.join(directory, 'summary.json'), JSON.stringify(summary) + '\n');
        // steady state, a baseline whose whole clock cycles make the target, and the stopped plant back to the target
        expect(summary.result).toBe('holds');
        expect(summary.steady).not.toBeNull();
        expect(summary.disturbances.map(disturbance => disturbance.kind)).toEqual(['stop supercapacitor plant']);
        expect(runHolds(summary), JSON.stringify(summary)).toBe(true);
        // each taker drops its half of the target in every cycle of the baseline: its share a period, exactly
        const share = target * period / 60 / 2;
        expect(report.baseline_cycles.ticks).toBeGreaterThan(0);
        expect(report.baseline_cycles.ticks % period).toBe(0);
        expect(report.baseline_cycles.delivered).toEqual([share, share].map(each => each * report.baseline_cycles.ticks / period));

        const machines = createEntityRegistryFromConfig(config).getAll().filter(Entity.isMachine);
        const recycler = machines.find(machine => machine.result_target)!;
        const plant = machines.find(machine => machine.entity_id.id === recycler.result_target!.id)!;
        const limit = directMachineInsertionLimit(recycler.output.ingredient.item, plant);
        expect(limit).toBeGreaterThan(plant.inputs.getOrThrow(recycler.output.item_name).automated_insertion_limit.quantity);
        // the plant never holds more than the mining drill's stop, and no advanced circuits; the recycler never holds a stack of them
        expect(report.target_max).toBeLessThanOrEqual(limit);
        expect(report.target_advanced).toBe(0);
        expect(report.red_max).toBeLessThan(100);
        // with the plant stopped and emptied the recycler fills it to the stop and, the result being five circuits at once, waits when
        // another whole batch cannot fit
        expect(report.stopped.target_max).toBe(limit);
        expect(report.stopped.target_end).toBe(limit);
        expect(report.stopped.target_advanced).toBe(0);
        expect(report.stopped.recycler_waiting).toBeGreaterThan(200 - 5);
        expect(report.stopped.recycler_waiting).toBeLessThanOrEqual(200);
        expect(report.stopped.recycler_finished_after).toBe(report.stopped.recycler_finished);
        const exported = recording.config.machines as {id: number; recipe: string; result_target?: {type: string; id: number}}[];
        const from = exported.find(machine => machine.recipe === recycler.metadata.recipe.name)!;
        const to = exported.find(machine => machine.recipe === plant.metadata.recipe.name)!;
        expect(from.result_target).toEqual({type: 'machine', id: to.id});
        fs.writeFileSync(path.join(directory, 'figures.json'), JSON.stringify({
            clock: selected.id, verdict: selected.verdict, period, science_per_second: config.target_output.items_per_second,
            copies: config.target_output.copies, wake_ups_per_minute: selected.assessment.wake_ups_per_minute,
            drill_stop: limit, automated_insertion_limit: plant.inputs.getOrThrow(recycler.output.item_name).automated_insertion_limit.quantity,
            baseline_cycles: report.baseline_cycles, target_max: report.target_max, red_max: report.red_max, stopped: report.stopped,
            estimated_ticks: ESTIMATED_TICKS, ended: summary.ended,
        }, null, 2));
    } finally { if (!retained) fs.rmSync(directory, {recursive: true, force: true}); }
}, 1_200_000);
