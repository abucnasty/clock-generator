// Per-job checks of the jobs that are a sample as it is (group `config`): what the generation test of each build checked on the result that the
// record does not hold. The record pins the selected id, verdict, rate, window cycle, wake-ups, windows and the clock hash of every alternative, and
// hashes the label, description, insights, assessment and why-not-stable; what it cannot say is what a text must read, a field of the result
// that is not in the exported clock (deciders, always-on reasons, the fuel view, the losses the simulator tries), or a relation between them.
import { expect } from 'vitest';
import type { JobCheck } from '../record-job-checks';
import { disturbanceTrialOf, clockFromWindows, selectableAsStable, simulateClockOnly, validateConfig } from '../../../../src/crafting/generate-blueprint';
import type { ClockAlternative, ClockAlternativesResult } from '../../../../src/crafting/generate-blueprint';
import { windowDeciderCount } from '../../../../src/crafting/alternatives';
import { lossId } from '../../../../src/crafting/disturbance-trial';
import { excessLossOf } from '../../../../src/crafting/random-margins';
import { clockIdentity } from '../../../../src/crafting/clock-identity';
import { recordSimulationTimeline } from '../../../../src/crafting/record-timeline';
import { EntityId } from '../../../../src/entities';
import { GROUP_GAP_TILES } from '../../../../src/crafting/turn-groups';
import { SEARCH_LABELS } from '../../../../src/crafting/generate-blueprint-test-helpers';
import type { Config } from '../../../../src/config/schema';
import { lithiumSiloCases } from '../lithium-plate-80-silo-chest-clock-fixtures';

const quiet = { log() { }, info() { }, warn() { }, error() { }, debug() { } };
const selectedOf = (generated: ClockAlternativesResult): ClockAlternative => generated.alternatives[generated.selected_index];
const byMaker = (generated: ClockAlternativesResult, maker: string): ClockAlternative => generated.alternatives.find(alternative => alternative.maker === maker)!;
const byLabel = (generated: ClockAlternativesResult, label: string): ClockAlternative => generated.alternatives.find(alternative => alternative.label === label)!;
type Entities = ClockAlternative['result']['blueprint']['entities'];
const deciderDescriptions = (alternative: ClockAlternative) => alternative.result.blueprint.entities
    .filter(entity => entity.name === 'decider-combinator')
    .map(entity => (entity.player_description ?? '').split('\n').slice(0, 2));

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
                '2 inserters [item=plastic-bar] [item=electronic-circuit] (6, 9)',
                '2.424 swings each in 1 enable window per 72-tick window cycle: open 35–60',
            ]);
            expect(descriptions('planned-belt-slack')).toContainEqual([
                '2 inserters [item=advanced-circuit] [item=electronic-circuit] (8, 10)',
                '3.333 swings each in 1 enable window per 72-tick window cycle: open 3–28',
            ]);
            expect(descriptions('planned-belt-slack-shared')).toContainEqual([
                '3 inserters [item=copper-cable] [item=plastic-bar] [item=electronic-circuit] (5, 6, 9)',
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
const circuitExport: JobCheck[] = [
    {
        name: 'Behavior: the explicit one-cycle plan is offered, in 24 ticks with 32 items, on a moving belt',
        run: ({ generated }) => {
            const plan = byMaker(generated, 'planned-belt-slack');
            expect(plan, 'the explicit behavior plan is offered, independently of the selector').toBeDefined();
            expect(plan.result.stability_check.as_built).toMatchObject({ holds: true, actual_output_items: 32 });
            expect(plan.belt).toEqual({ kind: 'moving' });
        },
    },
    {
        // the guard per taker gates the 12 takers whose hands and a start more take the 24-tick window cycle; that clock does not get back
        // from every loss, so it is remade once with the takers into the target machines (the processing unit machines 2 and 3) unguarded
        // of the per-hand clock the grouped hands make, which the per-branch clock composed from it is recommended over
        name: 'Selection: the 4 inserters with no window are the circuits into the processing unit machines, which the remake leaves unguarded',
        run: ({ generated }) => {
            expect(byMaker(generated, 'planned-belt-slack-per-hand').result.always_on_reasons).toEqual(Object.fromEntries([3, 4, 7, 8]
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
        // the replay from the warm-up inventory is the build stalled in part (the plastic off the belt, inserter 1, picks up
        // nothing in the window cycle recorded); the long run judges stock from index 960, after 240 warm-up ticks; replaying clock tick 1200
        // shows the inserters at work
        name: 'records a settled period from the clock tick the long run judges, not the stalled first one',
        run: ({ config, generated }) => {
            // the per-hand clock of the grouped hands, which stalls in its first window cycle; the per-branch clock composed from it does not
            const selected = byMaker(generated, 'planned-belt-slack-per-hand');
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
            expect(swings(cold)).toBe(0);
            expect(swings(settled)).toBeGreaterThan(0);
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

// Metallurgic science at the speeds the game gives its scaffold, its packs taken into a chest that removes them
const metallurgic: JobCheck[] = [
    {
        name: 'the observed windows do not repeat a state in the long run',
        run: ({ generated }) => {
            // the long run repeats no state: the game makes 480 and every eighth window cycle 496, 100% of the target over 38 window cycles
            expect(selectedOf(generated).result.stability_check.as_built?.long_run_proven).toBe(false);
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
];

// The lithium plate build (LITHIUM_PLATE_80_SILO_CHEST): the config marks the two drops that side-load onto the shared belt
const lithium: JobCheck[] = [{
    name: 'every clock of the build says the two drops side-load onto another belt',
    run: ({ generated }) => {
        for (const variant of lithiumSiloCases()) {
            const chosen = generated.alternatives.find(alternative => alternative.id === variant.alternative)!;
            expect(chosen.insights.filter(insight => insight.id === 'side-loaded-drop').map(insight => insight.what), variant.name).toEqual([
                'Inserter 15 drops onto a 3 tile belt buffer that side-loads onto another belt. '
                + 'Inserter 16 drops onto a 3 tile belt buffer that side-loads onto another belt.']);
        }
    },
}];

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
const grenade: JobCheck[] = [
    {
        name: 'the selected clock stands its combinators in two groups, a gap between them, each in the order of its turn',
        run: ({ generated }) => {
            const { blueprint } = selectedOf(generated).result;
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
            const { blueprint } = selectedOf(generated).result;
            const lines = (entity: Entities[number]) => (entity.player_description ?? '').split('\n');
            const groupLines = blueprint.entities.flatMap(entity => lines(entity).filter(line => line.startsWith('Group ')).map(line => [entity, line] as const));
            expect(groupLines.map(([entity, line]) => [entity.tags?.clock_generator?.inserters, line])).toEqual([
                [[1, 2], 'Group 1 of 2: takes its turn in ticks 1–44 of the 112-tick window cycle. Its combinators stand together, in the order of the turn.'],
                [[7, 8], 'Group 2 of 2: takes its turn in ticks 57–100 of the 112-tick window cycle. Its combinators stand together, in the order of the turn.'],
            ]);
            // after the lines that say what the combinator switches on and when, which stay the first two
            for (const [entity] of groupLines) expect(lines(entity)[2]).toMatch(/^Group /);
            expect(lines(tagged(blueprint.entities, 'inserters', [1, 2]))[0]).toBe('2 inserters, each [entity=assembling-machine-3] → [entity=turbo-transport-belt] [item=grenade] (1, 2)');
            expect(lines(tagged(blueprint.entities, 'inserters', [1, 2]))[1]).toBe('1 swing each in 1 enable window per 112-tick window cycle: open 1');
        },
    },
    {
        name: 'laying the combinators out by group changes nothing else: the same entities in the same order, conditions, outputs, tags and networks',
        run: ({ config, generated }) => {
            const selected = selectedOf(generated).result;
            // the same windows as a clock that is not in groups: one row in the order of the entity ids
            const flat = clockFromWindows({ ...config, overrides: { ...config.overrides, terminal_swing_count: 1 } }, selected.clock_windows, 112, quiet);
            const [grouped, plain] = [selected.blueprint, flat.blueprint];
            expect(plain.entities.some(entity => (entity.player_description ?? '').includes('Group '))).toBe(false);
            expect(grouped.entities.map(entity => entity.position.x)).not.toEqual(plain.entities.map(entity => entity.position.x));
            const withoutPlace = (entities: Entities) => entities.map(({ position, player_description, ...rest }) => ({ ...rest, first_lines: (player_description ?? '').split('\n').slice(0, 2) }));
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
                expect(alternative.insights.find(it => it.id === 'lanes-exactly-full')?.title).toBe('Both lanes of belt 1 are exactly full');
                expect(alternative.insights.find(it => it.id === 'drop-spacing')).toBeDefined();
            }
            // the two inserters of a row start in the same tick: the 14 hands of a row land on 14 tiles of the belt's cycle of 14
            const spacing = selectedOf(generated).insights.find(it => it.id === 'drop-spacing')!;
            expect(spacing.title).toBe('Drops onto belt 1 fit between each other');
            expect(spacing.table?.rows).toEqual([['1 and 2', '14', '12', '14', '0', '0'], ['7 and 8', '14', '12', '14', '0', '0']]);
            // and which spacings of the copies, and distances between a copy's inserters, would fit as well
            expect(spacing.explanation).toContain('The belt moves 14 tiles a window cycle, so each hand lands on one of 14 tiles. With inserters 1 and 2 as they stand (3 tiles apart), '
                + 'the copies fit 12, 16, 18, 20, 22 or 24 tiles apart; 13, 15, 17, 19, 23 or 25 apart only with a copy\'s inserters 7 tiles apart; 14 or 21 apart never. '
                + 'The same holds at any of these spacings plus 14. Starting inserter 2 16, 32 or 48 ticks after inserter 1 also fits (a tile every 8 ticks).');
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
                expect(insight?.what).toContain('Inserters 1 and 2 both bring low-density-structure to machine 1');
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

// The logistic science sample (LOGISTIC_SCIENCE_240): its belts move, so every clock is made for a moving belt, none for a backed-up belt
const logistic: JobCheck[] = [
    {
        name: 'makes batched swings for a moving belt',
        run: ({ generated }) => {
            const batched = byMaker(generated, 'planned-belt-slack');
            expect(batched.label).toBe('Takt Batches: 4 output swings each output cycle');
            expect(batched.belt).toEqual({ kind: 'moving' });
            expect(batched.description).toContain('Made for a moving belt. The pickup geometry times each pickup from the belt');
        },
    },
    {
        name: 'the 2-swing and the derived clocks are made for a moving belt',
        run: ({ generated }) => {
            expect(byMaker(generated, 'swings-2').belt).toEqual({ kind: 'moving' });
            expect(byMaker(generated, 'derived').belt).toEqual({ kind: 'moving' });
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

export const SAMPLE_CHECKS: Record<string, JobCheck[]> = {
    'config-PRODUCTIVITY_MODULE_80_CHEST_CHAIN': productivityChain,
    'config-AGRICULTURAL_SCIENCE_250': agriculturalScience,
    'config-PROCESSING_UNIT_80_CIRCUIT_EXPORT': circuitExport,
    'config-STEEL_PLATE_26_WAGON_CHEST': steelWagon,
    'config-UTILITY_SCIENCE_480_LDS_FOUNDRY_CHAIN': utility480,
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
};
