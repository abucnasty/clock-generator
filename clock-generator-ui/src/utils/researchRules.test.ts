import factorioData from '../../../clock-generator/resources/data-filtered.json?raw';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { applyResearch, type FactorioData, type ResearchBonuses } from 'clock-generator/browser';
import { inserterHand, INSERTER_HANDS, laneStack, type Bonuses } from './researchProfiles';

const DATA = JSON.parse(factorioData) as FactorioData;

// the engine's numbers and the profile store's are one shape: each is assignable to the other (`tsc -b` judges this)
expectTypeOf<ResearchBonuses>().toExtend<Bonuses>();
expectTypeOf<Bonuses>().toExtend<ResearchBonuses>();

const bonusesOf = (fields: Partial<Bonuses>): Bonuses => ({
    mining_drill_productivity_bonus: 0,
    inserter_stack_size_bonus: 0,
    bulk_inserter_capacity_bonus: 0,
    belt_stack_size_bonus: 0,
    recipes: {},
    ...fields,
});

/** What the engine writes for a one-inserter build, `base` listing that one row */
function engineHand(prototype: string, bonuses: Bonuses): unknown {
    const build = {
        machines: [],
        inserters: [{ id: 1, source: { type: 'machine', id: 1 }, sink: { type: 'machine', id: 2 }, prototype }],
        belts: [],
    };
    const base = { machines: [], drills: [], silos: [], inserters: [{ id: 1 }], belts: [] };
    const result = applyResearch(build as never, base, { profile: 'P', template: null, bonuses }, DATA);
    return (result.build.inserters[0] as { stack_size?: number }).stack_size;
}

/** What the engine writes for the first lane of a one-belt build, `base` listing that one row */
function engineLane(bonuses: Bonuses): unknown {
    const build = {
        machines: [],
        inserters: [],
        belts: [{ id: 1, type: 'turbo-transport-belt', lanes: [{ ingredient: 'iron-plate', stack_size: 2 }] }],
    };
    const base = { machines: [], drills: [], silos: [], inserters: [], belts: [{ id: 1 }] };
    const result = applyResearch(build as never, base, { profile: 'P', template: null, bonuses }, DATA);
    return (result.build.belts[0].lanes[0] as { stack_size: number }).stack_size;
}

describe('the rules of a research profile and of the engine', () => {
    const NUMBERS: [number, number][] = [[0, 0], [3, 11], [1, 2], [7, 254]];

    it.each(Object.keys(INSERTER_HANDS))('give a %s the same hand', prototype => {
        for (const [inserter, bulk] of NUMBERS) {
            const bonuses = bonusesOf({ inserter_stack_size_bonus: inserter, bulk_inserter_capacity_bonus: bulk });
            expect(engineHand(prototype, bonuses), `${prototype} at ${inserter}, ${bulk}`).toBe(inserterHand(prototype, bonuses));
        }
    });

    it.each([0, 1, 2, 3, 4, 5])('give a belt lane the same stack at a belt bonus of %s', bonus => {
        const bonuses = bonusesOf({ belt_stack_size_bonus: bonus });
        expect(engineLane(bonuses)).toBe(laneStack(bonuses));
    });
});
