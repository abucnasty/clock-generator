// The Avoid-word check (scripts/docs/avoid-words.js), which CI runs on the Markdown lines a pull request adds: it reads
// the words of the glossary's Avoid lines, and finds the ones a line uses, leaving out the words a line only mentions.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../..');
const { avoidWords, allowList, avoidedIn, proseLines } = createRequire(__filename)('../../scripts/docs/avoid-words.js');

const GLOSSARY = `**Enable window**:
A part of the window cycle.
_Avoid_: wake window, window (bare), enable range

**Build**:
A group of entities.
_Avoid_: module (the game's module items), setup, plant
(the game's chemical plant), "the pick"
`;
const words = avoidWords(GLOSSARY);
const allowed = allowList('word\tphrase\treason\nsetup\tsetup of the game\tthe game folder\nenable range\t\tnever checked\n');
const found = (line: string) => avoidedIn(line, words, allowed).map(({ word }: { word: string }) => word);

describe('Avoid words of the glossary', () => {
    it('reads each word with its term, a wrapped Avoid line included', () => {
        expect(words).toEqual([
            { word: 'wake window', qualified: false, term: 'Enable window' },
            { word: 'window', qualified: true, term: 'Enable window' },
            { word: 'enable range', qualified: false, term: 'Enable window' },
            { word: 'module', qualified: true, term: 'Build' },
            { word: 'setup', qualified: false, term: 'Build' },
            { word: 'plant', qualified: true, term: 'Build' },
            { word: 'the pick', qualified: false, term: 'Build' },
        ]);
    });

    it('finds a word a line uses, as a whole word and in any case', () => {
        expect(found('The Wake window opens.')).toEqual(['wake window']);
        expect(found('Take the pick.')).toEqual(['the pick']);
        expect(found('A wake-window-like gap.')).toEqual([]);
    });

    it('leaves out the words with a qualifier, which need a reader', () => {
        expect(found('One window, one module, one chemical plant.')).toEqual([]);
    });

    it('leaves out mentions: code, bold labels, italics, quotes and link targets', () => {
        expect(found('`wake window`, **Wake window**, *wake window*, _wake window_, "wake window", [x](wake-window.md#wake window)')).toEqual([]);
    });

    it('leaves out the allowed phrases and the words never checked', () => {
        expect(found('The setup of the game is done.')).toEqual([]);
        expect(found('The setup is done.')).toEqual(['setup']);
        expect(found('An enable range.')).toEqual([]);
    });

    it('reads the lines outside code blocks only', () => {
        expect(proseLines('a\n```\nb\n```\nc')).toEqual([[1, 'a'], [5, 'c']]);
    });

    it('reads every Avoid line of the published glossary, and every word of the allow list is an Avoid word', () => {
        const published = avoidWords(fs.readFileSync(path.join(ROOT, 'docs/maintainer/glossary.md'), 'utf8'));
        expect(published.length).toBeGreaterThan(50);
        const avoid = new Set(published.map(({ word }: { word: string }) => word.toLowerCase()));
        const listed = [...allowList(fs.readFileSync(path.join(ROOT, 'docs/avoid-words-allow.tsv'), 'utf8')).keys()];
        expect(listed.filter(word => !avoid.has(word))).toEqual([]);
    });
});
