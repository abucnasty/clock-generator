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

const quiet = {log() {}, info() {}, warn() {}, error() {}, debug() {}};

test('recycler direct insertion: the science clock holds its rate and the plant fills to the drill stop', async context => {
    const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
    context.skip(!factorio || !save || !fs.existsSync(save), 'Factorio harness is not configured');
    const retained = process.env.RECYCLER_MACHINE_CAPTURE_DIR;
    const directory = retained ? path.resolve(retained) : fs.mkdtempSync(path.join(os.tmpdir(), 'recycler-machine-'));
    fs.mkdirSync(directory, {recursive: true});
    try {
        const config = await loadConfigFromFile(ConfigPaths.REAL_OWNER_PINK_SCIENCE_RECYCLER);
        const generated = generateClockAlternatives(config, {logger: quiet});
        const selected = generated.alternatives[generated.selected_index];
        expect(selected.verdict).toBe('stable');
        const clock = selected.result.subtick ?? selected.result;
        const period = selected.result.simulation_duration.ticks;
        const options = {period, settle_periods: 600, baseline_periods: 3600, probe_ticks: 3600, wait_ticks: 600};
        const {recording} = await recordInFactorio({factorio: factorio!, save: save!, config,
            blueprint: fs.readFileSync(ConfigPaths.REAL_OWNER_PINK_SCIENCE_RECYCLER.replace(/\.json$/, '-scaffold.txt'), 'utf8').trim(),
            clock: {blueprint: encodeBlueprintFile({blueprint: clock.blueprint}), schedule: clock.schedule},
            out: path.join(directory, 'recording.json'), work_dir: path.join(directory, 'game'),
            ticks: 2 * period, warmup_ticks: 600, settle_ticks: (options.settle_periods + options.baseline_periods) * period + options.probe_ticks + options.wait_ticks + 60,
            lua: composeProbeSource(path.join(__dirname, 'recycler-machine-clock-probe.lua'), options),
            seed: [], unclocked: false, game_speed: 1000, watch: false, timeout_seconds: 900, log() {},
        });
        const report = JSON.parse(fs.readFileSync(path.join(directory, 'game/script-output/recycler-machine.json'), 'utf8')) as {
            error?: string; periods: number[][]; output: number[]; target_max: number; target_end: number; target_advanced: number;
            red_max: number; recycler_waiting: number; recycler_finished: number; recycler_finished_after: number;
        };
        expect(report.error).toBeUndefined();
        const expected = config.target_output.items_per_second / config.target_output.copies * period / 60;
        expect(report.periods).toHaveLength(options.baseline_periods);
        expect(report.output.reduce((a, b) => a + b, 0)).toBe(expected * options.baseline_periods);
        expect(report.periods.every(counts => counts[0] === expected / 2 && counts[1] === expected / 2)).toBe(true);
        const machines = createEntityRegistryFromConfig(config).getAll().filter(Entity.isMachine);
        const recycler = machines.find(machine => machine.result_target)!;
        const target = machines.find(machine => machine.entity_id.id === recycler.result_target!.id)!;
        const limit = directMachineInsertionLimit(recycler.output.ingredient.item, target);
        expect(report.target_max).toBe(limit);
        expect(report.target_end).toBe(limit);
        expect(limit).toBeGreaterThan(target.inputs.getOrThrow(recycler.output.item_name).automated_insertion_limit.quantity);
        expect(report.target_advanced).toBe(0);
        expect(report.red_max).toBeLessThan(100);
        // The result is five circuits at once: the game stops when another whole batch cannot fit.
        expect(report.recycler_waiting).toBeGreaterThan(200 - 5);
        expect(report.recycler_waiting).toBeLessThanOrEqual(200);
        expect(report.recycler_finished_after).toBe(report.recycler_finished);
        const exported = recording.config.machines as {id: number; recipe: string; result_target?: {type: string; id: number}}[];
        const from = exported.find(machine => machine.recipe === recycler.metadata.recipe.name)!;
        const to = exported.find(machine => machine.recipe === target.metadata.recipe.name)!;
        expect(from.result_target).toEqual({type: 'machine', id: to.id});
        fs.writeFileSync(path.join(directory, 'summary.json'), JSON.stringify({
            clock: selected.id, verdict: selected.verdict, period, science_per_second: config.target_output.items_per_second,
            copies: config.target_output.copies, wake_ups_per_minute: selected.assessment.wake_ups_per_minute,
            ...report, drill_stop: limit, automated_insertion_limit: target.inputs.getOrThrow(recycler.output.item_name).automated_insertion_limit.quantity,
        }, null, 2));
    } finally { if (!retained) fs.rmSync(directory, {recursive: true, force: true}); }
}, 1_200_000);
