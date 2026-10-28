import { describe, expect, it } from 'vitest';
import type { BlueprintGenerationResult } from 'clock-generator/browser';
import { installFactsOf } from './installFacts';

type Input = Parameters<typeof installFactsOf>[0];

/** The facts of a clock with no wake windows of drills unless given */
const factsOf = (input: Omit<Input, 'clock_windows'> & Partial<Pick<Input, 'clock_windows'>>) => installFactsOf({ clock_windows: {}, ...input });

const schedule = (rows: number[][]): Input['schedule'] => ({
    counted_ticks: 600,
    inserter_combinators: rows.map((inserter_ids, index) => ({ entity_number: index + 3, inserter_ids })),
});

/** A blueprint whose entity n is a combinator with the description given for it, and the tags, if any */
const described = (entities: Record<number, { description?: string; tags?: unknown }>): Input['blueprint'] => ({
    entities: Object.entries(entities).map(([number, { description, tags }]) => ({
        entity_number: Number(number),
        name: 'decider-combinator',
        position: { x: Number(number), y: 0 },
        ...(description !== undefined ? { player_description: description } : {}),
        ...(tags !== undefined ? { tags: { clock_generator: tags } } : {}),
    })),
} as unknown as Input['blueprint']);

/** A blueprint whose combinators, numbered from 1, have these descriptions */
const blueprint = (...descriptions: string[]) => described(Object.fromEntries(descriptions.map((description, index) => [index + 1, { description }])));

const empty = blueprint();
// only whether it is there is read
const someBlueprint = {} as NonNullable<BlueprintGenerationResult['modulo_blueprint']>;

/** A clock's schedule rows, already in order, its blueprint, the drill rows it should have and its wake windows */
type DrillCase = [string, number[][], Input['blueprint'], number[][], Input['clock_windows']?];
const expectDrills = (_: string, rows: number[][], blueprint: Input['blueprint'], drills: number[][], clock_windows: Input['clock_windows'] = {}) => {
    expect(factsOf({ schedule: schedule(rows), blueprint, clock_windows })).toMatchObject({ wiring: rows, drills });
};

describe('installFactsOf', () => {
    it('is a book exactly when there is a modulo blueprint', () => {
        expect(factsOf({ schedule: schedule([[1]]), blueprint: empty, modulo_blueprint: someBlueprint }).book).toBe(true);
        expect(factsOf({ schedule: schedule([[1]]), blueprint: empty, modulo_blueprint: undefined }).book).toBe(false);
        expect(factsOf({ schedule: schedule([[1]]), blueprint: empty }).book).toBe(false);
    });

    // a blueprint with no combinators has no drill rows
    it.each([
        ['groups inserters per combinator, ascending, rows by their first id', [[10], [5, 2], [3]], [[2, 5], [3], [10]]],
        ['drops a combinator with no inserters (a part of the clock, or a drill)', [[], [7], []], [[7]]],
        ['gives no rows for an empty schedule', [], []],
    ])('%s', (_, rows, wiring) => {
        expect(factsOf({ schedule: schedule(rows), blueprint: empty })).toMatchObject({ wiring, drills: [] });
    });

    it('does not change the schedule it reads', () => {
        const input = schedule([[3, 1]]);
        factsOf({ schedule: input, blueprint: empty });
        expect(input.inserter_combinators[0].inserter_ids).toEqual([3, 1]);
    });

    it.each<DrillCase>([
        ['finds the drills of a combinator by its tags, whatever its description says', [[9]], described({
            1: { description: 'Clock for [item=stone-brick] 4/s' },
            2: { description: '[entity=electric-mining-drill] [item=stone] → …', tags: { drills: [2, 1] } },
            3: { description: 'Drill 9 for [item=stone]', tags: { inserters: [9] } },
        }), [[1, 2]]],
        ['finds a clocked drill by its combinator, also when every inserter is always on',
            [], blueprint('Clock for 600 ticks', 'Drill 2 for [item=stone] into [recipe=stone-brick]\nOn at 1-30'), [[2]]],
        ['keeps drills that share a combinator together, and reads only the first line',
            [[1]], blueprint('Drills 3, 1 for [item=iron-ore]\n- 1: into [recipe=iron-plate]', 'Inserter 1 for [item=iron-plate]'), [[1, 3]]],
        ['promises no drill combinator for a drill that is always on (it has none)',
            [[1], [2]], blueprint('Inserter 1 for x', 'Inserter 2 for y', 'Clock lock'), []],
    ])('%s', expectDrills);

    describe('drills: the descriptions checked against the wake windows', () => {
        const on = [{ start: 1, end: 30 }];

        it.each<DrillCase>([
            ['agree: the descriptions say which drills share a combinator',
                [], blueprint('Drills 1, 3 for [item=iron-ore]'), [[1, 3]], { 'drill:1': on, 'drill:3': on }],
            ['no description names a clocked drill (their wording changed): the wake windows win, a row per drill',
                [], blueprint('Clock for 600 ticks', 'Drill-o-matic 2 for stone'), [[2], [5]], { 'drill:2': on, 'drill:5': on, 'inserter:1': on }],
            ['a clocked drill the descriptions leave out is added; a described one is kept',
                [[1]], blueprint('Drill 1 for stone'), [[1], [4]], { 'drill:1': on, 'drill:4': on }],
            ['a drill with no wake windows (never switched on) gets no row', [[1]], empty, [], { 'drill:2': [] }],
        ])('%s', expectDrills);
    });

    describe('lines: the first line of each combinator\'s description', () => {
        it('is found for an inserter\'s combinator by the entity number the schedule gives, and is only the first line', () => {
            const combinators = [{ entity_number: 4, inserter_ids: [2, 1] }, { entity_number: 3, inserter_ids: [7] }];
            const facts = factsOf({
                schedule: { counted_ticks: 72, inserter_combinators: combinators },
                blueprint: described({
                    3: { description: '[entity=wooden-chest] → [entity=stone-furnace] [item=coal] (inserter 7)\n1 swing in 1 window' },
                    4: { description: '2 inserters, each [entity=car] → machine 1 [item=iron-ore] (1, 2)\nsecond line' },
                    5: { description: 'Part of the clock: do not wire or change.' },
                }),
            });
            expect(facts.lines).toEqual({
                'inserter:1,2': '2 inserters, each [entity=car] → machine 1 [item=iron-ore] (1, 2)',
                'inserter:7': '[entity=wooden-chest] → [entity=stone-furnace] [item=coal] (inserter 7)',
            });
        });

        it('is found for a drill\'s combinator by its tags, whatever number the entity has', () => {
            const facts = factsOf({
                schedule: schedule([]),
                blueprint: described({ 9: { description: '[entity=big-mining-drill] [item=iron-ore] → [entity=car] (drill 1)\nTops the car up', tags: { drills: [1] } } }),
            });
            expect(facts.lines).toEqual({ 'drill:1': '[entity=big-mining-drill] [item=iron-ore] → [entity=car] (drill 1)' });
        });

        it('is found for a drill\'s combinator in a clock from before the tags, and left out for a combinator with no description', () => {
            const facts = factsOf({
                schedule: { counted_ticks: 72, inserter_combinators: [{ entity_number: 2, inserter_ids: [1] }] },
                blueprint: described({ 1: { description: 'Drill 3 for [item=stone]' }, 2: {} }),
            });
            expect(facts.lines).toEqual({ 'drill:3': 'Drill 3 for [item=stone]' });
        });
    });

    it('is plain data that survives postMessage', () => {
        const facts = factsOf({ schedule: schedule([[2, 1], [4]]), blueprint: blueprint('Drill 1 for z'), modulo_blueprint: someBlueprint });
        expect(structuredClone(facts)).toEqual(facts);
    });
});
