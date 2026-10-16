import { describe, expect, it } from 'vitest';
import { TargetProductionRateConfigSchema } from 'clock-generator/browser';
import { copiesProblem } from './copiesProblem';
import { firstProblemOf, focusIdOf } from './firstProblem';

const valid = [5.5, 2.25, 0.5, 0.001, 0.0625];
const invalid = [0, -1, Infinity, -Infinity, NaN, 0.0001, 1 / 3];

describe('Copies field and engine schema agreement', () => {
    it.each([...valid, ...invalid])('uses the same boundary for %s', copies => {
        const targetOutput = { recipe: 'iron-gear-wheel', items_per_second: 1, copies };
        const accepted = TargetProductionRateConfigSchema.safeParse(targetOutput).success;
        expect(accepted).toBe(valid.includes(copies));
        expect(copiesProblem(copies) === null).toBe(accepted);
        const problem = firstProblemOf({ targetOutput, machines: [{ id: 1, recipe: 'iron-gear-wheel' }], coverageIssues: [] });
        if (accepted) expect(problem).toBeNull();
        else {
            expect(problem?.text).toBe(copiesProblem(copies));
            expect(focusIdOf(problem!.target!)).toBe('target-copies');
        }
    });
});
