import { describe, expect, it } from 'vitest';
import type { BlueprintGenerationResult } from 'clock-generator/browser';
import { installFactsOf } from './installFacts';

type Input = Parameters<typeof installFactsOf>[0];

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
        expect(installFactsOf({ schedule: schedule([[1]]), blueprint: empty, modulo_blueprint: someBlueprint }).book).toBe(true);
        expect(installFactsOf({ schedule: schedule([[1]]), blueprint: empty, modulo_blueprint: undefined }).book).toBe(false);
        expect(installFactsOf({ schedule: schedule([[1]]), blueprint: empty }).book).toBe(false);
    });

    it('groups inserters per combinator, ascending, rows by their first id', () => {
        expect(installFactsOf({ schedule: schedule([[10], [5, 2], [3]]), blueprint: empty }).wiring).toEqual([[2, 5], [3], [10]]);
    });

    it('keeps merged inserters together in one row', () => {
        expect(installFactsOf({ schedule: schedule([[2, 1], [4]]), blueprint: empty }).wiring).toEqual([[1, 2], [4]]);
    });

    it('drops a combinator with no inserters (a part of the clock, or a drill)', () => {
        expect(installFactsOf({ schedule: schedule([[], [7], []]), blueprint: empty }).wiring).toEqual([[7]]);
    });

    it('gives no rows for an empty schedule', () => {
        expect(installFactsOf({ schedule: schedule([]), blueprint: empty })).toMatchObject({ wiring: [], drills: [] });
    });

    it('does not change the schedule it reads', () => {
        const input = schedule([[3, 1]]);
        installFactsOf({ schedule: input, blueprint: empty });
        expect(input.inserter_combinators[0].inserter_ids).toEqual([3, 1]);
    });

    it('finds a clocked drill by its combinator, also when every inserter is always on', () => {
        const facts = installFactsOf({
            schedule: schedule([]),
            blueprint: blueprint('Clock for 600 ticks', 'Drill 2 for [item=stone] into [recipe=stone-brick]\nOn at 1-30'),
        });
        expect(facts).toMatchObject({ wiring: [], drills: [[2]] });
    });

    it('keeps drills that share a combinator together, and reads only the first line', () => {
        const facts = installFactsOf({
            schedule: schedule([[1]]),
            blueprint: blueprint('Drills 3, 1 for [item=iron-ore]\n- 1: into [recipe=iron-plate]', 'Inserter 1 for [item=iron-plate]'),
        });
        expect(facts.drills).toEqual([[1, 3]]);
        expect(facts.wiring).toEqual([[1]]);
    });

    it('promises no drill combinator for a drill that is always on (it has none)', () => {
        const facts = installFactsOf({ schedule: schedule([[1], [2]]), blueprint: blueprint('Inserter 1 for x', 'Inserter 2 for y', 'Clock lock') });
        expect(facts.drills).toEqual([]);
    });

    it('is plain data that survives postMessage', () => {
        const facts = installFactsOf({ schedule: schedule([[2, 1], [4]]), blueprint: blueprint('Drill 1 for z'), modulo_blueprint: someBlueprint });
        expect(structuredClone(facts)).toEqual(facts);
    });
});
