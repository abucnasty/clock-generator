import { describe, expect, it } from 'vitest';
import type { ClockAlternativeView } from '../worker/types';
import { assumptionsText, freeLaneDropText, modeledDetails, phaseChecksText } from './modelAssumptions';

describe('assumptionsText', () => {
    const none = { count: 4, missingType: 0, missingQuality: 0, automatic: 0, unavailable: 0 };

    it('says nothing was assumed when the build sets every type, quality and hand size', () => {
        expect(assumptionsText(none)).toBe('Inserter types, qualities and hand sizes are all set in your build; none were assumed.');
    });

    it('says what was assumed, and how many inserters it is for', () => {
        expect(assumptionsText({ ...none, missingType: 2, missingQuality: 1, automatic: 3, unavailable: 1 }))
            .toBe('2 inserters have no type set, so stack inserter timing is assumed. 1 inserter has no quality set, so legendary timing is assumed. '
                + 'Hand sizes: 1 are set in your build and 3 follow your research (1 unavailable: supported types assume full research).');
    });
});

describe('the model texts', () => {
    it('names the belt whose drop positions were not given', () => {
        expect(freeLaneDropText('Belt 1')).toBe('Where the output inserters drop onto Belt 1 was not given, so each is treated as dropping onto its own '
            + 'stretch of empty belt; two that share a belt in the game could get in each other\'s way.');
    });

    it('says how many other places in its window cycle the clock was tried from', () => {
        expect(phaseChecksText(12)).toBe('The clock was also tried from 12 other places in its window cycle. More starting states can be sampled separately.');
        expect(phaseChecksText(undefined)).toBe('How many other places in its window cycle the clock was tried from is unavailable.');
    });

    it('names a machine with a kick start or an imported fuel by its kind and its recipe', () => {
        const machines = [{ id: 3, prototype: 'biochamber', recipe: 'pentapod-egg' }, { id: 4, prototype: 'biochamber', recipe: 'pentapod-egg' },
            { id: 5, prototype: 'biochamber', recipe: 'agricultural-science-pack' }];
        const assumptions = { machines, kickStarts: [{ machineId: 'machine:3', item: 'pentapod-egg', items: 84 }], outputDrops: [], overrides: undefined,
            machineFuel: [{ machineId: 5, fuel: 'nutrients' }] };
        const words = (id: string) => ({ biochamber: 'Biochamber', 'pentapod-egg': 'Pentapod egg', 'agricultural-science-pack': 'Agricultural science pack',
            nutrients: 'Nutrients' } as Record<string, string>)[id] ?? id;
        expect(modeledDetails({ assumptions } as unknown as ClockAlternativeView, words, words)).toEqual([
            'The Biochamber (machine 3) that makes Pentapod egg gets a kick start of 84 Pentapod egg. Losing those items is a separate recovery question.',
            'The Biochamber that makes Agricultural science pack: imported fuel Nutrients.',
        ]);
        const before = { ...assumptions, machines: undefined };
        expect(modeledDetails({ assumptions: before } as unknown as ClockAlternativeView, words, words)[0]).toMatch(/^Machine 3 gets a kick start/);
    });
    it('names the belt and the inserters of an output drop by their items, from the names the engine carried', () => {
        const outputDrops = [{ beltId: 1, inserterIds: [1, 2], mode: 'shared-lanes' as const }, { beltId: 2, inserterIds: [3], mode: 'free-lane' as const }];
        const entityNames = { 'belt:1': 'grenade belt', 'inserter:1': 'inserter (inserter 1) that drops grenade', 'inserter:2': 'inserter (inserter 2) that drops grenade',
            'belt:2': 'coal belt' };
        const assumptions = { kickStarts: [], outputDrops, overrides: undefined, machineFuel: [], entityNames };
        expect(modeledDetails({ assumptions } as unknown as ClockAlternativeView)).toEqual([
            'The grenade belt: the drop positions you gave are used to space the drops of the inserter (inserter 1) that drops grenade, '
                + 'the inserter (inserter 2) that drops grenade on the belt.',
            freeLaneDropText('the coal belt'),
        ]);
        // a view kept before the names were carried
        expect(modeledDetails({ assumptions: { ...assumptions, entityNames: undefined } } as unknown as ClockAlternativeView)[0]).toMatch(/^Belt 1: .* Inserter 1, Inserter 2 on the belt\.$/);
    });
});
