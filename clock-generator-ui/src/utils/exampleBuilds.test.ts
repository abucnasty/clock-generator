import { describe, expect, it } from 'vitest';
import { exampleSummary, exampleTitle, readExampleManifest, type ExampleBuild } from './exampleBuilds';

const logistic: ExampleBuild = { id: 'logistic-science', file: 'logistic-science.json', recipe: 'logistic-science-pack',
    items_per_second: 240, copies: 11, machines: 1, inserters: 3, belts: 1, chests: 0 };
/** A second example, `logistic` under another id with these Copies */
const chemical = (copies: number): ExampleBuild => ({ ...logistic, id: 'chemical-science', copies });
const { chests: _chests, ...missingChests } = logistic;
void _chests;

describe('readExampleManifest', () => {
    it.each([
        { why: 'a good list', examples: [logistic] },
        ...[5.5, 2.25, 0.5, 0.001, 0.0625].map(copies => ({ why: `a list with supported Copies ${copies}`, examples: [logistic, chemical(copies)] })),
    ])('keeps every example of $why', ({ examples }) => {
        expect(readExampleManifest(JSON.stringify(examples))).toEqual(examples);
    });

    it.each([
        { why: 'an empty list', text: '[]' },
        { why: 'the HTML page the dev server answers', text: '<!doctype html><html><body></body></html>' },
        { why: 'broken JSON', text: '[{"id": ' },
        { why: 'an object instead of a list', text: JSON.stringify({ examples: [logistic] }) },
        { why: 'a list with a row missing a field', text: JSON.stringify([logistic, missingChests]) },
        { why: 'a rate of 0', text: JSON.stringify([{ ...logistic, items_per_second: 0 }]) },
        ...[0, 0.0001, 1 / 3, -1].map(copies => ({ why: `unsupported Copies ${copies}`, text: JSON.stringify([{ ...logistic, copies }]) })),
        { why: 'Copies 5.5 but 1.5 machines', text: JSON.stringify([{ ...logistic, copies: 5.5, machines: 1.5 }]) },
    ])('reads $why as no examples', ({ text }) => {
        expect(readExampleManifest(text)).toEqual([]);
    });
});

describe('exampleTitle', () => {
    it.each([
        { why: "the game's name of the recipe", name: (id: string) => (id === 'logistic-science-pack' ? 'Logistic science pack (named)' : id), title: 'Logistic science pack (named)' },
        { why: 'the recipe in sentence case if unnamed', name: (id: string) => id, title: 'Logistic science pack' },
    ])('is $why', ({ name, title }) => {
        expect(exampleTitle(logistic, name)).toBe(title);
    });
});

describe('exampleSummary', () => {
    it.each([
        { why: '11 copies, 1 machine and 3 inserters', example: logistic, summary: '240/s · 11 copies · 1 machine, 3 inserters' },
        { why: '1 copy, 4 machines and 1 inserter', example: { ...logistic, items_per_second: 22.5, copies: 1, machines: 4, inserters: 1 },
            summary: '22.5/s · 1 copy · 4 machines, 1 inserter' },
    ])('gives the rate, the copies and what the build holds, in the singular or plural, for $why', ({ example, summary }) => {
        expect(exampleSummary(example)).toBe(summary);
    });
});
