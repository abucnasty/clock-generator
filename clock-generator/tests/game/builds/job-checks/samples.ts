// Per-job checks of the jobs that are a sample as it is (group `config`): what the generation test of each build checked on the result that the
// record does not hold. The record pins the selected id, verdict, rate, window cycle, wake-ups, windows and the clock hash of every alternative, and
// hashes the label, description, insights, assessment and why-not-stable; what it cannot say is what a text must read, a field of the result
// that is not in the exported clock (deciders, always-on reasons, the fuel view, the losses the simulator tries), or a relation between them.
import { expect } from 'vitest';
import type { JobCheck } from '../record-job-checks';
import { disturbanceTrialOf, clockFromWindows, selectableAsStable, simulateClockOnly, validateConfig } from '../../../../src/crafting/generate-blueprint';
import type { ClockAlternative, ClockAlternativesResult } from '../../../../src/crafting/generate-blueprint';
import { windowDeciderCount } from '../../../../src/crafting/alternatives';
import { decidersOf } from '../../../../src/crafting/candidates/region-copies';
import { lossId } from '../../../../src/crafting/disturbance-trial';
import { excessLossOf } from '../../../../src/crafting/random-margins';
import { clockIdentity } from '../../../../src/crafting/clock-identity';
import { recordSimulationTimeline } from '../../../../src/crafting/record-timeline';
import { EntityId } from '../../../../src/entities';
import { GROUP_GAP_TILES } from '../../../../src/crafting/turn-groups';
import { SEARCH_LABELS, reasonsOf, swingSumsOf } from '../../../../src/crafting/generate-blueprint-test-helpers';
import { isNotChecked, judgeSharedLanes, sharedLaneRunsOf } from '../../../../src/crafting/shared-lane-verdict';
import type { SharedLaneLoss } from '../../../../src/crafting/shared-lane-verdict';
import { runOnSharedLanes } from '../../../../src/crafting/shared-lane-model';
import { OpenRange } from '../../../../src/data-types';
import { judgedStartOf, type Config } from '../../../../src/config/schema';
import { lithiumSiloCases } from '../lithium-plate-80-silo-chest-clock-fixtures';
import { agriculturalBackedUp } from './variants';

const quiet = { log() { }, info() { }, warn() { }, error() { }, debug() { } };
const selectedOf = (generated: ClockAlternativesResult): ClockAlternative => generated.alternatives[generated.selected_index];
const byMaker = (generated: ClockAlternativesResult, maker: string): ClockAlternative => generated.alternatives.find(alternative => alternative.maker === maker)!;
const byLabel = (generated: ClockAlternativesResult, label: string): ClockAlternative => generated.alternatives.find(alternative => alternative.label === label)!;
const byId = (generated: ClockAlternativesResult, id: string): ClockAlternative => generated.alternatives.find(alternative => alternative.id === id)!;
/** The rows of a clock as the page reads them: belt and lane, the copies' take or drop a second, the state's label and sentence */
const rowsOf = (clock: ClockAlternative) => clock.checked_lanes!.rows.map(row => ({ at: `${row.belt_id}/${row.lane}`,
    together: row.together === null ? null : `${row.together.kind} ${row.together.items_per_second}`, label: row.label, sentence: row.sentence }));
type Entities = ClockAlternative['result']['blueprint']['entities'];
// the line of an inserter or a drill under a combinator's header: "Inserter 4: [entity=car] → [item=iron-ore] → machine 1 [recipe=iron-plate]"
const ROUTE_LINE = /^(Inserters?|Drills?) \d+(, \d+)*: /;
/** The header and the line of counts of a description, without the lines of each inserter between them */
const headerAndCounts = (description: string | undefined) => (description ?? '').split('\n').filter(line => !ROUTE_LINE.test(line)).slice(0, 2);
const deciderDescriptions = (alternative: ClockAlternative) => alternative.result.blueprint.entities
    .filter(entity => entity.name === 'decider-combinator')
    .map(entity => headerAndCounts(entity.player_description));

// The productivity module chain (PRODUCTIVITY_MODULE_80_CHEST_CHAIN) at 80 modules a second over 6 copies: nine machines with chests between them.
// Windows made from the hands and the order of the chain hold in one cycle, so no search is run.
const productivityChain: JobCheck[] = [
    { name: 'runs no search: some are skipped', run: ({ generated }) => { expect(generated.skipped_searches.length).toBeGreaterThan(0); } },
    {
        name: 'the selected clock has 12 deciders, and a decider of inserters that carry different items outputs them all',
        run: ({ generated }) => {
            expect(selectedOf(generated).deciders).toBe(12);
            const outputs = selectedOf(generated).result.blueprint.entities.flatMap(entity => {
                const conditions = (entity as { control_behavior?: { decider_conditions?: { outputs?: unknown[] } } }).control_behavior?.decider_conditions;
                return entity.name === 'decider-combinator' && conditions?.outputs && conditions.outputs.length > 1 ? [conditions.outputs.length] : [];
            });
            expect(outputs.length).toBeGreaterThan(0);
        },
    },
    {
        name: 'the shared clock has 6 deciders, shared windows, and says they share one enable window',
        run: ({ generated }) => {
            const shared = byMaker(generated, 'planned-belt-slack-shared');
            expect(shared.label).toBe('Round-Robin Polling, shared enable windows: 1 output swing each output cycle');
            expect(shared.deciders).toBe(6);
            // rule F rounded the coal hand up on this chain: the clock says so (`harmonic_window_cycle`)
            expect(shared.result.round_robin_polling).toEqual({ shared_windows: true, harmonic_window_cycle: true });
            expect(shared.description).toContain('share one enable window');
        },
    },
    {
        name: 'a decider of inserters that carry different items names them all, and each count where they move different numbers',
        run: ({ generated }) => {
            const descriptions = (id: string) => deciderDescriptions(byMaker(generated, id));
            expect(descriptions('planned-belt-slack')).toContainEqual([
                '2 inserters [item=plastic-bar] [item=electronic-circuit] (6, 9) (F)',
                '2.424 swings each in 1 enable window per 72-tick window cycle: open 35–60',
            ]);
            expect(descriptions('planned-belt-slack')).toContainEqual([
                '2 inserters [item=advanced-circuit] [item=electronic-circuit] (8, 10) (H)',
                '3.333 swings each in 1 enable window per 72-tick window cycle: open 3–28',
            ]);
            expect(descriptions('planned-belt-slack-shared')).toContainEqual([
                '3 inserters [item=copper-cable] [item=plastic-bar] [item=electronic-circuit] (5, 6, 9) (D)',
                '2.424 to 4.848 swings (inserters 6, 9: 2.424; inserter 5: 4.848) in 2 enable windows per 72-tick window cycle: open 1–4, 35–72',
            ]);
        },
    },
    {
        name: 'every alternative counts the deciders of its blueprint',
        run: ({ generated }) => {
            for (const alternative of generated.alternatives) expect(alternative.deciders, alternative.id).toBe(windowDeciderCount(alternative.result.blueprint));
        },
    },
];

// Agricultural science from two pentapod egg biochambers that feed each other (AGRICULTURAL_SCIENCE_250), 250 a second over 5 modules.
const agriculturalScience: JobCheck[] = [
    {
        // 25 cycles of 115.2 or 57.6 ticks: multiplied in floating point these came out as 2879.9999999999995 and 1439.9999999999998,
        // were taken for fractional window cycles and offered as subtick and "rounded to 2879" clocks
        name: 'makes clocks of whole ticks for 6 and 3 output swings each output cycle: 2880 and 1440, none offered as subtick or rounded',
        run: ({ config, generated }) => {
            const window_cycle = (swings: number) => validateConfig({ ...config, overrides: { ...config.overrides, terminal_swing_count: swings } }).window_cycle_ticks;
            expect(window_cycle(6)).toBe(2880);
            expect(window_cycle(3)).toBe(1440);
            expect(generated.alternatives.filter(a => /subtick|rounded/.test(a.label)).map(a => a.label)).toEqual([]);
        },
    },
    // the 5-swing clock leaving the inserters of the egg loop always on is held on the sample's config before its five copies, where
    // the loop's windows show: src/crafting/agricultural-science-loop-windows.generation.test.ts
    {
        name: 'can be run on its clock alone for a few periods, with what every machine and inserter holds after each tick',
        run: ({ config, generated }) => {
            const windows = byLabel(generated, 'Takt Batches: 1 output swing each output cycle').result.clock_windows;
            const stock = simulateClockOnly(config, windows, 480, 3, { log() { }, warn() { }, error() { }, debug() { } });
            expect(stock.ticks).toBeGreaterThanOrEqual(3 * 480);
            const science = stock.machines.find(it => it.recipe === 'agricultural-science-pack')!;
            expect(Object.keys(science.inputs).sort()).toEqual(['bioflux', 'pentapod-egg']);
            expect(science.outputs['agricultural-science-pack']).toHaveLength(stock.ticks);
            expect(science.fuel).toHaveLength(stock.ticks);
            // the output inserter takes a hand of 16 a cycle: 25 hands in each window cycle of 480 ticks
            const held = stock.inserters.find(it => it.inserter_id === 'inserter:12')!.held;
            const moved = held.slice(0, 3 * 480).reduce((sum, count, tick) => sum + (tick > 0 && count < held[tick - 1] ? held[tick - 1] - count : 0), 0);
            expect(moved).toBe(3 * 400);
        },
    },
];

// The processing unit circuit export (PROCESSING_UNIT_80_CIRCUIT_EXPORT), a real cell (#189) at 80 processing units a second.
// From the backpressure start its three casting foundries, which no inserter feeds, start full (docs/stability.md, "How a clock is
// started"): the explicit plan is then made on two output cycles, and the per-hand clock of the grouped hands comes from the
// one-swing maker; from the cold start (`overrides.judged_start` "cold") the checks read as they did before.
const circuitExportPlan = (config: Config) => judgedStartOf(config.overrides) === 'cold' ? { ticks: 24, items: 32 } : { ticks: 48, items: 64 };
const circuitExportPerHand = (config: Config, generated: ClockAlternativesResult) =>
    byMaker(generated, judgedStartOf(config.overrides) === 'cold' ? 'planned-belt-slack-per-hand' : 'swings-1-per-hand');
const circuitExport: JobCheck[] = [
    {
        name: 'Behavior: the explicit plan is offered on a backed-up belt, in 24 ticks with 32 items from the cold start, 48 with 64 from the backpressure start',
        run: ({ config, generated }) => {
            const plan = byMaker(generated, 'planned-belt-slack');
            expect(plan, 'the explicit behavior plan is offered, independently of the selector').toBeDefined();
            const { ticks, items } = circuitExportPlan(config);
            expect(plan.result.simulation_duration.ticks).toBe(ticks);
            expect(plan.result.stability_check.as_built).toMatchObject({ holds: true, actual_output_items: items });
            expect(plan.belt).toEqual({ kind: 'backed_up' });
        },
    },
    {
        // the guard per taker gates the 12 takers whose hands and a start more take the 24-tick window cycle; that clock does not get back
        // from every loss, so it is remade once with the takers into the target machines (the processing unit machines 2 and 3) unguarded
        // of the per-hand clock the grouped hands make, which the per-branch clock composed from it is recommended over
        name: 'Selection: the 4 inserters with no window are the circuits into the processing unit machines, which the remake leaves unguarded',
        run: ({ config, generated }) => {
            expect(circuitExportPerHand(config, generated).result.always_on_reasons).toEqual(Object.fromEntries([3, 4, 7, 8]
                .map(number => [`inserter:${number}`, { kind: 'full-duty-cycle', window_cycle_ticks: 24 }])));
        },
    },
    {
        // The export belt (2) is consumed outside the config: the selected clock fills its lanes at their consumption rate, which the
        // two inserters that put circuits on it (16 and 17) move over the simulated window cycle
        name: 'the selected clock fills the export belt at its consumption rate, moved by inserters 16 and 17',
        run: ({ config, generated }) => {
            const selected = selectedOf(generated);
            const lanes = config.belts.find(it => it.id === 2)!.lanes;
            const consumption_per_second = lanes.reduce((sum, lane) => sum + ('consumption_per_second' in lane ? lane.consumption_per_second! : 0), 0);
            const exported = [16, 17].reduce((sum, number) => {
                const [, transfers] = Array.from(selected.result.transfer_history.entries()).find(([id]) => id.id === EntityId.forInserter(number).id)!;
                return sum + transfers.reduce((total, transfer) => total + transfer.amount, 0);
            }, 0);
            expect(exported).toBe(consumption_per_second * selected.result.simulation_duration.ticks / 60);
        },
    },
    {
        name: 'exports the circuits on belt 2 at 40 a second a lane',
        run: ({ config }) => {
            const belt = config.belts.find(it => it.id === 2)!;
            expect(belt.strategy).toBe('export');
            expect(belt.lanes.map(lane => [lane.ingredient, 'consumption_per_second' in lane ? lane.consumption_per_second : undefined]))
                .toEqual([['electronic-circuit', 40], ['electronic-circuit', 40]]);
        },
    },
    {
        // from the cold start the replay from the warm-up inventory is the build stalled in part (the plastic off the belt, inserter 1,
        // picks up nothing in the window cycle recorded) and replaying clock tick 1200 shows it at work; from the backpressure start the
        // other way round (4 pickups, then none). Either way the long run judges stock from index 960, after 240 warm-up ticks
        name: 'records a settled period from the clock tick the long run judges, not the stalled first one',
        run: ({ config, generated }) => {
            // the per-hand clock of the grouped hands, which stalls in its first window cycle; the per-branch clock composed from it does not
            const selected = circuitExportPerHand(config, generated);
            const first_judged_tick = selected.result.stability_check.as_built?.first_judged_tick;
            expect(first_judged_tick).toBe(960);
            const judged_clock_tick = selected.result.stability_check.as_built?.clock_tick_at_first_judged;
            expect(judged_clock_tick).toBe(1200);
            const request = {
                config, mode: 'clock' as const, window_cycle_ticks: selected.result.simulation_duration.ticks,
                terminal_swing_count: selected.result.used_terminal_swing_count, windows: selected.result.clock_windows,
                inserter_clocks: selected.result.unplanned_inserter_clocks ?? {},
            };
            const swings = (recording: ReturnType<typeof recordSimulationTimeline>) => recording.events
                .filter(event => event.entity_id === 'inserter:1' && event.kind === 'pickup').length;
            const cold = recordSimulationTimeline(request);
            const settled = recordSimulationTimeline({ ...request, settle_ticks: judged_clock_tick });
            expect(cold.ticks_before_recording).toBe(240);
            expect(settled.ticks_before_recording).toBe(1200);
            expect(settled.end_tick).toBe(24);
            if (judgedStartOf(config.overrides) === 'cold') {
                expect(swings(cold)).toBe(0);
                expect(swings(settled)).toBeGreaterThan(0);
            } else {
                // from the backpressure start the first replayed window cycle is not stalled; inserter 1 then takes its plastic in
                // other window cycles than the one replayed at the settled tick
                expect([swings(cold), swings(settled)]).toEqual([4, 0]);
            }
        },
    },
];

// The steel wagon build (STEEL_PLATE_26_WAGON_CHEST): the drill into the wagon is enabled before the ore is taken
const steelWagon: JobCheck[] = [
    {
        name: 'the drill into the wagon is enabled 1.08 ticks a period on average',
        run: ({ generated }) => { expect(selectedOf(generated).result.chest_drills?.[0].enabled_ticks).toBeCloseTo(1.078, 3); },
    },
    {
        // the window cycle of 11520/13 ticks over a cycle of 480/13 was once divided as doubles, 24.000000000000004, and inserter 4's
        // 5/8 swings a cycle came out as "6000000000000001/400000000000000" swings a window cycle
        name: 'no description shows a float as a fraction (the period is a whole number of crafting cycles)',
        run: ({ generated }) => {
            for (const alternative of generated.alternatives) {
                const blueprints = [alternative.result.blueprint, alternative.result.modulo_blueprint, alternative.result.subtick?.blueprint];
                for (const blueprint of blueprints.filter(it => it !== undefined)) {
                    for (const text of [blueprint.description, ...blueprint.entities.map(entity => entity.player_description)]) {
                        expect(text ?? '', `${alternative.id}: ${text}`).not.toMatch(/\d{8,}\/\d+/);
                    }
                }
            }
        },
    },
];

// The utility science 480 build (UTILITY_SCIENCE_480_LDS_FOUNDRY_CHAIN): windows from the hands and the order of the chain hold in one cycle, so
// the selected clock needs no search; targeted searches still run past it since #527
const utility480: JobCheck[] = [
    { name: 'the targeted searches that run past the short plan are the two skipped', run: ({ generated }) => { expect(generated.skipped_searches).toEqual(['Moved Output Swing', 'Pitch Pickups']); } },
];

// The utility science build at 320 a second over 3 copies (UTILITY_SCIENCE_320_METERED_TAKERS): two foundries each hand low density structure to
// three of the six assemblers, and no clock made before Round-Robin Polling with metered takers is stable. The mechanism tests of the same build
// stay on its fixture in src/crafting/metered-takers.generation.test.ts
const utility320: JobCheck[] = [
    {
        name: 'the metered clock is made by the metered takers maker, as Round-Robin Polling with metered takers, on 6 output swings',
        run: ({ generated }) => {
            const metered = byId(generated, 'round_robin_polling_metered_takers');
            expect(metered, generated.alternatives.map(it => it.id).join(', ')).toBeDefined();
            expect([metered.maker, metered.result.used_terminal_swing_count]).toEqual(['metered-takers', 6]);
            expect(metered.strategy).toMatchObject({ id: 'round_robin_polling', settings: { shared_windows: 'metered_takers' } });
        },
    },
    {
        // The two halves of the build are copies of one another about the cryogenic plant: the clock is made for one half alone and used on
        // both, each arm of the other half with the window of its turn partner, so the halves share their enable deciders
        name: 'copied regions share one clock',
        run: ({ generated }) => {
            const selected = selectedOf(generated);
            const clock = selected.result;
            expect([selected.id, selected.maker, selected.verdict, selected.assessment.items_per_second.toFixed(2), clock.simulation_duration.ticks])
                .toEqual(['coordinated_sources_region', 'region-layer', 'stable', '320.00', 324]);
            const wake_ups = clock.stability_check.as_built?.wake_ups?.wake_ups_per_minute;
            expect(wake_ups).toBeDefined();
            expect(Number(wake_ups!.toFixed(2))).toBeLessThanOrEqual(498.71);
            expect(selected.deciders).toBe(clock.schedule.inserter_combinators.length);
            expect(decidersOf(clock.clock_windows, clock.simulation_duration.ticks), 'the copy step counts the deciders as the blueprint makes them').toBe(selected.deciders);
            expect(selected.deciders).toBeLessThanOrEqual(11);
            const PARTNERS: [number, number][] = [[1, 11], [2, 12], [3, 20], [4, 18], [5, 14], [6, 16], [9, 17], [10, 21], [13, 19]];
            for (const [a, b] of PARTNERS) expect(clock.clock_windows[`inserter:${a}`], `inserter ${a} and ${b}`).toEqual(clock.clock_windows[`inserter:${b}`]);
            // the region step reports the half the clock was made for and the arms of the other half that take their partner's windows; the
            // plastic arm 15 takes arm 8's, and the coal arm 7 keeps its own. The copy step does not run on it
            expect(clock.region_layer).toEqual({ region: 'machine:4/region:1', strategy: 'coordinated_sources',
                lifted: [11, 12, 20, 18, 14, 16, 17, 21, 19, 15].map(id => `inserter:${id}`) });
            expect(clock.region_copies).toBeUndefined();
            expect([clock.metered_output_windows, clock.metered_input_windows, clock.staggered_input_windows]).toEqual([undefined, undefined, undefined]);
            // the whole build's own clock of the same strategy is listed beside it
            expect(byId(generated, 'coordinated_sources')).toBeDefined();
        },
    },
];

// Metallurgic science at the speeds the game gives its scaffold, its packs taken into a chest that removes them
const metallurgic: JobCheck[] = [
    {
        name: 'the observed windows repeat a state in the long run',
        run: ({ generated }) => {
            // the game makes 480 and every eighth window cycle 496, 100% of the target over 38 window cycles. The long run repeats a
            // state once the keys hold the craft underway and the productivity bars to a billionth of a craft: the bars' rounding
            // drift, which a payout never resets, kept the full doubles of one window cycle from equalling those of a later one
            expect(selectedOf(generated).result.stability_check.as_built?.long_run_proven).toBe(true);
        },
    },
    {
        name: 'the 1-swing and 2-swing subtick clocks do not hold the expected output',
        run: ({ generated }) => {
            for (const clock of [byLabel(generated, 'Takt Batches: 1 output swing each output cycle, subtick clock'), byLabel(generated, 'Takt Batches: 2 output swings each output cycle, subtick clock')]) {
                expect(clock.ranking.holds_expected_output).toBe(false);
            }
        },
    },
];

// Original electromagnetic science with curved inputs and belt disposal (ELECTROMAGNETIC_SCIENCE_240_RECYCLER_BELT_FED): the sample is
// automatic, no window, count or Always is given
const electromagnetic240: JobCheck[] = [
    {
        name: 'the selected clock holds as built, and leaves no inserter always on',
        run: ({ generated }) => {
            const selected = selectedOf(generated);
            expect(selected.result.stability_check.as_built?.holds).toBe(true);
            expect(Object.keys(selected.result.always_on_reasons ?? {})).toHaveLength(0);
        },
    },
    {
        name: 'uses the original curved pickup and sends advanced circuits onto a belt',
        run: ({ config }) => {
            expect(config.inserters.find(inserter => inserter.source.type === 'belt' && inserter.source.pickup_layout === 'bend-right-upstream')?.source)
                .toMatchObject({ pickup_capture: { status: 'supported', model_version: 3 } });
            const byproduct = config.inserters.find(inserter => inserter.filters?.includes('advanced-circuit'))!;
            expect(byproduct.sink.type).toBe('belt');
        },
    },
];

/** The simulator tries the loss of each supply and the output not taken away, and recovers from each */
const lossesRecover = (config: Config, generated: ClockAlternativesResult, expected: [string, boolean][]) => {
    const selected = selectedOf(generated);
    const report = disturbanceTrialOf(config, selected.result.clock_windows, selected.result.simulation_duration.ticks,
        selected.result.stability_check.expected_output_items, quiet);
    expect(report.undisturbed.recovers).toBe(true);
    expect(report.losses.map(outcome => [lossId(outcome.loss), outcome.recovers])).toEqual(expected);
    expect(report.survives).toBe(true);
};

// The electromagnetic science build (ELECTROMAGNETIC_SCIENCE_330) on the drained-end scaffold of one copy (#458)
const electromagnetic330: JobCheck[] = [
    {
        name: 'the simulator tries the loss of each supply and the output not taken away, and gets back from all three',
        run: ({ config, generated }) => lossesRecover(config, generated, [['supply:supercapacitor', true], ['supply:accumulator', true], ['output:electromagnetic-science-pack', true]]),
    },
    // from src/crafting/checked-lanes.generation.test.ts
    {
        name: "on electromagnetic science 330: two input rows, no output row and the chest line",
        run: ({ generated }) => {
            const clock = selectedOf(generated);
            expect(rowsOf(clock)).toEqual([
                { at: "1/1", together: "take 120", label: "Holds", sentence: "Every copy gets its items." },
                { at: "1/2", together: "take 120", label: "Holds", sentence: "Every copy gets its items." },
            ]);
            expect(clock.checked_lanes!.line.sentence).toBe("Checked with all 11 copies on the lanes they share. Every copy gets its items. "
                + "The output goes into a chest of each copy: the infinity chest that holds electromagnetic science pack.");
            expect(clock.checked_lanes!.line.output_chests).toEqual([{ chest_id: 1, kind: "infinity-chest", items: ["electromagnetic-science-pack"] }]);
            expect(reasonsOf(generated)).toEqual({
                euclidean_swings: { code: "belt_gaps", data: { missed: 630, with_gap: 630 } },
                takt_batches_swings_2: { code: "belt_gaps", data: { missed: 567, with_gap: 459 } },
            });
            expect(swingSumsOf(generated)).toEqual({ euclidean_swings: [], takt_batches_swings_2: [] });
        },
    },
];

// The lithium plate build (LITHIUM_PLATE_80_SILO_CHEST): the config marks the two drops that side-load onto the shared belt
const lithium: JobCheck[] = [
    {
        name: 'every clock of the build says the two drops side-load onto another belt',
        run: ({ generated }) => {
            for (const variant of lithiumSiloCases()) {
                const chosen = generated.alternatives.find(alternative => alternative.id === variant.alternative)!;
                expect(chosen.insights.filter(insight => insight.id === 'side-loaded-drop').map(insight => insight.what), variant.name).toEqual([
                    'The inserter (inserter 15) that drops lithium plate drops onto a 3 tile belt buffer that side-loads onto another belt. '
                    + 'The inserter (inserter 16) that drops lithium plate drops onto a 3 tile belt buffer that side-loads onto another belt.']);
            }
        },
    },
    // from src/crafting/coordinated-sources.generation.test.ts: the recommended clock is on 4,320 ticks; the clock of 3.335 wakeups a minute that the
    // game held is composed on 2,160 ticks, the window cycle of the time-division windows, the best-ranked stable clock on another window cycle
    {
        name: "the per-branch clock is composed on the window cycle of the next best clock where that gives fewer wakeups than the recommended clock's",
        run: ({ generated }) => {
            const recommended = generated.alternatives.filter(it => it.id !== "coordinated_sources")
                .reduce((best, it) => (it.verdict === "stable" && it.ranking.wake_ups_per_minute! < best.ranking.wake_ups_per_minute! ? it : best));
            expect([recommended.id, recommended.result.simulation_duration.ticks]).toEqual(["takt_batches_observed_swings_4", 4320]);
            const selected = selectedOf(generated);
            expect([selected.id, selected.verdict, selected.result.simulation_duration.ticks]).toEqual(["coordinated_sources", "stable", 2160]);
            expect(selected.ranking.wake_ups_per_minute).toBeCloseTo(3.335, 3);
        },
    },
];

// The logistic science build with direct insertion (LOGISTIC_SCIENCE_240_DIRECT_INSERT)
const logisticDirect: JobCheck[] = [{
    // the game's cuts are the losses the simulator tries, and it recovers from each (the molten iron is no loss: no belt or chest carries it)
    name: 'the simulator tries the loss of the inserter supply and the output not taken away, and gets back from both',
    run: ({ config, generated }) => lossesRecover(config, generated, [['supply:inserter', true], ['output:logistic-science-pack', true]]),
}];

// The grenade build (GRENADE_240_FILLS_BELT_EXACTLY)
const tagged = (entities: Entities, kind: 'inserters' | 'drills', ids: number[]) =>
    entities.find(entity => JSON.stringify(entity.tags?.clock_generator?.[kind]) === JSON.stringify(ids))!;
/** The networks of one colour of a blueprint, as the sorted sets of connectors ("entity number:connector") its wires join */
const networks = (wires: number[][], green: boolean): string[] => {
    const parent = new Map<string, string>();
    const find = (node: string): string => {
        if (!parent.has(node)) parent.set(node, node);
        const up = parent.get(node)!;
        if (up === node) return node;
        const root = find(up);
        parent.set(node, root);
        return root;
    };
    for (const [from, from_connector, to, to_connector] of wires) {
        if ((from_connector % 2 === 0) === green) parent.set(find(`${from}:${from_connector}`), find(`${to}:${to_connector}`));
    }
    const sets = new Map<string, string[]>();
    for (const node of Array.from(parent.keys())) sets.set(find(node), [...(sets.get(find(node)) ?? []), node]);
    return Array.from(sets.values()).map(members => members.sort().join(',')).sort();
};
// The selected clock is one group's Takt Batches clock on both groups, which takes no turns; the turns are the Round-Robin Polling clock's,
// listed beside it
const grenade: JobCheck[] = [
    {
        name: 'the Round-Robin Polling clock stands its combinators in two groups, a gap between them, each in the order of its turn',
        run: ({ generated }) => {
            const { blueprint } = byId(generated, 'round_robin_polling').result;
            const at = (kind: 'inserters' | 'drills', ids: number[]) => tagged(blueprint.entities, kind, ids).position.x;
            // the machines of one row of the belt are a group: the output swings (1 and 2), the plate inserters (3 and 4), the coal drills (1 and 2)
            const north = [at('inserters', [1, 2]), at('inserters', [3, 4]), at('drills', [1, 2])];
            const south = [at('inserters', [7, 8]), at('inserters', [5, 6]), at('drills', [3, 4])];
            expect(north).toEqual([north[0], north[0] + 1, north[0] + 2]);
            expect(south).toEqual([south[0], south[0] + 1, south[0] + 2]);
            // the empty tiles between the groups, and nothing else out of place along the row
            expect(south[0] - north[2] - 1).toBe(GROUP_GAP_TILES);
            // the clock, its lock and its filter stand before both
            const row = blueprint.entities.filter(entity => entity.name === 'decider-combinator').map(entity => entity.position.x).sort((a, b) => a - b);
            expect(row.slice(0, 2)).toEqual([0.5, 1.5]);
            expect(row[2]).toBe(north[0]);
            expect(new Set(row).size).toBe(row.length);
        },
    },
    {
        name: 'the first combinator of each group says which turn is its, and no other combinator does',
        run: ({ generated }) => {
            const { blueprint } = byId(generated, 'round_robin_polling').result;
            const lines = (entity: Entities[number]) => (entity.player_description ?? '').split('\n');
            const groupLines = blueprint.entities.flatMap(entity => lines(entity).filter(line => line.startsWith('Group ')).map(line => [entity, line] as const));
            expect(groupLines.map(([entity, line]) => [entity.tags?.clock_generator?.inserters, line])).toEqual([
                [[1, 2], 'Group 1 of 2: takes its turn in ticks 1–44 of the 112-tick window cycle. Its combinators stand together, in the order of the turn.'],
                [[7, 8], 'Group 2 of 2: takes its turn in ticks 57–100 of the 112-tick window cycle. Its combinators stand together, in the order of the turn.'],
            ]);
            // after the lines that say what the combinator switches on and when: the header, the line of each inserter, the counts
            for (const [entity] of groupLines) expect(lines(entity).filter(line => !ROUTE_LINE.test(line))[2]).toMatch(/^Group /);
            expect(lines(tagged(blueprint.entities, 'inserters', [1, 2])).slice(0, 3)).toEqual([
                '2 inserters [item=grenade] (1, 2) (A)',
                'Inserters 1, 2: [entity=assembling-machine-3] → [item=grenade] → [entity=turbo-transport-belt]',
                '1 swing each in 1 enable window per 112-tick window cycle: open 1',
            ]);
        },
    },
    {
        name: 'laying the combinators out by group changes nothing else: the same entities in the same order, conditions, outputs, tags and networks',
        run: ({ config, generated }) => {
            const selected = byId(generated, 'round_robin_polling').result;
            // the same windows as a clock that is not in groups: one row in the order of the entity ids
            const flat = clockFromWindows({ ...config, overrides: { ...config.overrides, terminal_swing_count: 1 } }, selected.clock_windows, 112, quiet);
            const [grouped, plain] = [selected.blueprint, flat.blueprint];
            expect(plain.entities.some(entity => (entity.player_description ?? '').includes('Group '))).toBe(false);
            expect(grouped.entities.map(entity => entity.position.x)).not.toEqual(plain.entities.map(entity => entity.position.x));
            const withoutPlace = (entities: Entities) => entities.map(({ position, player_description, ...rest }) => ({ ...rest, first_lines: headerAndCounts(player_description) }));
            expect(withoutPlace(grouped.entities)).toEqual(withoutPlace(plain.entities));
            expect(selected.schedule).toEqual(flat.schedule);
            // the same networks: every window combinator on the one network the filter's output makes, the lock on the same red network
            expect(networks(grouped.wires, true)).toEqual(networks(plain.wires, true));
            expect(networks(grouped.wires, false)).toEqual(networks(plain.wires, false));
            // and every wire within the reach of a copper wire
            const place = (entity_number: number) => grouped.entities.find(entity => entity.entity_number === entity_number)!.position;
            for (const [from, , to] of grouped.wires) {
                expect(Math.hypot(place(from).x - place(to).x, place(from).y - place(to).y)).toBeLessThanOrEqual(8);
            }
            // the clock is another clock to the game, for what it is placed where: its identity (position and wires are part of it) moves, its schedule does not
            expect(clockIdentity(selected).blueprint).not.toBe(clockIdentity(flat).blueprint);
        },
    },
    {
        name: 'every alternative says the lanes of the belt are exactly full, and the selected clock\'s hands fit between each other',
        run: ({ generated }) => {
            for (const alternative of generated.alternatives) {
                expect(alternative.insights.find(it => it.id === 'lanes-exactly-full')?.title).toBe('The grenade lane (lane 1 of belt 1) and the grenade lane (lane 2 of belt 1) are exactly full');
                expect(alternative.insights.find(it => it.id === 'drop-spacing')).toBeDefined();
            }
            // the two inserters of a row start in the same tick: the 14 hands of a row land on 14 tiles of the belt's cycle of 14
            const spacing = selectedOf(generated).insights.find(it => it.id === 'drop-spacing')!;
            expect(spacing.title).toBe('Drops onto the grenade belt fit between each other');
            expect(spacing.table?.rows).toEqual([['1 and 2', '14', '12', '14', '0', '0'], ['7 and 8', '14', '12', '14', '0', '0']]);
            // and which spacings of the copies, and distances between a copy's inserters, would fit as well
            expect(spacing.explanation).toContain('The belt moves 14 tiles a window cycle, so each hand lands on one of 14 tiles. With the inserters (1 and 2) that drop grenade as they stand (3 tiles apart), '
                + 'the copies fit 12, 16, 18, 20, 22 or 24 tiles apart; 13, 15, 17, 19, 23 or 25 apart only with a copy\'s inserters 7 tiles apart; 14 or 21 apart never. '
                + 'The same holds at any of these spacings plus 14. Starting the inserter (inserter 2) that drops grenade 16, 32 or 48 ticks after the inserter (inserter 1) '
                + 'that drops grenade also fits (a tile every 8 ticks).');
        },
    },
];

// The utility science build (UTILITY_SCIENCE_120): a clock made without a search is stable, and the build has a deadlock risk
const utility120: JobCheck[] = [
    { name: 'leaves the searches out by default, and says which', run: ({ generated }) => { expect(generated.skipped_searches).toEqual(SEARCH_LABELS); } },
    { name: 'selects a clock made without a search that the ranking takes for stable', run: ({ generated }) => { expect(selectableAsStable(selectedOf(generated).ranking)).toBe(true); } },
    {
        name: 'every clock names the deadlock risk, in an insight of the build',
        run: ({ generated }) => {
            for (const alternative of generated.alternatives) {
                expect(alternative.deadlock_risks, alternative.id).toHaveLength(1);
                const insight = alternative.insights.find(it => it.id === 'deadlock-risk');
                expect(insight?.scope, alternative.id).toBe('build');
                expect(insight?.what).toContain('The inserter that takes low density structure and flying robot frame and the inserter that takes low density structure '
                    + 'and processing unit both bring low density structure to the assembling machine 3 that makes utility science pack');
            }
        },
    },
    {
        name: 'the clocks are ranked by what they hold, not by whether they get back from a loss',
        run: ({ generated }) => {
            for (const alternative of generated.alternatives.filter(it => Number.isInteger(it.result.simulation_duration.ticks))) {
                expect(alternative.ranking.meets_target_rate, alternative.id).toBe(alternative.verdict !== 'unstable');
            }
        },
    },
];

// The logistic science sample (LOGISTIC_SCIENCE_240): both lanes of its feed belt are dead ends, so every clock is made for a backed-up belt,
// none for a moving belt
const logistic: JobCheck[] = [
    {
        name: 'makes batched swings for a backed-up belt',
        run: ({ generated }) => {
            const batched = byMaker(generated, 'planned-belt-slack');
            expect(batched.label).toBe('Takt Batches: 4 output swings each output cycle');
            expect(batched.belt).toEqual({ kind: 'backed_up' });
            expect(batched.description).toContain('Made for a backed-up belt. Each belt inserter gets the enable windows it needs with backpressure at the pickup.');
        },
    },
    {
        name: 'the 2-swing and the derived clocks are made for a backed-up belt',
        run: ({ generated }) => {
            expect(byMaker(generated, 'swings-2').belt).toEqual({ kind: 'backed_up' });
            expect(byMaker(generated, 'derived').belt).toEqual({ kind: 'backed_up' });
        },
    },
    {
        name: 'the 2-swing clock meets the target rate',
        run: ({ generated }) => { expect(byMaker(generated, 'swings-2').ranking.meets_target_rate).toBe(true); },
    },
    { name: 'leaves two searches out by default (#527 runs observed and shifted searches past a stable short clock)', run: ({ generated }) => { expect(generated.skipped_searches).toEqual(['Moved Output Swing', 'Pitch Pickups']); } },
];

// The ore voider (IRON_ORE_VOIDER_400_EXACT_SPEED): a recycler at crafting speed 16.875 destroys 400 iron ore a second, brought in by four stack
// inserters from the ore supply; it places what it gives back (a quarter of its crafts, at random) into a car, which two stack inserters
// empty back into it. Planned by arithmetic on the expected amounts, with room in the windows for the spread.
const voiderExact: JobCheck[] = [
    {
        name: 'runs no search, and every clock plans 960 ore a period (15 hands of each feeding inserter a 144-tick period)',
        run: ({ generated }) => {
            expect(generated.skipped_searches).toEqual([]);
            for (const alternative of generated.alternatives) expect(alternative.result.stability_check.expected_output_items, alternative.id).toBe(960);
        },
    },
    {
        // In Factorio 2.1.21 an hour of the batched clock brought 896 ore in place of 960 in 5 of 1,900 window cycles, each after window cycles of
        // returns over the mean; even hands' windows leave the returns in the car
        name: 'is tried with the backlog of returns its margins say the car takes up, which costs the batched clock a hand of ore',
        run: ({ config, generated }) => {
            for (const alternative of generated.alternatives) {
                const [crafting] = alternative.result.random_margins!.crafting;
                // 15.49² x ln(740.7) / (2 x 16 spare crafts x 3/4 not given back): 66.1
                expect(crafting.backlog, alternative.id).toEqual([{ item: 'iron-ore', items: 67 }]);
            }
            const excess = excessLossOf(generated.alternatives[0].result.random_margins!.crafting)!;
            expect(excess).toEqual({ kind: 'excess', at: [{ machine_id: 'machine:1', item: 'iron-ore', count: 67 }] });
            const [planned, even] = generated.alternatives.map(alternative => {
                const report = disturbanceTrialOf(config, alternative.result.clock_windows, 144, 960, quiet, {}, undefined, undefined, [excess]);
                return report.losses.find(it => it.loss.kind === 'excess')!;
            });
            // placed into the car at the start of the window cycle, the batched clock brings 896 ore and then 960 again
            expect(planned.recovers).toBe(false);
            expect(planned.trials[0].output_per_bin.slice(0, 2)).toEqual([896, 960]);
            expect(even.recovers).toBe(true);
            expect(even.trials.map(it => it.output_per_bin[0])).toEqual([960, 960, 960, 960]);
        },
    },
    {
        name: 'names each clock by the hands brought in a cycle',
        run: ({ generated }) => {
            expect(generated.alternatives.map(it => it.label)).toEqual(['Takt Batches: 5 hands brought in each output cycle', 'Time-Division Windows: 5 hands brought in each output cycle']);
        },
    },
    {
        name: 'gives the windows that take the returns out of the car the room for all but 1 in 740 periods\' returns',
        run: ({ generated }) => {
            for (const alternative of generated.alternatives) {
                const margins = alternative.result.random_margins!;
                expect(margins.windows.map(it => it.item), alternative.id).toEqual(['iron-ore']);
                const [returns] = margins.windows;
                expect(returns.expected_items).toBe(320);
                expect(returns.sigma_items).toBeCloseTo(15.4919, 4);
                // the binomial of 1280 crafts at 1/4 is under 367 in all but 1 in 740 window cycles: 47 over the 320
                expect(returns.needed_items).toBe(47);
                expect(returns.room_items, alternative.id).toBeGreaterThanOrEqual(returns.needed_items);
                // the recycler's own room is one standard deviation a window cycle, enough for what comes back over 1233 ticks, which the car takes up
                expect(margins.crafting[0].sigmas).toBeCloseTo(1.0328, 4);
                expect(margins.crafting[0].ticks_to_cover).toBe(1233);
            }
            // even hands' windows take one hand each: two of each taker's ten get a swing more
            expect(generated.alternatives[1].result.random_margins!.windows[0].added_hands).toBe(2);
        },
    },
    {
        name: 'is back at 960 ore a period after the ore stops coming, on every clock',
        run: ({ config, generated }) => {
            for (const alternative of generated.alternatives) {
                const report = disturbanceTrialOf(config, alternative.result.clock_windows, 144, 960, quiet);
                expect(report.losses.map(it => [it.loss, it.recovers]), alternative.id).toEqual([[{ kind: 'supply', item: 'iron-ore' }, true]]);
            }
        },
    },
];

// The same cell with six beacons on its recycler (IRON_ORE_VOIDER_400_OVERBEACONED): 852.3 crafts a second, 2045.5 a window cycle against the 1280 it needs
const voiderOverbeaconed: JobCheck[] = [
    {
        name: 'needs no more room of its recycler: what comes back over the mean is covered within a tick',
        run: ({ generated }) => {
            const [crafting] = generated.alternatives[0].result.random_margins!.crafting;
            expect(crafting.capacity).toBeCloseTo(2045.52, 2);
            expect(crafting.ticks_to_cover).toBe(1);
            // 765.5 spare crafts work off what comes back over the mean: 1.4 ore waits at 1 in 740
            expect(crafting.backlog).toEqual([{ item: 'iron-ore', items: 2 }]);
        },
    },
    {
        name: 'is back at 960 ore a period after the ore stops coming, on every clock',
        run: ({ config, generated }) => {
            for (const alternative of generated.alternatives) {
                const report = disturbanceTrialOf(config, alternative.result.clock_windows, 144, 960, quiet);
                expect(report.losses.map(it => [it.loss, it.recovers]), alternative.id).toEqual([[{ kind: 'supply', item: 'iron-ore' }, true]]);
            }
        },
    },
];

// What the generation tests of these samples checked on a generation of their own, the sample as it is with the default options: the same
// generation is the job's now (CONTRIBUTING.md, "Which test a check belongs in"). Each is named by the test it was.

/** The reason beside the status of each clock with a cause on the shared lanes (from checked-lanes-reasons.generation.test.ts): the code of belt gaps
 * where at least one missed swing shows the gap that the copy before leaves, with the totals over the copies of the cause part; unknown on a lane loss
 * where none shows the gap or a full output; and the swings of each cause, swing by swing, add up to the counts it carries */
const reasonsOfClocks = (reasons: Record<string, unknown>): JobCheck => ({
    name: 'the reason of each clock with a cause on the shared lanes',
    run: ({ generated }) => {
        expect(reasonsOf(generated)).toEqual(reasons);
        expect(swingSumsOf(generated)).toEqual(Object.fromEntries(Object.keys(reasons).map(id => [id, []])));
    },
});

const chemical240: JobCheck[] = [
    // the example states the places of the takers, so the lane model runs them where they stand: the gaps halve, and phase_shifted_batch is stable
    reasonsOfClocks({
        takt_batches_observed: { code: "belt_gaps", data: { missed: 228, with_gap: 114 } },
    }),
];

const flyingRobotFrame: JobCheck[] = [
    // no missed swing shows the gap or a full output: unknown, with the missed swings
    reasonsOfClocks({ takt_batches_observed: { code: "unknown", data: { missed: 1698 } }, time_study_windows: { code: "unknown", data: { missed: 1698 } },
        pitch_pickups: { code: "unknown", data: { missed: 1698 } } }),
    // from flying-robot-frame-output-belt.generation.test.ts: the sample states the output belt of its scaffold (two lines of six copies each). The run
    // of the 12 copies puts every copy's frames on those lines, and the clock the generator selects for the build holds on them.
    {
        name: "selects the moved output swing clock of 288 ticks, stable",
        run: ({ generated }) => {
            const selected = selectedOf(generated);
            expect(selected.id).toBe("moved_output_swing");
            expect(selected.verdict).toBe("stable");
            expect(selected.result.simulation_duration.ticks).toBe(288);
        },
    },
    {
        name: "runs the output belt with the hands of all 12 copies, and the selected clock loses no swing on it",
        run: ({ config, generated }) => {
            const selected = selectedOf(generated);
            const ticks = selected.result.simulation_duration.ticks;
            const windows = new Map(Object.entries(selected.result.clock_windows).map(([id, ranges]) => [id, ranges.map(range => OpenRange.from(range.start, range.end))]));
            const { readings } = sharedLaneRunsOf(config);
            const run = runOnSharedLanes(readings[0].under, windows, ticks, readings[0].layouts[0], 12, quiet);
            expect(run.output_belt).toBeDefined();
            expect([...run.output_belt!.hands.keys()].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
            for (const hands of run.output_belt!.hands.values()) expect(hands.length).toBeGreaterThan(0);

            const judged = judgeSharedLanes(config, selected.result.clock_windows, ticks, quiet);
            expect(judged.simulated).toBe(true);
            expect(judged.losses).toEqual([]);
        },
    },
];

const militaryScience240: JobCheck[] = [{
    // from checked-lanes.generation.test.ts
    name: "on military science 240: its two plain output belts by rate, and its line",
    run: ({ generated }) => {
        const clock = selectedOf(generated);
        expect(clock.checked_lanes!.line.sentence).toBe("Checked with all 5 copies on the lanes they share. Every copy gets its items. On the 2 output belts, only the sum of the drops is checked.");
        expect(rowsOf(clock).filter(row => row.label === "Rate fits").map(row => row.at)).toEqual(["1/1", "2/1"]);
        expect(rowsOf(clock).filter(row => row.label === "Holds").map(row => row.at)).toEqual(["3/1", "3/2", "4/1", "4/2"]);
        // the coal lanes are one per copy: no row
        expect(rowsOf(clock).some(row => row.at.startsWith("5/") || row.at.startsWith("6/"))).toBe(false);
    },
}];

// STONE_BRICK_120_DRILL_DIRECT_INSERT (from output-swings.generation.test.ts): one machine, two output hands and nine input hands per 288 ticks. Clocks for
// it are easy to get to the expected output in one simulated window cycle without the build actually repeating that window cycle.
const stoneBrick: JobCheck[] = [{
    name: "the title of the insight of a clock that does not hold the setpoint says it underproduces below the expected output, and overproduces above it",
    run: ({ generated }) => {
        const titleOf = (id: string) => generated.alternatives.find(it => it.id === id)!.insights.find(it => it.id === "unstable");
        // 7 and 8 output swings forced over the setpoint: the build moves more items than the expected output
        for (const id of ["takt_batches_observed_swings_7", "takt_batches_observed_swings_8"]) {
            const insight = titleOf(id)!;
            expect(insight.title).toBe("This clock overproduces");
            // only what was measured: no reason, and one thing to do
            expect(insight.why).toBe("");
            expect(insight.explanation).toBe("Use a clock marked Stable.");
            const [, moved, expected] = /moved ([\d.]+) of (\d+) items/.exec(insight.what)!;
            expect(Number(moved)).toBeGreaterThan(Number(expected));
        }
    },
}];

// AUTOMATION_SCIENCE_240: 9 copies take iron gear wheel and copper plate from the two dead-ended lanes of belt 1, and put the packs on a belt that
// ends in an infinite end. From checked-lanes.generation.test.ts (the first 12 checks), shared-lane-verdict.generation.test.ts (the next two:
// under Euclidean Swings (72 ticks) copy 2's inserter 1 makes 62 of the 65 swings it makes alone with each item, every hand of 16, and a loss is said in
// those swings, never in items or crafts) and shared-lane-trial.generation.test.ts (the last: the selected clock of the pitch pickups, 72 ticks, gets
// back from every loss on one copy, and on the copies a copper plate stop leaves copy 2 short)
const automation240: JobCheck[] = [
    {
        name: "lists every lane of the build once, with the end the role gives the output lane",
        run: ({ generated }) => {
            expect(generated.lanes).toEqual([
                { belt_id: 1, lane: 1, item: "iron-gear-wheel", role: "input", end: "dead_end", end_given_by: "lane", sharing: "shared", supply_rate: 120, supply_rate_by_default: true, capacity: 120 },
                { belt_id: 1, lane: 2, item: "copper-plate", role: "input", end: "dead_end", end_given_by: "lane", sharing: "shared", supply_rate: 120, supply_rate_by_default: true, capacity: 120 },
                { belt_id: 2, lane: 1, item: "automation-science-pack", role: "output", end: "infinite", end_given_by: "role", sharing: "shared", supply_rate: 120, supply_rate_by_default: true, capacity: 120 },
            ]);
        },
    },
    {
        name: "on the 72-tick clock: no loss in the steady run on the copies, the lane parts it shows, and no recovery",
        run: ({ generated }) => {
            const clock = byId(generated, "euclidean_swings");
            expect(clock.result.simulation_duration.ticks).toBe(72);
            expect(clock.verdict).toBe("no recovery");
            expect(rowsOf(clock)).toEqual([
                { at: "1/1", together: "take 120", label: "Holds", sentence: "Every copy gets its items in the steady run." },
                { at: "1/2", together: "take 120", label: "Holds", sentence: "Every copy gets its items in the steady run." },
                { at: "2/1", together: "drop 240", label: "Holds", sentence: "No copy waits at its join in the steady run." },
            ]);
            expect(clock.checked_lanes!.cause).toBeNull();
        },
    },
    {
        name: "on the 216-tick clock of observed takt batches: the join of copies 4 and 8 full, both input lanes taking less",
        run: ({ generated }) => {
            const clock = byId(generated, "takt_batches_observed");
            expect(clock.result.simulation_duration.ticks).toBe(216);
            expect(rowsOf(clock)).toEqual([
                { at: "2/1", together: "drop 240", label: "Join full on copies 4 and 8", sentence: "163 of 1,464 swings missed, on each." },
                { at: "1/1", together: "take 120", label: "Copies 4 and 8 take less", sentence: "They wait for the output belt. Without the output belt, copy 4 still misses 41 of 732 swings here." },
                { at: "1/2", together: "take 120", label: "Copies 4 and 8 take less", sentence: "They wait for the output belt. Without the output belt, copy 4 still misses 41 of 732 swings here." },
            ]);
            const cause = clock.checked_lanes!.cause!;
            expect(cause.headline.text).toBe("Copies 4 and 8 miss 163 of 1,464 swings each");
            expect(cause.cause!.text).toBe("The side belts of copies 4 and 8 are full where they join the automation science pack output belt.");
            // a full join: its code, with the missed output swings and the output swings of copies 4 and 8
            expect(cause.reason).toEqual({ code: "target_full", data: { missed: 326, swings: 2928 } });
            expect(cause.spacing).toBeNull();
            expect(cause.where.text).toBe("The inserter of copy 4 that drops automation science pack misses 163 of its 1,464 swings in 244 window cycles, and so does that of copy 8. "
                + "325 of the 1,301 swings each one makes wait for room.");
            expect(cause.alone.text).toBe("The same inserter makes all 1,464 swings. The clock is right for one copy.");
            expect(cause.changes!.text).toBe("Another clock of this build has no full join: Coordinated Sources, window cycle 72 ticks.");
        },
    },
    {
        // the game's copy 4 makes 96 and 80 packs in turn under this clock, for good (Factorio 2.1.24, #737): with the waits at
        // the underground entrances the copies do as well, and the clock is unstable
        name: "on the time study windows clock: copy 4 short at its join, as in the game",
        run: ({ generated }) => {
            const clock = byId(generated, "time_study_windows");
            expect(clock.verdict).toBe("unstable");
            expect(rowsOf(clock)).toEqual([
                { at: "2/1", together: "drop 240", label: "Join full on copy 4", sentence: "122 of 1,470 swings missed." },
                { at: "1/1", together: "take 120", label: "Copy 4 takes less", sentence: "It waits for the output belt." },
                { at: "1/2", together: "take 120", label: "Copy 4 takes less", sentence: "It waits for the output belt." },
            ]);
        },
    },
    {
        name: "gives the reason code of belt gaps on each lane loss where a missed swing shows the gap, and of a full join on the join clock, with their counts",
        run: ({ generated }) => {
            expect(reasonsOf(generated)).toEqual({
                takt_batches_observed: { code: "target_full", data: { missed: 326, swings: 2928 } },
                time_study_windows: { code: "target_full", data: { missed: 122, swings: 1470 } },
                takt_batches_observed_swings_2: { code: "belt_gaps", data: { missed: 61, with_gap: 31 } },
                takt_batches_swings_1: { code: "belt_gaps", data: { missed: 110, with_gap: 110 } },
            });
            // the reason is a code: the engine writes no sentence for it
            for (const clock of generated.alternatives) {
                for (const text of [clock.description, clock.shared_lane_loss_note ?? ""]) expect(text).not.toMatch(/belt gaps|belt_gaps|target_full/i);
            }
        },
    },
    {
        name: "gives the swings of each cause window cycle by window cycle, which add up to the counts the cause carries by copy, inserter and cause",
        run: ({ generated }) => {
            expect(swingSumsOf(generated)).toEqual({ takt_batches_observed: [], time_study_windows: [], takt_batches_observed_swings_2: [], takt_batches_swings_1: [] });
        },
    },
    {
        name: "on the 216-tick clock: the output swings of copies 4 and 8 in each window cycle, 5, 6, 5 of the 6 the clock gives",
        run: ({ generated }) => {
            const swings = byId(generated, "takt_batches_observed").checked_lanes!.cause!.swings!;
            expect(swings.kind).toBe("join");
            if (swings.kind !== "join") return;
            expect(swings.copies.map(it => ({ copy: it.copy, window_cycles: it.window_cycles, gives: it.gives, made: it.made.join("") })))
                .toEqual([4, 8].map(copy => ({ copy, window_cycles: 244, gives: 6, made: "5" + "565".repeat(81) })));
            // the output inserters drop onto side belts that side-load onto the output belt
            expect(swings.side_belt).toBe(true);
        },
    },
    // what the output inserters of all 9 copies put down over the judged span: 53,920 packs in 13,824 ticks on the 216-tick
    // clock, which 240 x (9 x 384 - 86) / (9 x 384) gives from its swings too
    {
        name: "gives the rate all the copies made together in the run of the copies, over the judged span, on the clocks with a loss",
        run: ({ generated }) => {
            const made = (id: string) => byId(generated, id).checked_lanes!.copies_made;
            expect(made("takt_batches_observed")).toEqual({ items_per_second: 234.061930783, window_cycles: 244 });
            expect(made("euclidean_swings")).toEqual({ items_per_second: 240, window_cycles: 125 });
            expect(made("takt_batches_observed_swings_2")).toEqual({ items_per_second: 236.680272109, window_cycles: 245 });
            expect(made("takt_batches_swings_1")).toEqual({ items_per_second: 234.013605442, window_cycles: 245 });
            // the clock-only run's rate is still the setpoint: the rate of the copies changes no assessment
            expect(byId(generated, "takt_batches_observed").assessment.items_per_second).toBe(240);
        },
    },
    {
        name: "gives the rate of the copies on the time study windows clock, below the setpoint: copy 4 short every other window cycle",
        run: ({ generated }) => { expect(byId(generated, "time_study_windows").checked_lanes!.copies_made).toEqual({ items_per_second: 237.786848073, window_cycles: 245 }); },
    },
    {
        name: "gives no rate of the copies on a clock the copies were not run for (it does not hold on one copy)",
        run: ({ generated }) => {
            const clock = byId(generated, "takt_batches_observed_swings_4");
            expect(clock.checked_lanes!.line.run_with_copies).toBe(false);
            expect(clock.checked_lanes!.copies_made).toBeUndefined();
        },
    },
    {
        name: "gives the description's sentences on a shared-lane loss as a field of their own, word for word",
        run: ({ generated }) => {
            for (const [id, lead] of [["takt_batches_observed_swings_2", "It is not stable on a lane its copies share. "], ["takt_batches_observed", "It is not stable on its output belt. "],
                ["time_study_windows", "It is not stable on its output belt. "]]) {
                const clock = byId(generated, id);
                expect(clock.shared_lane_loss_note!.startsWith(lead)).toBe(true);
                expect(clock.description).toContain(` ${clock.shared_lane_loss_note}`);
            }
            expect(byId(generated, "euclidean_swings").shared_lane_loss_note).toBeUndefined();
        },
    },
    {
        name: "are the hands of the runs: no lane loss on the copies under Euclidean Swings, which has no recovery",
        run: ({ generated }) => {
            const euclidean = byId(generated, "euclidean_swings");
            expect(euclidean.result.simulation_duration.ticks).toBe(72);
            expect((euclidean.assessment.shared_lane_losses ?? []).filter((loss): loss is SharedLaneLoss => !isNotChecked(loss))).toEqual([]);
        },
    },
    {
        name: "leave no count of items or of crafts in any loss text",
        run: ({ generated }) => {
            const texts = generated.alternatives.flatMap(it => (it.assessment.shared_lane_losses ?? []).map(loss => loss.text));
            expect(texts.length).toBeGreaterThan(0);
            for (const text of texts) expect(text).not.toMatch(/takes [\d,]+ in|it takes [\d,]+\.|crafts behind|hands behind/);
        },
    },
    {
        // the stable clock the generation test compared it with, the same build with the trials on the copies switched off, stays in
        // shared-lane-trial.generation.test.ts: the check reads only the build as it is
        name: "is no recovery, naming the loss on the copies, with the trials on the copies on",
        run: ({ generated }) => {
            const clock = byId(generated, "pitch_pickups");
            expect(clock.verdict).toBe("no recovery");
            expect(clock.assessment.disturbance_trial).toMatchObject({ survives: false, broken_by: ["copper plate stops arriving on the copies that share a lane"],
                on_copies: { survives: false, broken_by: "copper plate stops arriving", short: [{ copy: 2 }] } });
            expect(clock.description).toContain("Copper plate stops arriving at the entry of the copper plate lane");
        },
    },
];

export const SAMPLE_CHECKS: Record<string, JobCheck[]> = {
    'config-PRODUCTIVITY_MODULE_80_CHEST_CHAIN': productivityChain,
    'config-AGRICULTURAL_SCIENCE_250': [...agriculturalScience, ...agriculturalBackedUp],
    'config-PROCESSING_UNIT_80_CIRCUIT_EXPORT': circuitExport,
    'config-STEEL_PLATE_26_WAGON_CHEST': steelWagon,
    'config-UTILITY_SCIENCE_480_LDS_FOUNDRY_CHAIN': utility480,
    'config-UTILITY_SCIENCE_320_METERED_TAKERS': utility320,
    'config-METALLURGIC_SCIENCE_45': metallurgic,
    'config-ELECTROMAGNETIC_SCIENCE_240_RECYCLER_BELT_FED': electromagnetic240,
    'config-ELECTROMAGNETIC_SCIENCE_330': electromagnetic330,
    'config-LITHIUM_PLATE_80_SILO_CHEST': lithium,
    'config-LOGISTIC_SCIENCE_240_DIRECT_INSERT': logisticDirect,
    'config-GRENADE_240_FILLS_BELT_EXACTLY': grenade,
    'config-UTILITY_SCIENCE_120': utility120,
    'config-LOGISTIC_SCIENCE_240': logistic,
    'config-IRON_ORE_VOIDER_400_EXACT_SPEED': voiderExact,
    'config-IRON_ORE_VOIDER_400_OVERBEACONED': voiderOverbeaconed,
    'config-AUTOMATION_SCIENCE_240': automation240,
    'config-CHEMICAL_SCIENCE_240_SHARED_FOUNDRY': chemical240,
    'config-FLYING_ROBOT_FRAME_80': flyingRobotFrame,
    'config-MILITARY_SCIENCE_240': militaryScience240,
    'config-STONE_BRICK_120_DRILL_DIRECT_INSERT': stoneBrick,
};
