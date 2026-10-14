import { describe, expect, it } from 'vitest';
import type { BlueprintGenerationResult } from 'clock-generator/browser';
import { installFactsOf } from './installFacts';

type Input = Parameters<typeof installFactsOf>[0];

const schedule = (rows: number[][]): Input['schedule'] => ({
    counted_ticks: 600,
    inserter_combinators: rows.map((inserter_ids, index) => ({ entity_number: index + 3, inserter_ids })),
});

// only whether it is there is read
const someBlueprint = {} as NonNullable<BlueprintGenerationResult['modulo_blueprint']>;

describe('installFactsOf', () => {
    it('is a book exactly when there is a modulo blueprint', () => {
        expect(installFactsOf({ schedule: schedule([[1]]), modulo_blueprint: someBlueprint }).book).toBe(true);
        expect(installFactsOf({ schedule: schedule([[1]]), modulo_blueprint: undefined }).book).toBe(false);
        expect(installFactsOf({ schedule: schedule([[1]]) }).book).toBe(false);
    });

    it('groups inserters per combinator, ascending, rows by their first id', () => {
        expect(installFactsOf({ schedule: schedule([[10], [5, 2], [3]]) }).wiring).toEqual([[2, 5], [3], [10]]);
    });

    it('keeps merged inserters together in one row', () => {
        expect(installFactsOf({ schedule: schedule([[2, 1], [4]]) }).wiring).toEqual([[1, 2], [4]]);
    });

    it('drops a combinator with no inserters (a part of the clock, or a drill)', () => {
        expect(installFactsOf({ schedule: schedule([[], [7], []]) }).wiring).toEqual([[7]]);
    });

    it('gives no rows for an empty schedule', () => {
        expect(installFactsOf({ schedule: schedule([]) }).wiring).toEqual([]);
    });

    it('does not change the schedule it reads', () => {
        const input = schedule([[3, 1]]);
        installFactsOf({ schedule: input });
        expect(input.inserter_combinators[0].inserter_ids).toEqual([3, 1]);
    });

    it('is plain data that survives postMessage', () => {
        const facts = installFactsOf({ schedule: schedule([[2, 1], [4]]), modulo_blueprint: someBlueprint });
        expect(structuredClone(facts)).toEqual(facts);
    });
});
