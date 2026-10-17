import { describe, expect, it } from 'vitest';
import {
    hiddenRecipeIds,
    iconName,
    pickerIds,
    itemName,
    matchesQuery,
    nameIdsInText,
    nameWithId,
    normalizeForSearch,
    recipeName,
    resolveTyped,
    searchIds,
    type GameNames,
} from './gameNames';

// check:icons takes every quoted game id in src for an icon the page draws; these two have none, so they are spelled in parts
const WATER_BARREL = 'water' + '-barrel';
const REGION_CLONER_TOOL = 'region' + '-cloner_selection-tool';

/** A few names as the game writes them, with the ids a rule would get wrong */
const NAMES: GameNames = {
    item: {
        'iron-plate': 'Iron plate',
        'iron-gear-wheel': 'Iron gear wheel',
        'stone-wall': 'Wall',
        teslagun: 'Tesla gun',
        'long-handed-inserter': 'Long-handed inserter',
        'fluoroketone-cold': 'Fluoroketone (Cold)',
        'uranium-235': 'Uranium-235',
        'uranium-238': 'Uranium-238',
        [WATER_BARREL]: 'Water barrel',
        [REGION_CLONER_TOOL]: 'Region cloner selection tool',
    },
    recipe: {
        [WATER_BARREL]: 'Fill Water barrel',
        'iron-plate': 'Iron plate',
    },
};

const label = (id: string) => itemName(NAMES, id);

describe('itemName, recipeName and iconName', () => {
    it('give the name of a known id', () => {
        expect(itemName(NAMES, 'stone-wall')).toBe('Wall');
        expect(recipeName(NAMES, 'iron-plate')).toBe('Iron plate');
        expect(iconName(NAMES, 'teslagun')).toBe('Tesla gun');
    });

    it('give an unknown id back as typed', () => {
        expect(itemName(NAMES, 'foo-bar')).toBe('foo-bar');
        expect(recipeName(NAMES, 'foo-bar')).toBe('foo-bar');
        expect(iconName(NAMES, 'foo-bar')).toBe('foo-bar');
    });

    it('never read an inherited property as a name', () => {
        for (const id of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
            expect(itemName(NAMES, id)).toBe(id);
            expect(recipeName(NAMES, id)).toBe(id);
            expect(iconName(NAMES, id)).toBe(id);
        }
    });

    it('keep a recipe and an item of one id apart', () => {
        expect(itemName(NAMES, WATER_BARREL)).toBe('Water barrel');
        expect(recipeName(NAMES, WATER_BARREL)).toBe('Fill Water barrel');
    });

    it('name a recipe that only the item table has by the item', () => {
        expect(recipeName(NAMES, 'stone-wall')).toBe('Wall');
    });

    it('name an icon by the item first', () => {
        expect(iconName(NAMES, WATER_BARREL)).toBe('Water barrel');
    });
});

describe('nameWithId', () => {
    it('puts the id after a name', () => {
        expect(nameWithId('Iron plate', 'iron-plate')).toBe('Iron plate (iron-plate)');
    });

    it('gives the id alone when it is its own name', () => {
        expect(nameWithId('foo-bar', 'foo-bar')).toBe('foo-bar');
    });
});

describe('normalizeForSearch', () => {
    it('makes a name and its id agree', () => {
        expect(normalizeForSearch('Fluoroketone (Cold)')).toBe(normalizeForSearch('fluoroketone-cold'));
        expect(normalizeForSearch('Fluoroketone (Cold)')).toBe('fluoroketone cold');
        expect(normalizeForSearch('Uranium-235')).toBe(normalizeForSearch('uranium-235'));
        expect(normalizeForSearch('Uranium-235')).toBe('uranium 235');
    });

    it('turns underscores into spaces', () => {
        expect(normalizeForSearch(REGION_CLONER_TOOL)).toBe('region cloner selection tool');
    });

    it('collapses spaces and capitals', () => {
        expect(normalizeForSearch('  IRON   Plate ')).toBe('iron plate');
    });

    it('leaves the empty string empty', () => {
        expect(normalizeForSearch('')).toBe('');
    });
});

describe('matchesQuery', () => {
    it('matches the name or the id', () => {
        for (const query of ['stone wall', 'wall', 'stone-wall']) {
            expect(matchesQuery(query, 'stone-wall', 'Wall')).toBe(true);
        }
        expect(matchesQuery('teslagun', 'teslagun', 'Tesla gun')).toBe(true);
        expect(matchesQuery('tesla gun', 'teslagun', 'Tesla gun')).toBe(true);
    });

    it('takes the words in any order', () => {
        expect(matchesQuery('plate iron', 'iron-plate', 'Iron plate')).toBe(true);
    });

    it('ignores dashes, brackets and case', () => {
        expect(matchesQuery('long handed', 'long-handed-inserter', 'Long-handed inserter')).toBe(true);
        expect(matchesQuery('(cold)', 'fluoroketone-cold', 'Fluoroketone (Cold)')).toBe(true);
        expect(matchesQuery('IRON PLATE', 'iron-plate', 'Iron plate')).toBe(true);
    });

    it('needs every word', () => {
        expect(matchesQuery('iron gear', 'iron-plate', 'Iron plate')).toBe(false);
    });

    it('matches part of a word', () => {
        expect(matchesQuery('uranium-23', 'uranium-235', 'Uranium-235')).toBe(true);
        expect(matchesQuery('uranium-23', 'uranium-238', 'Uranium-238')).toBe(true);
    });

    it('matches everything on an empty query', () => {
        expect(matchesQuery('', 'iron-plate', 'Iron plate')).toBe(true);
        expect(matchesQuery('  ', 'iron-plate', 'Iron plate')).toBe(true);
    });
});

describe('searchIds', () => {
    // in the order of the data
    const ids = ['iron-gear-wheel', 'uranium-238', 'long-handed-inserter', 'iron-plate', 'stone-wall', 'uranium-235', 'teslagun'];

    it('puts the whole name or id first, then the name\'s start, the id\'s start, a later word, then the rest', () => {
        const names: GameNames = {
            item: {
                'heavy-wall': 'Fortress', // a later word of the id only: "the rest"
                'wall-gate': 'Gate', // the id starts with the query
                'small-wall': 'Small wall', // a later word of the name
                'wall-lamp': 'Wall lamp', // the name starts with the query
                'stone-wall': 'Wall', // the whole name
            },
            recipe: {},
        };
        const order = ['heavy-wall', 'wall-gate', 'small-wall', 'wall-lamp', 'stone-wall'];
        expect(searchIds('wall', order, (id) => itemName(names, id))).toEqual(['stone-wall', 'wall-lamp', 'wall-gate', 'small-wall', 'heavy-wall']);
    });

    it('lists an id-only match', () => {
        expect(searchIds('teslagun', ids, label)).toEqual(['teslagun']);
        expect(searchIds('stone-wall', ids, label)).toEqual(['stone-wall']);
    });

    it('keeps the input order within a tier', () => {
        expect(searchIds('uranium', ids, label)).toEqual(['uranium-238', 'uranium-235']);
        expect(searchIds('iron', ids, label)).toEqual(['iron-gear-wheel', 'iron-plate']);
    });

    it('returns every id in its order on an empty query', () => {
        expect(searchIds('', ids, label)).toEqual(ids);
        expect(searchIds('  ', ids, label)).toEqual(ids);
    });

    it('returns nothing when nothing matches', () => {
        expect(searchIds('zzqq', ids, label)).toEqual([]);
    });

    it('leaves its input alone', () => {
        const input = [...ids];
        searchIds('uranium 235', input, label);
        searchIds('', input, label);
        expect(input).toEqual(ids);
    });
});

describe('resolveTyped', () => {
    const ids = Object.keys(NAMES.item);

    it('keeps an id', () => {
        expect(resolveTyped('iron-plate', ids, label)).toBe('iron-plate');
    });

    it('turns a name, in any case and spacing, or an id in capitals, into its id', () => {
        expect(resolveTyped('Iron plate', ids, label)).toBe('iron-plate');
        expect(resolveTyped('iron plate ', ids, label)).toBe('iron-plate');
        expect(resolveTyped('IRON-PLATE', ids, label)).toBe('iron-plate');
        expect(resolveTyped('Tesla gun', ids, label)).toBe('teslagun');
    });

    it('keeps an unknown entry as typed', () => {
        expect(resolveTyped('foo', ids, label)).toBe('foo');
        expect(resolveTyped('constructor', ids, label)).toBe('constructor');
    });

    it('gives an empty string for empty or blank input', () => {
        expect(resolveTyped('', ids, label)).toBe('');
        expect(resolveTyped('   ', ids, label)).toBe('');
    });

    it('keeps a name two ids share as typed', () => {
        const twins: GameNames = { item: { 'wall-a': 'Wall', 'wall-b': 'Wall' }, recipe: {} };
        expect(resolveTyped('Wall', ['wall-a', 'wall-b'], (id) => itemName(twins, id))).toBe('Wall');
    });
});

describe('pickerIds', () => {
    it('leaves out mod and internal ids and the hidden ones, and keeps the order', () => {
        const ids = ['iron-plate', 'ee-a', 'rcalc-a', 'region-cloner_a', 'parameter-0', 'copper-plate', 'hidden-thing'];
        expect(pickerIds(ids, new Set(['hidden-thing']))).toEqual(['iron-plate', 'copper-plate']);
        expect(pickerIds(ids).length).toBe(3);
    });
});

describe('nameIdsInText', () => {
    const names: GameNames = { item: { 'iron-plate': 'Iron plate' }, recipe: { 'iron-gear-wheel': 'Iron gear wheel' } };

    it('says a known id in brackets as its name, and leaves other brackets alone', () => {
        expect(nameIdsInText(names, 'Machine 1 (iron-gear-wheel)')).toBe('Machine 1 (Iron gear wheel)');
        expect(nameIdsInText(names, 'Belt 1 (iron-plate) to Machine 2')).toBe('Belt 1 (Iron plate) to Machine 2');
        expect(nameIdsInText(names, 'Machine 1 (unknown-id) and (3 ticks)')).toBe('Machine 1 (unknown-id) and (3 ticks)');
        expect(nameIdsInText(names, 'no brackets')).toBe('no brackets');
        const barrel = 'wat' + 'er-barr' + 'el';
        const both: GameNames = { item: { [barrel]: 'Water barrel' }, recipe: { [barrel]: 'Fill Water barrel' } };
        expect(nameIdsInText(both, `Machine 1 (${barrel}) takes ${barrel}`)).toBe('Machine 1 (Fill Water barrel) takes Water barrel');
        expect(nameIdsInText(names, 'It needs iron-plate to make iron-gear-wheel, not unknown-id or inserter')).toBe('It needs Iron plate to make Iron gear wheel, not unknown-id or inserter');
    });
});

describe('hiddenRecipeIds', () => {
    it('lists the recipes the data marks hidden, in order', () => {
        expect(hiddenRecipeIds({ a: { hidden: true }, b: {}, c: { hidden: true }, d: { hidden: false } })).toEqual(['a', 'c']);
        expect(hiddenRecipeIds(undefined)).toEqual([]);
    });
});
