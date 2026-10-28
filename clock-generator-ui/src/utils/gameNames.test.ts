import { describe, expect, it } from 'vitest';
import { names } from '../test/fixtures';
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
} from './gameNames';

// check:icons takes every quoted game id in src for an icon the page draws; these two have none, so they are spelled in parts
const WATER_BARREL = 'water' + '-barrel';
const REGION_CLONER_TOOL = 'region' + '-cloner_selection-tool';

/** A few names as the game writes them, with the ids a rule would get wrong */
const NAMES = names({
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
}, {
    [WATER_BARREL]: 'Fill Water barrel',
    'iron-plate': 'Iron plate',
});

const label = (id: string) => itemName(NAMES, id);

describe('itemName, recipeName and iconName', () => {
    it.each([
        ['a known item', itemName, 'stone-wall', 'Wall'],
        ['a known recipe', recipeName, 'iron-plate', 'Iron plate'],
        ['a known icon', iconName, 'teslagun', 'Tesla gun'],
        // a recipe and an item of one id are kept apart
        ['the item of an id a recipe has too', itemName, WATER_BARREL, 'Water barrel'],
        ['the recipe of an id an item has too', recipeName, WATER_BARREL, 'Fill Water barrel'],
        ['a recipe that only the item table has, by the item', recipeName, 'stone-wall', 'Wall'],
        ['an icon by the item first', iconName, WATER_BARREL, 'Water barrel'],
    ])('name %s', (_, nameOf, id, name) => {
        expect(nameOf(NAMES, id)).toBe(name);
    });

    it.each(['foo-bar', 'constructor', 'toString', '__proto__', 'hasOwnProperty'])('give %s back as typed: an unknown id, never an inherited property', (id) => {
        for (const nameOf of [itemName, recipeName, iconName]) {
            expect(nameOf(NAMES, id)).toBe(id);
        }
    });
});

describe('nameWithId', () => {
    it.each([
        ['puts the id after a name', 'Iron plate', 'iron-plate', 'Iron plate (iron-plate)'],
        ['gives the id alone when it is its own name', 'foo-bar', 'foo-bar', 'foo-bar'],
    ])('%s', (_, name, id, shown) => {
        expect(nameWithId(name, id)).toBe(shown);
    });
});

describe('normalizeForSearch', () => {
    it.each([
        // a name and its id agree
        ['Fluoroketone (Cold)', 'fluoroketone cold'],
        ['fluoroketone-cold', 'fluoroketone cold'],
        ['Uranium-235', 'uranium 235'],
        ['uranium-235', 'uranium 235'],
        [REGION_CLONER_TOOL, 'region cloner selection tool'], // underscores turn into spaces
        ['  IRON   Plate ', 'iron plate'], // spaces and capitals collapse
        ['', ''],
    ])('makes %j %j', (text, normalized) => {
        expect(normalizeForSearch(text)).toBe(normalized);
    });
});

describe('matchesQuery', () => {
    it.each([
        ['the id as words', 'stone wall', 'stone-wall'],
        ['the name', 'wall', 'stone-wall'],
        ['the id', 'stone-wall', 'stone-wall'],
        ['the id', 'teslagun', 'teslagun'],
        ['the name', 'tesla gun', 'teslagun'],
        ['the words in any order', 'plate iron', 'iron-plate'],
        ['without dashes', 'long handed', 'long-handed-inserter'],
        ['without brackets', '(cold)', 'fluoroketone-cold'],
        ['in any case', 'IRON PLATE', 'iron-plate'],
        ['part of a word', 'uranium-23', 'uranium-235'],
        ['part of a word', 'uranium-23', 'uranium-238'],
        ['everything on an empty query', '', 'iron-plate'],
        ['everything on a blank query', '  ', 'iron-plate'],
    ])('matches %s: %j in %s', (_, query, id) => {
        expect(matchesQuery(query, id, label(id))).toBe(true);
    });

    it('needs every word', () => {
        expect(matchesQuery('iron gear', 'iron-plate', label('iron-plate'))).toBe(false);
    });
});

describe('searchIds', () => {
    // in the order of the data
    const ids = ['iron-gear-wheel', 'uranium-238', 'long-handed-inserter', 'iron-plate', 'stone-wall', 'uranium-235', 'teslagun'];

    it('puts the whole name or id first, then the name\'s start, the id\'s start, a later word, then the rest', () => {
        const tiers = names({
            'heavy-wall': 'Fortress', // a later word of the id only: "the rest"
            'wall-gate': 'Gate', // the id starts with the query
            'small-wall': 'Small wall', // a later word of the name
            'wall-lamp': 'Wall lamp', // the name starts with the query
            'stone-wall': 'Wall', // the whole name
        });
        const order = ['heavy-wall', 'wall-gate', 'small-wall', 'wall-lamp', 'stone-wall'];
        expect(searchIds('wall', order, (id) => itemName(tiers, id))).toEqual(['stone-wall', 'wall-lamp', 'wall-gate', 'small-wall', 'heavy-wall']);
    });

    it.each([
        ['lists an id-only match', 'teslagun', ['teslagun']],
        ['lists an id-only match', 'stone-wall', ['stone-wall']],
        ['keeps the input order within a tier', 'uranium', ['uranium-238', 'uranium-235']],
        ['keeps the input order within a tier', 'iron', ['iron-gear-wheel', 'iron-plate']],
        ['returns every id in its order on an empty query', '', ids],
        ['returns every id in its order on a blank query', '  ', ids],
        ['returns nothing when nothing matches', 'zzqq', []],
    ])('%s (%j)', (_, query, found) => {
        expect(searchIds(query, ids, label)).toEqual(found);
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

    it.each([
        ['keeps an id', 'iron-plate', 'iron-plate'],
        ['turns a name into its id', 'Iron plate', 'iron-plate'],
        ['turns a name in any case and spacing into its id', 'iron plate ', 'iron-plate'],
        ['turns an id in capitals into its id', 'IRON-PLATE', 'iron-plate'],
        ['turns a name into its id', 'Tesla gun', 'teslagun'],
        ['keeps an unknown entry as typed', 'foo', 'foo'],
        ['keeps an unknown entry as typed', 'constructor', 'constructor'],
        ['gives an empty string for empty input', '', ''],
        ['gives an empty string for blank input', '   ', ''],
    ])('%s (%j)', (_, typed, stored) => {
        expect(resolveTyped(typed, ids, label)).toBe(stored);
    });

    it('keeps a name two ids share as typed', () => {
        const twins = names({ 'wall-a': 'Wall', 'wall-b': 'Wall' });
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
    const few = names({ 'iron-plate': 'Iron plate' }, { 'iron-gear-wheel': 'Iron gear wheel' });

    it('says a known id in brackets as its name, and leaves other brackets alone', () => {
        expect(nameIdsInText(few, 'Machine 1 (iron-gear-wheel)')).toBe('Machine 1 (Iron gear wheel)');
        expect(nameIdsInText(few, 'Belt 1 (iron-plate) to Machine 2')).toBe('Belt 1 (Iron plate) to Machine 2');
        expect(nameIdsInText(few, 'Machine 1 (unknown-id) and (3 ticks)')).toBe('Machine 1 (unknown-id) and (3 ticks)');
        expect(nameIdsInText(few, 'no brackets')).toBe('no brackets');
        expect(nameIdsInText(NAMES, `Machine 1 (${WATER_BARREL}) takes ${WATER_BARREL}`)).toBe('Machine 1 (Fill Water barrel) takes Water barrel');
        expect(nameIdsInText(few, 'It needs iron-plate to make iron-gear-wheel, not unknown-id or inserter')).toBe('It needs Iron plate to make Iron gear wheel, not unknown-id or inserter');
    });
});

describe('hiddenRecipeIds', () => {
    it('lists the recipes the data marks hidden, in order', () => {
        expect(hiddenRecipeIds({ a: { hidden: true }, b: {}, c: { hidden: true }, d: { hidden: false } })).toEqual(['a', 'c']);
        expect(hiddenRecipeIds(undefined)).toEqual([]);
    });
});
