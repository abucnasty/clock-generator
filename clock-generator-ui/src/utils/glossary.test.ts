import { describe, expect, it } from 'vitest';
import { GLOSSARY, TERMS_FOCUS, glossaryWithFocus, type GlossaryId } from './glossary';

const IDS: GlossaryId[] = [
    'swing', 'swing-plan', 'crafting-cycle', 'clock-period', 'wake-window', 'wake-up', 'start-point', 'copies', 'build',
    'clock', 'blueprint', 'check', 'enable-rule', 'assembling-machine', 'holds-the-rate', 'starved', 'jammed', 'recovers',
    'belt-slack', 'simulator', 'hand', 'lcm',
];

describe('GLOSSARY', () => {
    it('has each id once, and exactly the approved terms', () => {
        const ids = GLOSSARY.map(entry => entry.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect([...ids].sort()).toEqual([...IDS].sort());
    });

    it('gives every entry a term and a non-empty sentence of definition', () => {
        for (const entry of GLOSSARY) {
            expect(entry.term.trim()).not.toBe('');
            expect(entry.definition.trim()).toMatch(/\.$/);
        }
    });

    it('keeps "jammed" and "starved" as two entries, not one "jam"', () => {
        const terms = GLOSSARY.map(entry => entry.term);
        expect(terms).toContain('jammed');
        expect(terms).toContain('starved');
        expect(terms.some(term => /^jam$/i.test(term))).toBe(false);
    });

    it('marks "wake-up" provisional, and only it', () => {
        expect(GLOSSARY.filter(entry => entry.provisional).map(entry => entry.id)).toEqual(['wake-up']);
    });

    it('lists the expert LCM last', () => {
        expect(GLOSSARY.at(-1)?.id).toBe('lcm');
        expect(GLOSSARY.at(-1)?.expert).toBe(true);
        expect(GLOSSARY.filter(entry => entry.expert)).toHaveLength(1);
    });

    it('defines no term with a word the owner replaced', () => {
        for (const entry of GLOSSARY) {
            expect(entry.definition).not.toMatch(/Assembler|potential clock|transfer|backpressure/i);
            if (entry.id !== 'lcm') {
                expect(entry.definition).not.toMatch(/\bLCM\b/);
            }
        }
    });
});

describe('glossaryWithFocus', () => {
    it('puts the focus terms first, in their order, and every other term after them once', () => {
        const { related, rest } = glossaryWithFocus(['wake-window', 'wake-up']);
        expect(related.map(entry => entry.id)).toEqual(['wake-window', 'wake-up']);
        expect(rest.map(entry => entry.id)).not.toContain('wake-up');
        expect(related.length + rest.length).toBe(GLOSSARY.length);
    });

    it('lists the whole glossary with no focus', () => {
        const { related, rest } = glossaryWithFocus([]);
        expect(related).toEqual([]);
        expect(rest).toEqual(GLOSSARY);
    });

    it('knows every term the clock table focuses on', () => {
        const ids = new Set(GLOSSARY.map(entry => entry.id));
        for (const focus of Object.values(TERMS_FOCUS)) {
            for (const id of focus) {
                expect(ids.has(id)).toBe(true);
            }
        }
    });
});
