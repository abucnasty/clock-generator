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

/** A blueprint whose combinators have these descriptions */
const blueprint = (...descriptions: string[]): Input['blueprint'] => ({
    entities: descriptions.map((player_description, index) => ({
        entity_number: index + 1,
        name: 'decider-combinator',
        position: { x: index, y: 0 },
        player_description,
    })),
} as unknown as Input['blueprint']);

const empty = blueprint();
// only whether it is there is read
const someBlueprint = {} as NonNullable<BlueprintGenerationResult['modulo_blueprint']>;

describe('installFactsOf', () => {
    it('is a book exactly when there is a modulo blueprint', () => {
        expect(factsOf({ schedule: schedule([[1]]), blueprint: empty, modulo_blueprint: someBlueprint }).book).toBe(true);
        expect(factsOf({ schedule: schedule([[1]]), blueprint: empty, modulo_blueprint: undefined }).book).toBe(false);
        expect(factsOf({ schedule: schedule([[1]]), blueprint: empty }).book).toBe(false);
    });

    it('groups inserters per combinator, ascending, rows by their first id', () => {
        expect(factsOf({ schedule: schedule([[10], [5, 2], [3]]), blueprint: empty }).wiring).toEqual([[2, 5], [3], [10]]);
    });

    it('drops a combinator with no inserters (a part of the clock, or a drill)', () => {
        expect(factsOf({ schedule: schedule([[], [7], []]), blueprint: empty }).wiring).toEqual([[7]]);
    });

    it('gives no rows for an empty schedule', () => {
        expect(factsOf({ schedule: schedule([]), blueprint: empty })).toMatchObject({ wiring: [], drills: [] });
    });

    it('does not change the schedule it reads', () => {
        const input = schedule([[3, 1]]);
        factsOf({ schedule: input, blueprint: empty });
        expect(input.inserter_combinators[0].inserter_ids).toEqual([3, 1]);
    });

    it('finds the drills of a combinator by its tags, whatever its description says', () => {
        const tagged = blueprint('Clock for [item=stone-brick] 4/s', '[entity=electric-mining-drill] [item=stone] → …', 'Drill 9 for [item=stone]');
        const entities = (tagged as unknown as { entities: Record<string, unknown>[] }).entities;
        entities[1].tags = { clock_generator: { drills: [2, 1] } };
        entities[2].tags = { clock_generator: { inserters: [9] } };
        expect(factsOf({ schedule: schedule([[9]]), blueprint: tagged }).drills).toEqual([[1, 2]]);
    });

    it('finds a clocked drill by its combinator, also when every inserter is always on', () => {
        const facts = factsOf({
            schedule: schedule([]),
            blueprint: blueprint('Clock for 600 ticks', 'Drill 2 for [item=stone] into [recipe=stone-brick]\nOn at 1-30'),
        });
        expect(facts).toMatchObject({ wiring: [], drills: [[2]] });
    });

    it('keeps drills that share a combinator together, and reads only the first line', () => {
        const facts = factsOf({
            schedule: schedule([[1]]),
            blueprint: blueprint('Drills 3, 1 for [item=iron-ore]\n- 1: into [recipe=iron-plate]', 'Inserter 1 for [item=iron-plate]'),
        });
        expect(facts.drills).toEqual([[1, 3]]);
        expect(facts.wiring).toEqual([[1]]);
    });

    it('promises no drill combinator for a drill that is always on (it has none)', () => {
        const facts = factsOf({ schedule: schedule([[1], [2]]), blueprint: blueprint('Inserter 1 for x', 'Inserter 2 for y', 'Clock lock') });
        expect(facts.drills).toEqual([]);
    });

    describe('drills: the descriptions checked against the wake windows', () => {
        const windows = { start: 1, end: 30 };

        it('agree: the descriptions say which drills share a combinator', () => {
            const facts = factsOf({
                schedule: schedule([]),
                blueprint: blueprint('Drills 1, 3 for [item=iron-ore]'),
                clock_windows: { 'drill:1': [windows], 'drill:3': [windows] },
            });
            expect(facts.drills).toEqual([[1, 3]]);
        });

        it('no description names a clocked drill (their wording changed): the wake windows win, a row per drill', () => {
            const facts = factsOf({
                schedule: schedule([]),
                blueprint: blueprint('Clock for 600 ticks', 'Drill-o-matic 2 for stone'),
                clock_windows: { 'drill:2': [windows], 'drill:5': [windows], 'inserter:1': [windows] },
            });
            expect(facts).toMatchObject({ wiring: [], drills: [[2], [5]] });
        });

        it('a clocked drill the descriptions leave out is added; a described one is kept', () => {
            const facts = factsOf({
                schedule: schedule([[1]]),
                blueprint: blueprint('Drill 1 for stone'),
                clock_windows: { 'drill:1': [windows], 'drill:4': [windows] },
            });
            expect(facts.drills).toEqual([[1], [4]]);
        });

        it('a drill with no wake windows (never switched on) gets no row', () => {
            const facts = factsOf({ schedule: schedule([[1]]), blueprint: empty, clock_windows: { 'drill:2': [] } });
            expect(facts.drills).toEqual([]);
        });
    });

    describe('lines: the first line of each combinator\'s description', () => {
        /** A blueprint whose entity n has the description given for it, and the tags, if any */
        const described = (entities: Record<number, { description?: string; tags?: unknown }>): Input['blueprint'] => ({
            entities: Object.entries(entities).map(([number, { description, tags }]) => ({
                entity_number: Number(number),
                name: 'decider-combinator',
                position: { x: Number(number), y: 0 },
                ...(description !== undefined ? { player_description: description } : {}),
                ...(tags !== undefined ? { tags: { clock_generator: tags } } : {}),
            })),
        } as unknown as Input['blueprint']);

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
