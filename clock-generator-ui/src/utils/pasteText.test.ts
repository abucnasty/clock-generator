import { describe, expect, it } from 'vitest';
import type { Config } from 'clock-generator/browser';
import { chestTypesText, idsText, importedAsOneUnitText, inserterDetailLines } from './pasteText';

const label = (id: string) => id.charAt(0).toUpperCase() + id.slice(1).replaceAll('-', ' ');
const stack = (id: number, extra = {}) => ({ id, prototype: 'stack-inserter', quality: 'legendary' as const, stack_size: 16, ...extra });

describe('chestTypesText', () => {
    it('names the types in the order they first appear, with counts', () => {
        expect(chestTypesText([{ type: 'car' }, { type: 'infinity-chest' }])).toBe('1 car and 1 infinity chest');
        expect(chestTypesText([{ type: 'infinity-chest' }, { type: 'cargo-wagon' }])).toBe('1 infinity chest and 1 cargo wagon');
        expect(chestTypesText([{ type: 'infinity-chest' }, { type: 'infinity-chest' }, { type: 'rocket-silo' }, { type: 'infinity-chest' }])).toBe('3 infinity chests and 1 rocket silo');
        expect(chestTypesText([{ type: 'car' }, { type: 'tank' }, { type: 'buffer-chest' }])).toBe('1 car, 1 tank and 1 chest');
    });
    it('calls a chest without a known type a chest', () => {
        expect(chestTypesText([{}, { type: 'unknown' }])).toBe('2 chests');
        expect(chestTypesText([{ type: 'toString' }])).toBe('1 chest');
        expect(chestTypesText([])).toBe('');
    });
});

describe('idsText', () => {
    it('writes runs of three or more as a range and the rest one by one', () => {
        expect(idsText([1, 2, 3, 4])).toBe('1 to 4');
        expect(idsText([1, 4])).toBe('1 and 4');
        expect(idsText([2, 3])).toBe('2 and 3');
        expect(idsText([5])).toBe('5');
        expect(idsText([1, 2, 3, 5, 7, 8])).toBe('1 to 3, 5, 7 and 8');
    });
});

describe('inserterDetailLines', () => {
    it('groups inserters with the same settings, as approved for the car and the wagon', () => {
        expect(inserterDetailLines([1, 2, 3, 4].map(id => stack(id)), label))
            .toEqual(['Inserters 1 to 4: Legendary stack inserters, 16 items at a time, no filter.']);
        expect(inserterDetailLines([stack(1, { filters: ['iron-plate'] }), stack(2, { filters: ['steel-plate'] }), stack(3, { filters: ['steel-plate'] }),
            stack(4, { filters: ['iron-plate'] }), stack(5, { filters: ['iron-ore'] })], label)).toEqual([
            'Inserters 1 and 4: Legendary stack inserters, 16 items at a time, filter Iron plate.',
            'Inserters 2 and 3: Legendary stack inserters, 16 items at a time, filter Steel plate.',
            'Inserter 5: Legendary stack inserter, 16 items at a time, filter Iron ore.',
        ]);
    });
    it('says what the export left out and the generator assumed, and an enable rule set by hand', () => {
        expect(inserterDetailLines([{ id: 1 }], label)).toEqual(['Inserter 1: Legendary stack inserter (type and quality not in the export; assumed), 16 items at a time (assumes all inserter capacity research), no filter.']);
        expect(inserterDetailLines([{ ...stack(2), quality: undefined, overrides: { enable_control: { mode: 'ALWAYS' } } }], label))
            .toEqual(['Inserter 2: Legendary stack inserter (quality not in the export; assumed), 16 items at a time, no filter, enable rule ALWAYS.']);
        expect(inserterDetailLines([stack(3, { overrides: { enable_control: { mode: 'AUTO' } } })], label)[0]).not.toContain('enable rule');
        expect(inserterDetailLines([stack(4, { filters: ['a', 'b'], filter_mode: 'blacklist' })], label)[0]).toContain('a blacklist, which is not supported');
        expect(inserterDetailLines([stack(5, { prototype: 'not-an-inserter', stack_size: undefined })], label)[0]).toContain('capacity not known for this type');
    });
    it('keeps an inserter without an id by its place in the list', () => {
        expect(inserterDetailLines([{ prototype: 'fast-inserter', quality: 'normal', stack_size: 4 }, { prototype: 'fast-inserter', quality: 'normal', stack_size: 4 }], label))
            .toEqual(['Inserters 1 and 2: Normal fast inserters, 4 items at a time, no filter.']);
    });
});

describe('importedAsOneUnitText', () => {
    const config = { drills: { configs: [{ id: 1, target: { type: 'chest', id: 2 } }] }, chests: [{ id: 1, type: 'infinity-chest' }, { id: 2, type: 'car' }] } as unknown as Config;
    const proof = (code: string, message: string, repeatedGroups = 2) => ({ stage: 'proof' as const, reason: { code, message }, repeatedGroups });
    it('names the container a drill drops into, and what to do', () => {
        expect(importedAsOneUnitText(proof('unsupported-boundary', 'A drill into a chest is not supported in a repeated unit.'), config)).toEqual({
            what: 'This export holds 2 identical copies of a build. They can\'t be split into copies yet because a drill drops into a car, so it comes in as one unit.',
            next: 'Check will not run on it like this. Select one complete group in Factorio, export it again, and set Copies to 2.',
        });
        const silo = { ...config, chests: [{ id: 2, type: 'infinity-chest' }] } as unknown as Config;
        expect(importedAsOneUnitText(proof('unsupported-boundary', 'x'), silo).what).toContain('because a drill drops into an infinity chest,');
    });
    it('gives the engine\'s reason for any other refusal, and says groups that only look alike could not be proved the same', () => {
        const none = {} as Config;
        expect(importedAsOneUnitText(proof('unassigned-entities', 'An unreferenced belt or infinity chest cannot be assigned to a complete unit.', 3), none).what)
            .toBe('This export holds 3 identical copies of a build. They can\'t be split into copies yet because an unreferenced belt or infinity chest cannot be assigned to a complete unit, so it comes in as one unit.');
        expect(importedAsOneUnitText(proof('nonuniform-units', 'x'), none).what)
            .toBe('This export holds 2 groups that look alike. We couldn\'t prove they are identical, so it comes in as one unit.');
        expect(importedAsOneUnitText({ stage: 'check', reason: { code: 'candidate-check-failed', message: 'The copy cannot meet the target.' }, repeatedGroups: 4 }, none).what)
            .toBe('This export holds 4 identical copies of a build. They can\'t be split into copies yet because one copy would not pass Check (The copy cannot meet the target), so it comes in as one unit.');
    });
});
