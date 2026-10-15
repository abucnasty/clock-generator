import { describe, expect, it } from 'vitest';
import { exampleSummary, exampleTitle, readExampleManifest, type ExampleBuild } from './exampleBuilds';

const logistic: ExampleBuild = {
    id: 'logistic-science',
    file: 'logistic-science.json',
    recipe: 'logistic-science-pack',
    items_per_second: 240,
    copies: 11,
    machines: 1,
    inserters: 3,
    belts: 1,
    chests: 0,
};

describe('readExampleManifest', () => {
    it('reads a good list', () => {
        expect(readExampleManifest(JSON.stringify([logistic]))).toEqual([logistic]);
    });

    it('reads the page HTML the dev server answers with, and broken JSON, as no examples', () => {
        expect(readExampleManifest('<!doctype html><html><body></body></html>')).toEqual([]);
        expect(readExampleManifest('[{"id": ')).toEqual([]);
    });

    it('reads a list with a row missing a field, or a bad value, as no examples', () => {
        const { chests: _chests, ...missing } = logistic;
        void _chests;
        expect(readExampleManifest(JSON.stringify([logistic, missing]))).toEqual([]);
        expect(readExampleManifest(JSON.stringify([{ ...logistic, items_per_second: 0 }]))).toEqual([]);
        expect(readExampleManifest(JSON.stringify([{ ...logistic, copies: 0 }]))).toEqual([]);
        expect(readExampleManifest(JSON.stringify({ examples: [logistic] }))).toEqual([]);
    });

    it('reads an empty list as no examples', () => {
        expect(readExampleManifest('[]')).toEqual([]);
    });
});

describe('exampleTitle', () => {
    it("is the game's name of the recipe", () => {
        expect(exampleTitle(logistic, (id) => (id === 'logistic-science-pack' ? 'Logistic science pack (named)' : id))).toBe('Logistic science pack (named)');
    });

    it('is the recipe in sentence case when the game data has no name for it', () => {
        expect(exampleTitle(logistic, (id) => id)).toBe('Logistic science pack');
    });
});

describe('exampleSummary', () => {
    it('gives the rate, the copies and what the build holds', () => {
        expect(exampleSummary(logistic)).toBe('240/s · 11 copies · 1 machine, 3 inserters');
    });

    it('says copy, machines and inserter in the singular and plural as needed', () => {
        expect(exampleSummary({ ...logistic, items_per_second: 22.5, copies: 1, machines: 4, inserters: 1 })).toBe('22.5/s · 1 copy · 4 machines, 1 inserter');
    });
});
