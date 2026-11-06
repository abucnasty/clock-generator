// The labels the user topics (docs/user/) name in bold are labels the user sees: each must be a string of the site
// (clock-generator-ui/src, its tests left out), of the sidecar's locale (clock-generator-sidecar/locale/), or a label of
// Factorio itself in docs/game-labels.tsv, which CI cannot check against the game (`npm run docs:game-labels` does,
// where the game is installed). A label is found when a string holds it as whole words, case and all; a label the site
// builds at run time ("Copy blueprint (192/s, below target)") is found when a template string gives it: its fixed parts
// in place, and each value a number or a whole label of the site ("Copy blueprint").
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../..');
const USER_DOCS = path.join(ROOT, 'docs/user');
const UI_SOURCE = path.join(ROOT, 'clock-generator-ui/src');
const SIDECAR_LOCALE = path.join(ROOT, 'clock-generator-sidecar/locale');
const GAME_LABELS = path.join(ROOT, 'docs/game-labels.tsv');

/** In a text with values filled in at run time, where a value goes */
const VALUE = Symbol('value');
type Part = string | typeof VALUE;

function filesUnder(dir: string, keep: (file: string) => boolean): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const file = path.join(dir, entry.name);
        return entry.isDirectory() ? filesUnder(file, keep) : keep(file) ? [file] : [];
    });
}

const relative = (file: string) => path.relative(ROOT, file);

/** Each bold label of the user topics, with where it is; code blocks and code spans left out */
function boldLabels(): { label: string; at: string }[] {
    return filesUnder(USER_DOCS, file => file.endsWith('.md')).flatMap(file => {
        let fenced = false;
        return fs.readFileSync(file, 'utf8').split('\n').flatMap((line, index) => {
            if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
            if (fenced) return [];
            return [...line.replace(/`[^`]*`/g, '').matchAll(/\*\*([^*]+?)\*\*/g)]
                .map(match => ({ label: match[1], at: `${relative(file)}:${index + 1}` }));
        });
    });
}

/** The strings of the site's source: string literals, template strings and the text of its JSX elements */
function siteTexts(): Part[][] {
    const texts: Part[][] = [];
    const isTest = (file: string) => /\.test\.tsx?$/.test(file) || file.split(path.sep).includes('__tests__');
    for (const file of filesUnder(UI_SOURCE, file => /\.tsx?$/.test(file) && !file.endsWith('.d.ts') && !isTest(file))) {
        const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, false,
            file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
        const visit = (node: ts.Node): void => {
            if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isJsxText(node)) {
                texts.push([node.text]);
            } else if (ts.isTemplateExpression(node)) {
                texts.push([node.head.text, ...node.templateSpans.flatMap(span => [VALUE, span.literal.text] as Part[])]);
            } else if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
                // the element's text with each expression or element in it as a value: "Import {count} builds"
                const parts = node.children.map(child => (ts.isJsxText(child) ? child.text : VALUE));
                if (parts.some(part => part !== VALUE) && parts.some(part => part === VALUE)) texts.push(parts);
            }
            ts.forEachChild(node, visit);
        };
        visit(source);
    }
    return texts;
}

/** The strings of the sidecar's locale, each parameter (__1__, a plural, a control) a value */
function localeTexts(): Part[][] {
    const parameter = /__plural_for_parameter__\d+__\{[^}]*\}__|__[A-Z_]+__[^_\s]+__|__\d+__/g;
    return filesUnder(SIDECAR_LOCALE, file => file.endsWith('.cfg')).flatMap(file =>
        fs.readFileSync(file, 'utf8').split('\n')
            .filter(line => /^[^[;#\s][^=]*=/.test(line))
            .map(line => {
                const value = line.slice(line.indexOf('=') + 1).trim();
                const fixed = value.split(parameter);
                return fixed.flatMap((part, index) => (index === 0 ? [part] : [VALUE, part])) as Part[];
            }));
}

/** The rows of docs/game-labels.tsv: label, locale key, the game's string; # comments and the header left out */
function gameLabels(): string[][] {
    return fs.readFileSync(GAME_LABELS, 'utf8').split('\n')
        .filter(line => line.trim() !== '' && !line.startsWith('#'))
        .slice(1)
        .map(line => line.split('\t'));
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const spaced = (text: string) => text.replace(/\s+/g, ' ');

/** A value the site fills in at run time: a number ("192", "12.5", "3%") */
const isNumber = (value: string) => /^[-+]?\d[\d.,]*%?$/.test(value);

/**
 * Whether a text gives the label: as whole words in one of its fixed parts, or as the whole text with its values filled
 * in, each value a number or a whole label of `labels` (a text that starts with a capital: "Copy blueprint")
 */
function gives(text: Part[], label: string, labels: Set<string>): boolean {
    const words = new RegExp(`(?<!\\w)${escape(label)}(?!\\w)`);
    if (text.some(part => part !== VALUE && words.test(spaced(part)))) return true;
    if (!text.includes(VALUE)) return false;
    const pattern = text.map(part => (part === VALUE ? '(.+?)' : escape(spaced(part)))).join('');
    const values = new RegExp(`^${pattern}$`).exec(label)?.slice(1);
    return values !== undefined && values.every(value => isNumber(value) || (/^[A-Z]/.test(value) && labels.has(value)));
}

/** The texts without values, as whole labels */
const wholeLabels = (texts: Part[][]) => new Set(texts.filter(text => !text.includes(VALUE)).map(text => spaced(String(text[0])).trim()));

describe('bold labels of the user topics', () => {
    const labels = boldLabels();
    const game = new Set(gameLabels().map(([label]) => label));
    const texts = [...siteTexts(), ...localeTexts()];
    const whole = wholeLabels(texts);

    it('finds labels to check', () => {
        expect(labels.length).toBeGreaterThan(0);
    });

    it('are strings of the site, of the sidecar or of the game', () => {
        const missing = labels.filter(({ label }) => !game.has(label) && !texts.some(text => gives(text, label, whole)));
        expect(missing.map(({ label, at }) => `**${label}** (${at}) is not a string of clock-generator-ui/src or `
            + 'clock-generator-sidecar/locale/: correct the topic, or add a label of Factorio to docs/game-labels.tsv')).toEqual([]);
    });

    it('docs/game-labels.tsv has a label, a locale key and a game string in each row, each label once', () => {
        const rows = gameLabels();
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.filter(row => row.length !== 3 || row.some(cell => cell.trim() === '') || !/^[\w-]+\.[\w-]+$/.test(row[1])))
            .toEqual([]);
        expect(rows.map(([label]) => label).filter((label, index, all) => all.indexOf(label) !== index)).toEqual([]);
    });
});

describe('a label the site builds at run time', () => {
    const template: Part[] = ['', VALUE, ' (', VALUE, '/s, below target)'];
    const labels = new Set(['Copy blueprint', 'selected']);

    it('is found by the fixed parts of its template, each value a number or a label', () => {
        expect(gives(template, 'Copy blueprint (192/s, below target)', labels)).toBe(true);
        expect(gives(['Import ', VALUE, ' builds'], 'Import 3 builds', labels)).toBe(true);
    });

    it('is not found when a fixed part differs or a value is any other word', () => {
        expect(gives(template, 'Copy blueprint (192/s, above target)', labels)).toBe(false);
        expect(gives(template, 'Copy the blueprint (192/s, below target)', labels)).toBe(false);
        expect(gives(['Import ', VALUE], 'Import selected', labels)).toBe(false);
    });
});
