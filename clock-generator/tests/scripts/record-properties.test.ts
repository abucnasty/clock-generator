// The property module of the record (tests/game/builds/record-properties.ts): six properties on every alternative of a job's result.
// The results are made by hand here: a clean one passes, and one field broken in it fails the property that reads the field,
// naming the property, the alternative and the values. No generation.
import { beforeAll, describe, expect, it } from 'vitest';
import { ConfigPaths } from '../../src/config/config-paths';
import { loadConfigFromFile } from '../../src/config/loader';
import type { Config } from '../../src/config/schema';
import { Entity } from '../../src/entities';
import { createEntityRegistryFromConfig } from '../../src/crafting/sequence/simulation-context';
import { checkProperties, EXCEPTIONS, moduleSha256, PROPERTIES } from '../game/builds/record-properties';

let config: Config;
let always_on: string[];
let inserter_numbers: number[];

beforeAll(async () => {
    config = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE_240);
    const registry = createEntityRegistryFromConfig(config);
    always_on = registry.getAll().filter(it => Entity.isInserter(it) || Entity.isDrill(it)).map(it => it.entity_id.id);
    inserter_numbers = always_on.filter(id => id.startsWith('inserter:')).map(id => Number(id.slice('inserter:'.length)));
});

/** An alternative as the generator makes it, with the fields the properties read, and every property true of it */
const made = (override: Record<string, any> = {}): any => {
    const alternative: any = {
        id: 'time_division_windows', maker: 'even-hands', verdict: 'stable', deciders: 2,
        assessment: { holds: true, backpressure_loss: { survives: true }, wake_ups_per_minute: 3, signals_per_minute: 4 }, ranking: { meets_target_rate: true },
        strategy: { id: 'time_division_windows', tuning_method: 'calculated', settings: { output_count: { kind: 'output_swings', count: 2 }, window_cycle: [], belt_pickups: [] }, output_swings: 2, routing: { router: 'direct' } },
        result: {
            used_terminal_swing_count: 2,
            clock_windows: {}, unplanned_inserter_clocks: {},
            always_on_reasons: Object.fromEntries(always_on.map(id => [id, 'a reason'])),
            schedule: { inserter_combinators: [] },
            stability_check: {
                as_built: {
                    wake_ups: { wake_ups_per_minute: 3, inserters: [{ inserter_id: 'inserter:1', wake_ups_per_minute: 3 }] },
                    counters: {
                        deciders: 2, copies: config.setpoint.copies ?? 1, wired_inserters: 0, unwired_inserters: 1,
                        inserters: [{ inserter_id: 'inserter:1', input_wake_ups_per_minute: 1, output_wake_ups_per_minute: 2, network_width: 0,
                            switch_ons_per_minute: 0, switch_offs_per_minute: 0, switch_ons_at_rest_per_minute: 0, switch_ons_moving_per_minute: 0,
                            swings_per_minute: 1, grabs_per_minute: 1 }],
                    },
                },
            },
            fuel_consumption_view: { ran_out_of_fuel: false, fuel_levels: [{ machine_id: 'machine:1', empty_ticks: 0, first_empty_tick: null }] },
        },
    };
    for (const [path, value] of Object.entries(override)) {
        const keys = path.split('.');
        const last = keys.pop()!;
        keys.reduce((o, k) => o[k], alternative)[last] = value;
    }
    return alternative;
};

const check = (...alternatives: any[]) => checkProperties('config-TEST', config, { alternatives });

describe('the property module', () => {
    it('passes a result every property holds of, and counts what it checked on each property', () => {
        const report = check(made(), made({ id: 'planned' }));
        expect(report.problems).toEqual([]);
        expect(report.checked).toEqual(Object.fromEntries(PROPERTIES.map(name => [name, 2])));
        expect(report.module_sha256).toBe(moduleSha256());
    });

    it('counts an alternative with no counters, no fuel view or no schedule as one the property does not apply to', () => {
        const bare = made();
        delete bare.result.stability_check.as_built;
        delete bare.result.fuel_consumption_view;
        delete bare.result.schedule;
        const report = check(bare);
        expect(report.problems).toEqual([]);
        expect(report.checked).toMatchObject({ 'always-on-reasons-named': 1, 'decider-build-order': 0, 'stable-holds-and-survives-loss': 1, 'counters-add-up': 0, 'fuel-never-dry': 0, 'strategy-and-signals': 1 });
    });

    describe('a result with one field broken fails the property that reads it, naming the alternative and the values', () => {
        const only = (report: ReturnType<typeof check>) => {
            expect(report.problems).toHaveLength(1);
            return report.problems[0];
        };

        it('always-on-reasons-named: an inserter left always on with no reason', () => {
            const reasons = made().result.always_on_reasons;
            delete reasons[always_on[0]];
            const problem = only(check(made({ 'result.always_on_reasons': reasons })));
            expect(problem).toEqual({ property: 'always-on-reasons-named', alternative: 'time_division_windows', message: `time_division_windows: ${always_on[0]} is always on with no reason` });
        });

        it('decider-build-order: a decider built in the other order than the check gives it', () => {
            const [first, second] = inserter_numbers;
            const windows = { [`inserter:${first}`]: [{ start: 0, end: 4 }], [`inserter:${second}`]: [{ start: 10, end: 14 }] };
            const reasons = made().result.always_on_reasons;
            delete reasons[`inserter:${first}`];
            delete reasons[`inserter:${second}`];
            const result = (numbers: [number, number]) => check(made({
                'result.clock_windows': windows, 'result.always_on_reasons': reasons,
                'result.schedule': { inserter_combinators: [{ inserter_ids: [first], entity_number: numbers[0] }, { inserter_ids: [second], entity_number: numbers[1] }] },
            }));
            const [a, b] = [result([5, 9]), result([9, 5])];
            // the check orders the two the same way in both builds; exactly one of the two orders the blueprint builds them in agrees
            expect([a.problems.length, b.problems.length].sort()).toEqual([0, 2]);
            const broken = a.problems.length > 0 ? a : b;
            expect(broken.problems[0]).toMatchObject({ property: 'decider-build-order', alternative: 'time_division_windows' });
            expect(broken.problems[0].message).toMatch(/the check orders them -?1, the blueprint builds them -?1 \(decider numbers \d+ and \d+, check positions \d+ and \d+\)/);
        });

        it('stable-holds-and-survives-loss: a stable verdict on a clock that does not survive the loss', () => {
            const problem = only(check(made({ 'assessment.backpressure_loss': { survives: false } })));
            expect(problem.property).toBe('stable-holds-and-survives-loss');
            expect(problem.alternative).toBe('time_division_windows');
            expect(problem.message).toBe('verdict stable against survives false: stable only when it is not unstable and survives');
        });

        it('stable-holds-and-survives-loss: a clock that does not hold is tried for the loss, and one that meets the target rate is not stable', () => {
            const unstable = check(made({ verdict: 'unstable', 'assessment.holds': false, 'ranking.meets_target_rate': false }));
            expect(unstable.problems.map(it => it.message)).toEqual([expect.stringContaining('verdict unstable and backpressure_loss tried')]);
            const recovery = check(made({ verdict: 'no recovery', 'assessment.backpressure_loss': { survives: false } }));
            expect(recovery.problems.map(it => it.message)).toEqual(['meets the target rate with verdict no recovery']);
        });

        it('counters-add-up: input and output wake-ups that are not the inserter\'s wake-ups', () => {
            const report = check(made({ 'result.stability_check.as_built.counters.inserters': [{
                inserter_id: 'inserter:1', input_wake_ups_per_minute: 1, output_wake_ups_per_minute: 5, network_width: 0,
                switch_ons_per_minute: 0, switch_offs_per_minute: 0, switch_ons_at_rest_per_minute: 0, switch_ons_moving_per_minute: 0, swings_per_minute: 1, grabs_per_minute: 1 }] }));
            expect(report.problems.every(it => it.property === 'counters-add-up' && it.alternative === 'time_division_windows')).toBe(true);
            expect(report.problems.map(it => it.message)).toContain('inserter:1: input and output wake-ups 6 against its wake-ups 3');
        });

        it('strategy-and-signals: a strategy with no tuning method, signals counted where wake-ups are not, a count of swings the clock was not made at, and an id of another alternative', () => {
            const messages = (override: Record<string, any>) => {
                const found = check(made(override)).problems.filter(it => it.property === 'strategy-and-signals');
                expect(found.every(it => it.alternative === 'time_division_windows')).toBe(true);
                return found.map(it => it.message);
            };
            expect(messages({ 'strategy.tuning_method': null })).toEqual(['strategy time_division_windows with tuning method none and router direct']);
            expect(messages({ 'strategy.id': null })).toEqual(['strategy none with tuning method calculated and router direct']);
            expect(check(made(), made()).problems.filter(it => it.property === 'strategy-and-signals').map(it => it.message))
                .toEqual(['id time_division_windows is another alternative\'s of the job as well']);
            expect(messages({ 'assessment.wake_ups_per_minute': null })).toEqual(['signals 4 a minute against wake-ups null: counted on the same run, so null together']);
            expect(messages({ 'strategy.output_swings': 3 })).toEqual(['strategy says 3 output swings, the clock was made at 2']);
            expect(messages({ 'strategy.settings.output_count': { kind: 'hands_brought_in', count: 2 } })).toEqual(['strategy counts its swings as hands_brought_in']);
            expect(messages({ deciders: 0 })).toEqual(expect.arrayContaining(['4 signals a minute from 0 window deciders']));
            expect(messages({ 'assessment.signals_per_minute': undefined })).toEqual(expect.arrayContaining(['signals a minute not counted']));
        });

        it('fuel-never-dry: a machine with no fuel for 12 ticks', () => {
            const problem = only(check(made({ 'result.fuel_consumption_view': { ran_out_of_fuel: false, fuel_levels: [{ machine_id: 'machine:2', empty_ticks: 12, first_empty_tick: 340 }] } })));
            expect(problem).toEqual({ property: 'fuel-never-dry', alternative: 'time_division_windows', message: 'machine:2 had no fuel for 12 ticks, from tick 340' });
        });
    });

    it('has counters with no wake-ups to add up to fail the property', () => {
        const report = check(made({ 'result.stability_check.as_built.wake_ups': undefined }));
        expect(report.problems).toEqual([{ property: 'counters-add-up', alternative: 'time_division_windows', message: expect.stringContaining('counters with no wake-ups') }]);
    });

    it('keeps the first problems of a property of a job, and lists a named exception apart from the problems', () => {
        const broken = made({ 'result.fuel_consumption_view': { ran_out_of_fuel: true, fuel_levels: [] } });
        EXCEPTIONS['config-TEST'] = { 'fuel-never-dry': { alternatives: ['time_division_windows'], reason: 'a build that runs dry on purpose' } };
        try {
            const report = check(broken);
            expect(report.problems).toEqual([]);
            expect(report.excepted).toEqual([{ property: 'fuel-never-dry', alternative: 'time_division_windows', reason: 'a build that runs dry on purpose', found: ['the fuel consumption view says a machine ran out of fuel'] }]);
        } finally {
            delete EXCEPTIONS['config-TEST'];
        }
        expect(check(broken).problems).toHaveLength(1);
        // an exception is of the alternatives it names, and of no other
        EXCEPTIONS['config-TEST'] = { 'fuel-never-dry': { alternatives: ['planned'], reason: 'another alternative' } };
        try {
            expect(check(broken).problems).toHaveLength(1);
        } finally {
            delete EXCEPTIONS['config-TEST'];
        }
        const many = check(...Array.from({ length: 30 }, (_, index) => made({ id: `a${index}`, 'result.fuel_consumption_view': { ran_out_of_fuel: true, fuel_levels: [] } })));
        expect(many.problems).toHaveLength(20);
        expect(many.checked['fuel-never-dry']).toBe(30);
    });
});
