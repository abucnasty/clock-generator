// Per-job checks of the variant jobs (group `variants`): a sample with the options a test or a game recording sets on it. What the generation
// test of each build checked on the result that the record does not hold (see samples.ts for what the record does hold).
import { expect } from 'vitest';
import type { JobCheck } from '../record-job-checks';
import { disturbanceTrialOf, COORDINATED_SOURCES_MAKER, selectableAsStable } from '../../../../src/crafting/generate-blueprint';
import type { ClockAlternative, ClockAlternativesResult } from '../../../../src/crafting/generate-blueprint';
import { lossId, verdictOf, type DisturbanceTrialReport } from '../../../../src/crafting/disturbance-trial';
import { START_DEPENDENCE_NOT_CHECKED } from '../../../../src/crafting/start-dependence';
import { SEARCH_MAKERS } from '../../../../src/crafting/generate-blueprint-test-helpers';
import type { Config } from '../../../../src/config/schema';

const quiet = { log() { }, info() { }, warn() { }, error() { }, debug() { } };
const selectedOf = (generated: ClockAlternativesResult): ClockAlternative => generated.alternatives[generated.selected_index];
const byMaker = (generated: ClockAlternativesResult, maker: string): ClockAlternative => generated.alternatives.find(alternative => alternative.maker === maker)!;

// Agricultural science with its belts backed up (AGRICULTURAL_SCIENCE_250_BACKED_UP). Three inserters take bioflux off a belt for their
// biochambers, and the nutrients the biochambers burn. Without room for a hand of nutrients the windows of batched swings close on partly filled
// hands of bioflux: recorded on the scaffold, 377 of 400 a window cycle.
const agriculturalBackedUp: JobCheck[] = [{
    name: 'makes batched swings with room for a hand of fuel, as a clock for a backed-up belt',
    run: ({ generated }) => {
        const batched = byMaker(generated, 'planned-belt-slack');
        expect(batched.label).toBe('Takt Batches: 5 output swings each output cycle');
        expect(batched.ranking.matches_belt_choice).toBe(true);
        expect(batched.result.belt_pickup_slack_ticks).toEqual({});
        expect(batched.result.fuel_hand_room_ticks).toEqual({ 'inserter:1': 4, 'inserter:2': 4, 'inserter:11': 4 });
        expect(batched.description).toContain('Inserters 1, 2 and 11 take fuel off the belt as well as an ingredient and stay enabled 4 more ticks');
    },
}];

// The processing unit circuit export with "Backed-up belts" on (PROCESSING_UNIT_80_CIRCUIT_EXPORT_BACKED_UP); the other case is the config's job
const circuitExportBackedUp: JobCheck[] = [
    {
        name: 'Behavior: the explicit one-cycle plan is offered, in 24 ticks with 32 items, for a backed-up belt',
        run: ({ generated }) => {
            const plan = byMaker(generated, 'planned-belt-slack');
            expect(plan, 'the explicit behavior plan is offered, independently of the selector').toBeDefined();
            expect(plan.result.stability_check.as_built).toMatchObject({ holds: true, actual_output_items: 32 });
            expect(plan.belt).toEqual({ kind: 'backed_up' });
        },
    },
    {
        // the guard per taker gates the 12 takers whose hands and a start more take the 24-tick window cycle; that clock does not get back
        // from every loss, so it is remade once with the takers into the target machines (the processing unit machines 2 and 3) unguarded
        // of the per-hand clock the grouped hands make, which the per-branch clock composed from it is recommended over
        name: 'Selection: the 4 inserters with no window are the circuits into the processing unit machines, which the remake leaves unguarded',
        run: ({ generated }) => {
            expect(byMaker(generated, 'planned-belt-slack-per-hand').result.always_on_reasons).toEqual(Object.fromEntries([3, 4, 7, 8]
                .map(number => [`inserter:${number}`, { kind: 'busy', window_cycle_ticks: 24 }])));
        },
    },
];

// The inserter crafting build with its belts backed up (INSERTER_CRAFTING_240_SHARED_SIGNAL_CLOCK_BACKED_UP): the one copy of the sample's scaffold, whose belts end closed
const inserterCraftingBackedUp: JobCheck[] = [{
    // the game's cuts (the ore, the circuits, the output) are the losses the simulator tries, and it recovers from each
    name: 'the simulator tries the loss of the ore, the circuits and the output not taken away, and gets back from each',
    run: ({ config, generated }) => {
        const selected = selectedOf(generated);
        const report = disturbanceTrialOf(config, selected.result.clock_windows, selected.result.simulation_duration.ticks,
            selected.result.stability_check.expected_output_items, quiet);
        expect(report.undisturbed.recovers).toBe(true);
        expect(report.losses.map(outcome => [lossId(outcome.loss), outcome.recovers])).toEqual(
            [['supply:iron-ore', true], ['supply:electronic-circuit', true], ['output:inserter', true]]);
    },
}];

// Automation science with one output swing a cycle (AUTOMATION_SCIENCE_240_ONE_OUTPUT_SWING): the sample no longer forces it, and with it no
// clock made without a search is stable, which the last group needs
const reports = new WeakMap<object, DisturbanceTrialReport>();
/** The backpressure-loss report of an alternative, made once for the checks of a job that read it */
const reportOf = (config: Config, alternative: ClockAlternative): DisturbanceTrialReport => {
    if (!reports.has(alternative)) {
        reports.set(alternative, disturbanceTrialOf(config, alternative.result.clock_windows, alternative.result.simulation_duration.ticks,
            alternative.result.stability_check.expected_output_items, quiet));
    }
    return reports.get(alternative)!;
};
/**
 * The fractional swings clock of AUTOMATION_SCIENCE_240_ONE_OUTPUT_SWING as it was made before its enable windows were shaped against
 * ghost wakeups (#641): it gets back from none of the build's three losses. Since then no clock of the job breaks on a loss.
 */
const BROKEN_AUTOMATION_WINDOWS = { "inserter:1": [{ start: 1, end: 20 }], "inserter:2": [{ start: 1, end: 21 }, { start: 37, end: 56 }, { start: 73, end: 73 }] };
const brokenReportOf = (config: Config, generated: ClockAlternativesResult): DisturbanceTrialReport => {
    const fractional = byMaker(generated, 'fractional');
    return disturbanceTrialOf(config, BROKEN_AUTOMATION_WINDOWS, fractional.result.simulation_duration.ticks,
        fractional.result.stability_check.expected_output_items, quiet);
};
const automation: JobCheck[] = [
    // No machine of the sample burns fuel: its selected clock has no fuel plan and no fuel consumption view
    {
        name: 'has no fuel plan and no fuel consumption view, as no machine burns fuel',
        run: ({ generated }) => {
            expect(selectedOf(generated).result.fuel_plan).toBeUndefined();
            expect(selectedOf(generated).result.fuel_consumption_view).toBeUndefined();
        },
    },
    {
        name: 'a clock tried for backpressure loss is run once with nothing cut, where it makes what the generator\'s own check found',
        run: ({ config, generated }) => {
            const selected = selectedOf(generated);
            const report = reportOf(config, selected);
            expect(report.undisturbed.trials).toHaveLength(1);
            expect(report.undisturbed.recovers).toBe(selected.verdict === 'stable');
            expect(report.undisturbed.expected_per_bin).toBe(selected.result.stability_check.expected_output_items);
        },
    },
    {
        name: 'makes the 16 trials of every loss: 4 that run their course and 12 that end part of the way',
        run: ({ config, generated }) => {
            const report = reportOf(config, selectedOf(generated));
            expect(report.losses.map(outcome => lossId(outcome.loss)).sort()).toEqual(['output:automation-science-pack', 'supply:copper-plate', 'supply:iron-gear-wheel']);
            for (const outcome of report.losses) {
                expect(outcome.trials.filter(trial => trial.until_stopped)).toHaveLength(4);
                expect(outcome.trials.filter(trial => !trial.until_stopped)).toHaveLength(12);
            }
        },
    },
    {
        name: 'stops the build with every loss that runs its course: the machine runs dry or fills up',
        run: ({ config, generated }) => {
            for (const outcome of reportOf(config, selectedOf(generated)).losses) {
                expect(outcome.stopped_after_ticks, lossId(outcome.loss)).not.toBeNull();
                expect(outcome.trials.filter(trial => trial.until_stopped).every(trial => trial.loss_ticks > 0)).toBe(true);
            }
        },
    },
    {
        name: 'survives when it is back at its expected output after every trial, and names the losses that break it when not',
        run: ({ config, generated }) => {
            const report = reportOf(config, selectedOf(generated));
            expect(report.survives).toBe(report.undisturbed.recovers && report.losses.every(outcome => outcome.recovers));
            expect(report.broken_by).toEqual(report.losses.filter(outcome => !outcome.recovers).map(outcome => lossId(outcome.loss)));
            expect(report.recovered_after_window_cycles === null).toBe(!report.survives);
        },
    },
    {
        name: 'is put in the words a list of clocks needs: whether it survives, and the losses it does not get back from',
        run: ({ config, generated }) => {
            const report = reportOf(config, selectedOf(generated));
            const verdict = verdictOf(report);
            expect(verdict.survives).toBe(report.survives);
            expect(verdict.recovered_after_window_cycles).toBe(report.recovered_after_window_cycles);
            expect(verdictOf({ ...report, survives: false, losses: report.losses.map(outcome => ({ ...outcome, recovers: outcome.loss.kind !== 'supply' })) }).broken_by)
                .toEqual(['copper plate stops arriving', 'iron gear wheel stops arriving']);
        },
    },
    {
        name: 'cuts at fewer places when asked, to make the run shorter',
        run: ({ config, generated }) => {
            const selected = selectedOf(generated);
            const shorter = disturbanceTrialOf(config, selected.result.clock_windows, selected.result.simulation_duration.ticks,
                selected.result.stability_check.expected_output_items, quiet, { places: [0] });
            expect(shorter.losses.every(outcome => outcome.trials.length === 4)).toBe(true);
        },
    },
    {
        // automation science has a clock that gets back from none of its three losses
        name: 'a clock that does not get back from a loss is tried on the first loss that breaks it only, and the others are not tried',
        run: ({ config, generated }) => {
            const report = brokenReportOf(config, generated);
            expect(report.losses.map(outcome => lossId(outcome.loss))).toEqual(['supply:copper-plate']);
            expect(report.not_tried.map(lossId)).toEqual(['supply:iron-gear-wheel', 'output:automation-science-pack']);
            expect(verdictOf(report)).toMatchObject({
                survives: false,
                broken_by: ['copper plate stops arriving'],
                not_tried: ['iron gear wheel stops arriving', 'automation science pack is not taken away'],
            });
        },
    },
    {
        name: 'runs the trials of that loss up to the first that does not get back, and no further',
        run: ({ config, generated }) => {
            const trials = brokenReportOf(config, generated).losses[0].trials;
            expect(trials.length).toBeLessThanOrEqual(16);
            expect(trials.slice(0, -1).every(trial => trial.recovers)).toBe(true);
            expect(trials[trials.length - 1].recovers).toBe(false);
        },
    },
    {
        name: 'runs the searches by default, where no clock made without a search is stable',
        run: ({ generated }) => {
            expect(generated.skipped_searches).toEqual([]);
            // the per-branch clock is made after the searches and does not count toward the gate
            expect(generated.alternatives.filter(a => !SEARCH_MAKERS.includes(a.maker) && a.maker !== COORDINATED_SOURCES_MAKER).some(a => selectableAsStable(a.ranking))).toBe(false);
        },
    },
    {
        name: 'says plainly that start dependence was not checked, by default',
        run: ({ generated }) => {
            expect(generated.start_dependence_checked).toBe(false);
            expect(generated.start_dependence_note).toBe(START_DEPENDENCE_NOT_CHECKED);
            expect(generated.alternatives.every(it => it.assessment.start_dependence === null)).toBe(true);
        },
    },
];

// The logistic science build with direct insertion and a forced output swing count (LOGISTIC_SCIENCE_240_DIRECT_INSERT_TWO_OUTPUT_SWINGS):
// the planner alone reaches 4 output swings on this build; the override asks for 2
const forcedSwings: JobCheck[] = [{
    name: 'uses the terminal_swing_count override as-is instead of backing off, for every clock alternative',
    run: ({ config, generated }) => {
        expect(config.overrides?.terminal_swing_count).toBe(2);
        // batched swings is the plan's own run, with the backoff that run has
        expect(generated.alternatives[0].result.swing_backoff_report?.triggered).toBe(false);
        expect(generated.alternatives.map(a => a.result.used_terminal_swing_count).every(count => count === 2)).toBe(true);
    },
}];

// The production science sample with the pickups of its input belt made one inserter with two filters, and the packs put onto that belt, so that
// the input inserter has 3/2 hands a cycle (PRODUCTION_SCIENCE_120_TWO_BELTS_SHARED_PICKUP): the fractional swings alternative
const fractionalSwings: JobCheck[] = [{
    name: 'the fractional swings alternative: a cycle multiplier, a swing distribution that sums to the totals and alternates, a duration extended by the multiplier',
    run: ({ generated }) => {
        const result = byMaker(generated, 'fractional').result;
        expect(result.output_cycle_plan.fractional_swings_enabled).toBe(true);
        expect(result.output_cycle_plan.cycle_multiplier).toBeDefined();
        expect(result.output_cycle_plan.cycle_multiplier).toBeGreaterThan(1);
        expect(result.output_cycle_plan.swing_distribution).toBeDefined();
        expect(result.output_cycle_plan.swing_distribution!.size).toBeGreaterThan(0);
        const distribution = result.output_cycle_plan.swing_distribution!;
        const cycle_multiplier = result.output_cycle_plan.cycle_multiplier!;
        for (const swingDist of distribution.values()) {
            const sum = swingDist.swings_per_subcycle.reduce((a, b) => a + b, 0);
            expect(sum).toBe(swingDist.total_swings);
            expect(swingDist.swings_per_subcycle.length).toBe(cycle_multiplier);
        }
        // Should have alternating distribution (values differ by at most 1)
        const swings = distribution.get('inserter:1')!.swings_per_subcycle;
        expect(Math.max(...swings) - Math.min(...swings)).toBeLessThanOrEqual(1);
        expect(result.simulation_duration.ticks).toBe(result.output_cycle_plan.total_duration.ticks * cycle_multiplier);
    },
}];

export const VARIANT_CHECKS: Record<string, JobCheck[]> = {
    'variants-AGRICULTURAL_SCIENCE_250_BACKED_UP': agriculturalBackedUp,
    'variants-PROCESSING_UNIT_80_CIRCUIT_EXPORT_BACKED_UP': circuitExportBackedUp,
    'variants-INSERTER_CRAFTING_240_SHARED_SIGNAL_CLOCK_BACKED_UP': inserterCraftingBackedUp,
    'variants-AUTOMATION_SCIENCE_240_ONE_OUTPUT_SWING': automation,
    'variants-LOGISTIC_SCIENCE_240_DIRECT_INSERT_TWO_OUTPUT_SWINGS': forcedSwings,
    'variants-PRODUCTION_SCIENCE_120_TWO_BELTS_SHARED_PICKUP': fractionalSwings,
};
