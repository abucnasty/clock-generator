import { describe, expect, it } from 'vitest';
import { NOTE_CODES, type ImportProblem, type ImportQuestion, type ImportSpeed } from 'clock-generator/browser';
import {
    BLUEPRINT_COPY_STEPS, BLUEPRINT_FAILED_PROMPT, BLUEPRINT_PROMPTS, entityName, isJsonText, noteText, notReadText, numbersUsedText, productivityText, questionText,
    readText, SHARING_ANSWER_TEXT, speedText,
} from './blueprintPaste';
import { TEMPLATES } from './researchProfiles';

const name = (id: string) => ({ beacon: 'Beacon', 'constant-combinator': 'Constant combinator' } as Record<string, string>)[id] ?? id;

describe('the blueprint paste\'s words', () => {
    it('tells JSON from a blueprint by the first character that is not a space', () => {
        expect(['{"machines": []}', '  [1]', '\n{'].map(isJsonText)).toEqual([true, true, true]);
        expect(['0eNq', ' 0eNq', 'just words', ''].map(isJsonText)).toEqual([false, false, false, false]);
    });

    it('has a prompt for each problem, the book\'s saying to paste one blueprint of it', () => {
        const problems: ImportProblem[] = ['not-a-blueprint', 'book', 'planner', 'no-entities', 'game-version'];
        for (const problem of problems) expect(BLUEPRINT_PROMPTS[problem].text).not.toBe('');
        expect(BLUEPRINT_PROMPTS.book.text).toMatch(/copy one blueprint of it/);
        expect(BLUEPRINT_FAILED_PROMPT.text).not.toMatch(/Sidecar/);
    });

    it('has words for every code a note can have, with no code and no coordinates in them', () => {
        for (const code of NOTE_CODES) {
            const text = noteText({ code, value: 3 });
            expect(text, code).toMatch(/^[a-z].*\.$/);
            expect(text, code).not.toMatch(/undefined|:[a-z-]+:|\(-?\d+(\.\d+)?, -?\d+/);
            expect(text, code).not.toContain(code);
        }
        expect(noteText({ code: 'drop:side-loaded', value: 3 })).toMatch(/3 tile belt buffer/);
        expect(noteText({ code: 'unread:lane-end', lane: 2 })).toMatch(/end of its lane \(lane 2\)/);
    });

    it('asks each question by the label of its entity, never by a place', () => {
        const question = (kind: ImportQuestion['kind'], label: string, lane?: 1 | 2): ImportQuestion => ({ key: 'k', kind, subject: { label, entity_number: 9, ...(lane && { lane }) }, candidates: [] });
        expect(questionText(question('drill-ore', 'Drill 1'))).toBe('Drill 1 mines');
        expect(questionText(question('lane-item', 'Belt 2', 1))).toBe('Belt 2, lane 1 holds');
        expect(questionText(question('lane-sharing', 'Belt 2'))).toBe('Belt 2: do all copies use this belt?');
        expect(Object.keys(SHARING_ANSWER_TEXT)).toEqual(['shared', 'per_copy']);
    });

    it('asks how many items a second leave a lane, with the item\'s name, and "items" while the lane\'s item is asked', () => {
        const rate = (item: string | undefined): ImportQuestion => ({ key: 'lane-export:9:1', kind: 'lane-export', subject: { label: 'Belt 3', entity_number: 9, lane: 1, ...(item !== undefined && { item }) }, candidates: [] });
        expect(questionText(rate('electronic-circuit'), id => id.toUpperCase())).toBe('How many ELECTRONIC-CIRCUIT a second leave Belt 3, lane 1?');
        expect(questionText(rate(''), id => id.toUpperCase())).toBe('How many items a second leave Belt 3, lane 1?');
        expect(questionText(rate(undefined))).toBe('How many items a second leave Belt 3, lane 1?');
    });

    it('counts what was read and what was not, and names an entity by its row', () => {
        expect(readText([{ name: 'machine', count: 9 }, { name: 'inserter', count: 1 }, { name: 'beacon', count: 50 }])).toBe('Read: 9 machines, 1 inserter, 50 beacons.');
        expect(notReadText([{ name: 'constant-combinator', count: 14 }], name)).toBe('Not read: 14 × Constant combinator.');
        expect(notReadText([], name)).toBeNull();
        expect(entityName({ entity_number: 4, name: 'stack-inserter', row: { list: 'inserters', id: 7 } }, name)).toBe('Inserter 7');
        expect(entityName({ entity_number: 5, name: 'beacon' }, name)).toBe('Beacon');
        expect(entityName(undefined, name)).toBe('The build');
    });

    it('shows a speed with its beacons and modules, and a productivity as base, modules and research', () => {
        const row: ImportSpeed = { list: 'machines', id: 3, beacons: 8, modules: 4, productivity: { base: 50, modules: 0, research: 250, cap: 300 } };
        expect(speedText(199.75, row)).toBe('speed 199.75 (8 beacons, 4 modules)');
        expect(productivityText(300, row)).toBe('productivity 300 % = base 50 + modules 0 + research 250, at most 300');
        expect(productivityText(300, { ...row, productivity: { base: 50, modules: 0, research: 300, cap: 300 } })).toBe('productivity 300 % = base 50 + modules 0 + research 300, at most 300');
        expect(productivityText(10, { ...row, productivity: { base: 0, modules: 10, research: 0, cap: null } })).toBe('productivity 10 % = base 0 + modules 10 + research 0');
    });

    it('gives the numbers a profile uses as the hands and the lane they give', () => {
        expect(numbersUsedText({ mining_drill_productivity_bonus: 79990, inserter_stack_size_bonus: 3, bulk_inserter_capacity_bonus: 11, belt_stack_size_bonus: 3, recipes: {} }))
            .toBe('mining +79990 %, stack inserter 16, bulk inserter 12, inserter 4, belt stacks 4');
    });

    it('counts the 18 recipes of the All template in the numbers a profile uses', () => {
        expect(numbersUsedText(TEMPLATES[1].bonuses)).toBe('mining +20 %, stack inserter 16, bulk inserter 12, inserter 4, belt stacks 4, 18 recipes with research productivity');
    });

    it('copies a blueprint in two steps, with no Sidecar', () => {
        expect(BLUEPRINT_COPY_STEPS.join(' ')).not.toMatch(/Sidecar/);
        expect(BLUEPRINT_COPY_STEPS.join(' ')).toMatch(/Export to string/);
    });
});
