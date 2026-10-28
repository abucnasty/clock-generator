import { describe, it, expect } from 'vitest';
import { assertLaneCapacity, laneCapacityIssues, laneLoads, lanesExactlyFull, lanesExactlyFullWarning, lanesSharedByCopies, laneSharedByCopiesWarning, warnLanesSharedByCopies } from './lane-capacity-validator';
import { FeasibilityError, LaneCapacityError } from './errors';
import { Config } from './schema';
import { validateConfig } from '../crafting/plan/validate-config';
import { ConfigPaths } from './config-paths';
import { loadConfigFromFile } from './loader';
import { toPlannerFacts } from '../crafting/facts/to-planner-facts';
import { plannerGraphOf } from '../crafting/graph/build-graph';
import { feasibilityOf } from '../crafting/feasibility/assert-feasible';

type Belt = Config['belts'][number];
type Inserter = Config['inserters'][number];

const BELTS = [
    ['transport-belt', 15],
    ['fast-transport-belt', 30],
    ['express-transport-belt', 45],
    ['turbo-transport-belt', 60],
] as const;
const STACKS = [1, 2, 3, 4];

const belt = (id: number, lanes: [string] | [string, string], type: Belt['type'] = 'turbo-transport-belt', stack_size = 4): Belt =>
    ({ id, type, lanes: lanes.map(ingredient => ({ ingredient, stack_size })) as Belt['lanes'] });

const inserter = (id: number, source: Inserter['source'], sink: Inserter['sink']): Inserter => ({ id, source, sink });

/**
 * Gear assemblers (2 iron plates a gear) fed from belt 1 (or an infinity chest) and dropping onto belt 2: the plates taken are twice the gears
 * a second, the gears dropped the target. Fast enough for any target here.
 */
const gears = (parts: { items_per_second: number; copies?: number; machines?: number; input?: Belt | 'chest'; output?: Belt; drop_lane?: 1 | 2 }): Config => {
    const machines = Array.from({ length: parts.machines ?? 1 }, (_, index) => index + 1);
    const chest = parts.input === 'chest';
    return {
        target_output: { recipe: 'iron-gear-wheel', items_per_second: parts.items_per_second, copies: parts.copies ?? 1 },
        machines: machines.map(id => ({ id, recipe: 'iron-gear-wheel', productivity: 0, crafting_speed: 1000 })),
        belts: [...(chest ? [] : [parts.input as Belt | undefined ?? belt(1, ['iron-plate'])]), parts.output ?? belt(2, ['iron-gear-wheel'])],
        ...(chest ? { chests: [{ id: 1, type: 'infinity-chest' as const, item_filter: [{ item_name: 'iron-plate', request_count: 100 }] }] } : {}),
        inserters: machines.flatMap(id => [
            inserter(2 * id - 1, { type: chest ? 'chest' : 'belt', id: 1 }, { type: 'machine', id }),
            inserter(2 * id, { type: 'machine', id }, {
                type: 'belt', id: 2, ...(parts.drop_lane === undefined ? {} : { drop: { lane: parts.drop_lane, position: id } }),
            }),
        ]),
    };
};

const feasibilityIssuesOf = (config: Config) => {
    const facts = toPlannerFacts(config);
    return feasibilityOf(facts, plannerGraphOf(facts)).issues;
};

const issuesOf = (config: Config) => laneCapacityIssues(config).map(({ kind, belt_id, lanes, inserter_ids, items_per_second, capacity_per_second }) =>
    ({ kind, belt_id, lanes, inserter_ids, items_per_second, capacity_per_second }));

describe('what a lane carries', () => {
    it.each(BELTS.flatMap(([type, speed]) => STACKS.map(stack => [type, speed, stack] as const)))(
        '%s at stack %i carries half its %i items a second times the stack on a lane', (type, speed, stack) => {
            // the take off lane 1 of the input belt, and both sides of the one-lane output belt the gears drop onto
            const loads = laneLoads(gears({ items_per_second: 1, input: belt(1, ['iron-plate'], type, stack), output: belt(2, ['iron-gear-wheel'], type, stack) }));
            expect(loads.map(load => [load.belt_id, load.kind, load.lanes, load.capacity_per_second.toDecimal()])).toEqual([
                [1, 'take', [1], speed / 2 * stack],
                [2, 'drop', [1, 2], speed * stack],
            ]);
        });
});

describe('takes from a lane', () => {
    describe.each(BELTS.flatMap(([type, speed]) => STACKS.map(stack => [type, stack, speed / 2 * stack] as const)))(
        '%s at stack %i (%d a second a lane)', (type, stack, capacity) => {
            const config = (takes: number) => gears({ items_per_second: takes / 2, input: belt(1, ['iron-plate'], type, stack) });

            it('passes at capacity and just under it', () => {
                expect(laneCapacityIssues(config(capacity))).toEqual([]);
                expect(laneCapacityIssues(config(capacity - 0.25))).toEqual([]);
            });

            it('refuses just over it', () => {
                expect(issuesOf(config(capacity + 0.25))).toEqual([
                    { kind: 'take', belt_id: 1, lanes: [1], inserter_ids: [1], items_per_second: capacity + 0.25, capacity_per_second: capacity },
                ]);
            });
        });

    it('adds up the inserters of one unit on a lane and names them', () => {
        const config = gears({ items_per_second: 70, machines: 2 });
        expect(() => assertLaneCapacity(config)).toThrow(LaneCapacityError);
        expect(() => assertLaneCapacity(config)).toThrow(
            'A belt lane is asked for more than it carries at the target: Inserters 1 and 3 take 140 a second from lane 1 of belt 1, which carries 120.');
        expect(() => assertLaneCapacity(gears({ items_per_second: 60, machines: 2 }))).not.toThrow();
    });

    it('checks each lane of a belt with two items on its own', () => {
        // an electronic circuit takes 1 iron plate and 3 copper cables: 30 a second take 30 plates and 90 cables
        const circuits = (items_per_second: number, cable_stack = 4): Config => ({
            target_output: { recipe: 'electronic-circuit', items_per_second, copies: 1 },
            machines: [{ id: 1, recipe: 'electronic-circuit', productivity: 0, crafting_speed: 1000 }],
            belts: [
                { id: 1, type: 'turbo-transport-belt', lanes: [{ ingredient: 'iron-plate', stack_size: 4 }, { ingredient: 'copper-cable', stack_size: cable_stack }] },
                belt(2, ['electronic-circuit']),
            ],
            inserters: [inserter(1, { type: 'belt', id: 1 }, { type: 'machine', id: 1 }), inserter(2, { type: 'machine', id: 1 }, { type: 'belt', id: 2 })],
        });
        expect(laneCapacityIssues(circuits(40))).toEqual([]);
        expect(issuesOf(circuits(40, 2))).toEqual([
            { kind: 'take', belt_id: 1, lanes: [2], inserter_ids: [1], items_per_second: 120, capacity_per_second: 60 },
        ]);
        expect(issuesOf(circuits(41))).toEqual([
            { kind: 'take', belt_id: 1, lanes: [2], inserter_ids: [1], items_per_second: 123, capacity_per_second: 120 },
        ]);
    });

    it('lets a take of an item on both lanes use both', () => {
        const both = (takes: number) => gears({ items_per_second: takes / 2, input: belt(1, ['iron-plate', 'iron-plate']) });
        expect(laneCapacityIssues(both(240))).toEqual([]);
        expect(issuesOf(both(242))).toEqual([
            { kind: 'take', belt_id: 1, lanes: [1, 2], inserter_ids: [1], items_per_second: 242, capacity_per_second: 240 },
        ]);
        expect(() => assertLaneCapacity(both(242))).toThrow('Inserter 1 takes 242 a second from both lanes of belt 1, which carry 240.');
    });
});

describe('drops onto a lane', () => {
    describe.each(BELTS.flatMap(([type, speed]) => STACKS.map(stack => [type, stack, speed / 2 * stack] as const)))(
        '%s at stack %i (%d a second a lane)', (type, stack, capacity) => {
            // a lane named by the drop on a belt of two
            const config = (drops: number) => gears({
                items_per_second: drops, drop_lane: 2, input: 'chest',
                output: belt(2, ['iron-gear-wheel', 'iron-gear-wheel'], type, stack),
            });

            it('passes at capacity and just under it', () => {
                expect(laneCapacityIssues(config(capacity))).toEqual([]);
                expect(laneCapacityIssues(config(capacity - 0.25))).toEqual([]);
            });

            it('refuses just over it', () => {
                expect(issuesOf(config(capacity + 0.25))).toEqual([
                    { kind: 'drop', belt_id: 2, lanes: [2], inserter_ids: [2], items_per_second: capacity + 0.25, capacity_per_second: capacity },
                ]);
            });
        });

    it('reads a belt that lists one lane as both lanes for its drops, since a drop can land on either side', () => {
        const config = (drops: number) => gears({ items_per_second: drops, machines: 2, input: 'chest' });
        expect(laneCapacityIssues(config(120))).toEqual([]);
        expect(issuesOf(config(241))).toEqual([
            { kind: 'drop', belt_id: 2, lanes: [1, 2], inserter_ids: [2, 4], items_per_second: 241, capacity_per_second: 240 },
        ]);
        expect(() => assertLaneCapacity(config(241))).toThrow('Inserters 2 and 4 drop 241 a second onto both lanes of belt 2, which carry 240.');
    });

    it('checks the takes and the drops on one belt apart', () => {
        // a lane of iron plates taken (120 of 120 fits) and a lane of gears at stack 1 dropped onto (60 of 30 does not)
        const config: Config = {
            target_output: { recipe: 'iron-gear-wheel', items_per_second: 60, copies: 1 },
            machines: [{ id: 1, recipe: 'iron-gear-wheel', productivity: 0, crafting_speed: 1000 }],
            belts: [{ id: 1, type: 'turbo-transport-belt', lanes: [{ ingredient: 'iron-plate', stack_size: 4 }, { ingredient: 'iron-gear-wheel', stack_size: 1 }] }],
            inserters: [inserter(1, { type: 'belt', id: 1 }, { type: 'machine', id: 1 }), inserter(2, { type: 'machine', id: 1 }, { type: 'belt', id: 1 })],
        };
        expect(issuesOf(config)).toEqual([
            { kind: 'drop', belt_id: 1, lanes: [2], inserter_ids: [2], items_per_second: 60, capacity_per_second: 30 },
        ]);
    });
});

describe('copies', () => {
    it('refuses one unit over capacity whatever the copies', () => {
        expect(issuesOf(gears({ items_per_second: 3 * 61, copies: 3 }))).toEqual([
            { kind: 'take', belt_id: 1, lanes: [1], inserter_ids: [1], items_per_second: 122, capacity_per_second: 120 },
        ]);
    });

    it('only warns when the copies summed are over capacity', () => {
        // 3 copies of a unit that takes 96 plates a second of a lane of 120: 288 if they share it
        const config = gears({ items_per_second: 3 * 48, copies: 3 });
        expect(laneCapacityIssues(config)).toEqual([]);
        expect(() => assertLaneCapacity(config)).not.toThrow();
        expect(lanesSharedByCopies(config).map(issue => [issue.kind, issue.belt_id, issue.lanes, issue.items_per_second])).toEqual([['take', 1, [1], 96]]);
        expect(laneSharedByCopiesWarning(config)).toBe('If the 3 copies share lane 1 of belt 1, they take 2.40 times what it carries '
            + '(3 × 96 = 288 a second, of 120). The config cannot say yet whether its copies share these lanes, so this is only '
            + 'a warning: a build whose copies have belts of their own is not affected.');
        const warned: string[] = [];
        warnLanesSharedByCopies(config, { log: () => { }, warn: (message: string) => warned.push(message), error: () => { }, debug: () => { } });
        expect(warned).toEqual([laneSharedByCopiesWarning(config)]);
    });

    it('warns of nothing at capacity summed, with fractional copies, or with one copy', () => {
        // 2.5 copies of a unit taking 48 plates a second: 120, the lane's capacity
        expect(laneSharedByCopiesWarning(gears({ items_per_second: 60, copies: 2.5 }))).toBeNull();
        expect(laneSharedByCopiesWarning(gears({ items_per_second: 60.5, copies: 2.5 }))).toContain('If the 2.5 copies share lane 1 of belt 1, they take 1.01 times what it carries (2.5 × 48.4 = 121 a second, of 120).');
        expect(laneSharedByCopiesWarning(gears({ items_per_second: 60, copies: 1 }))).toBeNull();
    });

    it('gives no warning for a config whose plan cannot be made', () => {
        expect(laneSharedByCopiesWarning({ ...gears({ items_per_second: 60, copies: 3 }), inserters: [] })).toBeNull();
    });
});

describe('lanes exactly full', () => {
    it('says so of the lanes the drops of the copies fill exactly, here both lanes of a belt that lists one', () => {
        // 2 copies of a unit that drops 120 gears a second on a belt of 2 x 120
        const config = gears({ items_per_second: 240, copies: 2 });
        expect(lanesExactlyFull(config).map(issue => [issue.kind, issue.belt_id, issue.lanes, issue.items_per_second, issue.capacity_per_second])).toEqual([['drop', 2, [1, 2], 120, 240]]);
        expect(lanesExactlyFullWarning(config)).toBe('Both lanes of belt 2 are exactly full at the target: the 2 copies drop 2 × 120 = 240 a second onto lanes that carry 240. '
            + 'Nothing is left over, so every hand has to land in a gap the others leave, and a wait is not made up later.');
    });

    it('says so of one lane, and of a build of one copy', () => {
        const lane = gears({ items_per_second: 120, copies: 3, drop_lane: 1, output: belt(2, ['iron-gear-wheel', 'iron-gear-wheel']) });
        expect(lanesExactlyFullWarning(lane)).toBe('Lane 1 of belt 2 is exactly full at the target: the 3 copies drop 3 × 40 = 120 a second onto a lane that carries 120. '
            + 'Nothing is left over, so every hand has to land in a gap the others leave, and a wait is not made up later.');
        expect(lanesExactlyFullWarning(gears({ items_per_second: 240 }))).toBe('Both lanes of belt 2 are exactly full at the target: the build drops 240 a second onto lanes that carry 240. '
            + 'Nothing is left over, so every hand has to land in a gap the others leave, and a wait is not made up later.');
    });

    it('says nothing below capacity, above it, of takes, or of a config whose plan cannot be made', () => {
        expect(lanesExactlyFullWarning(gears({ items_per_second: 239, copies: 2 }))).toBeNull();
        expect(lanesExactlyFullWarning(gears({ items_per_second: 242, copies: 2 }))).toBeNull();
        // 60 gears a second take 120 plates a second from lane 1, which carries 120: a take, not told
        expect(lanesExactlyFullWarning(gears({ items_per_second: 60 }))).toBeNull();
        expect(lanesExactlyFullWarning({ ...gears({ items_per_second: 240, copies: 2 }), inserters: [] })).toBeNull();
    });
});

describe('where it runs', () => {
    // the one inserter brings at most 87.27 iron plates a second (a hand of 16 every 11 ticks), less than the lane's 120:
    // the feasibility pass refuses 61 gears a second (122 plates) for the inserter before the lane check sees the lane
    it('Check refuses a lane over capacity in one unit: the feasibility pass first, the lane check behind it', () => {
        expect(() => validateConfig(gears({ items_per_second: 61 }))).toThrow(FeasibilityError);
        expect(issuesOf(gears({ items_per_second: 61 }))).toEqual([
            { kind: 'take', belt_id: 1, lanes: [1], inserter_ids: [1], items_per_second: 122, capacity_per_second: 120 },
        ]);
        expect(() => validateConfig(gears({ items_per_second: 43 }))).not.toThrow();
    });

    // four machines drop 130 gears a second onto lane 1 of belt 2, which lists gears on both lanes: the feasibility pass
    // holds a drop to the belt's two sides, 240 a second, and passes it (4 hands of 16 every 11 ticks bring 349.09 plates of the 260 and take 349.09
    // gears out); the lane check counts the drops on the lane they name, 130 of its 120, and refuses it. The machines
    // differ in speed, so that the copies check does not take them for four copies of one
    it('Check refuses drops over a lane\'s capacity that the feasibility pass lets through: the lane check behind it', () => {
        const dropping = (items_per_second: number) => {
            const config = gears({ items_per_second, machines: 4, input: 'chest', drop_lane: 1, output: belt(2, ['iron-gear-wheel', 'iron-gear-wheel']) });
            config.machines = config.machines.map(machine => ({ ...machine, crafting_speed: 1000 + machine.id }));
            return config;
        };
        expect(feasibilityIssuesOf(dropping(130))).toEqual([]);
        expect(() => validateConfig(dropping(130))).toThrow(LaneCapacityError);
        expect(() => validateConfig(dropping(130))).toThrow('Inserters 2, 4, 6 and 8 drop 130 a second onto lane 1 of belt 2, which carries 120.');
        expect(() => validateConfig(dropping(120))).not.toThrow();
    });

    it('lets the feasibility pass refuse a target the machines cannot make before the lane check', () => {
        const slow = gears({ items_per_second: 1000 });
        slow.machines = slow.machines.map(machine => ({ ...machine, crafting_speed: 1 }));
        expect(() => validateConfig(slow)).toThrow('Machine 1 (iron gear wheel) crafts at most 2 a second. The target needs 1000 crafts a second of it');
    });

    it('refuses no sample with a lane over capacity in one unit', async () => {
        for (const sample of [ConfigPaths.LOW_DENSITY_STRUCTURE, ConfigPaths.MILITARY_SCIENCE, ConfigPaths.LOGISTIC_SCIENCE_INSERTER_CRAFTING]) {
            expect(laneCapacityIssues(await loadConfigFromFile(sample))).toEqual([]);
        }
        expect(laneSharedByCopiesWarning(await loadConfigFromFile(ConfigPaths.AGRICULTURAL_SCIENCE))).toContain(
            'If the 5 copies share lane 1 of belt 1, they take 1.50 times what it carries (5 × 36 = 180 a second, of 120).');
        expect(laneSharedByCopiesWarning(await loadConfigFromFile(ConfigPaths.ADVANCED_CIRCUIT))).toBeNull();
    });
});
