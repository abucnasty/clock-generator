import { describe, expect, it } from 'vitest';
import { GLOSSARY, PROVISIONAL_WAKE_UP_DEFINITION, TERMS_FOCUS, glossaryWithFocus, type GlossaryId } from './glossary';

import { WAKE_UP_DEFINITION, TERMS } from './wakeWindowCopy';
import comparisonSource from '../components/ClockAlternativesPanel.tsx?raw';

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

    it('keeps the three wake-up help surfaces tied to the provisional glossary definition', () => {
        const entry = GLOSSARY.find(item => item.id === 'wake-up');
        expect(entry).toMatchObject({ definition: PROVISIONAL_WAKE_UP_DEFINITION, provisional: true });
        expect(WAKE_UP_DEFINITION).toBe(PROVISIONAL_WAKE_UP_DEFINITION);
        expect(TERMS.find(item => item.term === 'Wake-up')?.definition).toBe(PROVISIONAL_WAKE_UP_DEFINITION);
        // The table keeps its own scope qualifiers, but must compose its factual account from the same source.
        expect(comparisonSource).toMatch(/import\s*\{[^}]*\bPROVISIONAL_WAKE_UP_DEFINITION\b[^}]*\}\s*from ['"]\.\.\/utils\/glossary['"]/);
        expect(comparisonSource).toMatch(/wakeUpsHelp:\s*PROVISIONAL_WAKE_UP_DEFINITION\s*\+/);
        expect(PROVISIONAL_WAKE_UP_DEFINITION).toMatch(/started a craft \(inputs\)/);
        expect(PROVISIONAL_WAKE_UP_DEFINITION).toMatch(/finished a craft or paid out productivity \(outputs\)/);
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
