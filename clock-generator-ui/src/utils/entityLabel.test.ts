import { describe, expect, it } from 'vitest';
import { machineInSentence, sentenceStart } from './entityLabel';

const labels = { itemLabel: (id: string) => ({ biochamber: 'Biochamber', foundry: 'Foundry' } as Record<string, string>)[id] ?? id,
    recipeLabel: (id: string) => ({ 'rocket-fuel-from-jelly': 'Rocket fuel from jelly', 'jellynut-processing': 'Jellynut processing' } as Record<string, string>)[id] ?? id };
const machines = [{ id: 1, prototype: 'biochamber', recipe: 'rocket-fuel-from-jelly' }, { id: 2, prototype: 'biochamber', recipe: 'jellynut-processing' },
    { id: 3, prototype: 'biochamber', recipe: 'rocket-fuel-from-jelly' }];

describe('a machine as a sentence about a result names it', () => {
    it('is its kind and its recipe in the game\'s names, with its number only where the build has two alike', () => {
        expect(machineInSentence(2, machines, labels)).toBe('the biochamber that makes jellynut processing');
        expect(machineInSentence('machine:3', machines, labels)).toBe('the biochamber (machine 3) that makes rocket fuel from jelly');
        expect(sentenceStart(machineInSentence(1, machines, labels))).toBe('The biochamber (machine 1) that makes rocket fuel from jelly');
    });

    it('is its row label in a view kept before the machines were carried, or for a machine the build does not have', () => {
        expect(machineInSentence(1, undefined, labels)).toBe('Machine 1');
        expect(machineInSentence('machine:9', machines, labels)).toBe('Machine 9');
    });
});
