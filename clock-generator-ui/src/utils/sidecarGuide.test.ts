import { describe, expect, it } from 'vitest';
import { invalidExportPrompt, openFileProblem, PASTE_PROMPTS, SIDECAR_COPY_STEPS, SIDECAR_MOD_URL } from './sidecarGuide';

describe('the words of the way in', () => {
    it('links the mod on the portal', () => {
        expect(SIDECAR_MOD_URL).toBe('https://mods.factorio.com/mod/clock-generator-sidecar');
    });

    it('gives the four copy steps of the mod', () => {
        const steps = SIDECAR_COPY_STEPS.join(' ');
        for (const word of ['Alt+E', 'Copy JSON', 'Ctrl+C', 'one unit', 'set Copies']) {
            expect(steps).toContain(word);
        }
    });

    it('says why a paste could not be used in plain words, without the checker or wake-up words', () => {
        for (const prompt of Object.values(PASTE_PROMPTS)) {
            expect(prompt.text).not.toMatch(/validat|wake-up|config/i);
        }
        expect(PASTE_PROMPTS['build-file'].text).toContain('Open build file…');
    });

    it('names the entity of an invalid export, counted from 1, without the schema\'s words', () => {
        expect(invalidExportPrompt('Invalid machine at index 0: Invalid input: expected string, received undefined')).toEqual({
            severity: 'error',
            text: 'The export has a problem with machine 1. Copy it again from Factorio. If it keeps happening, update the Sidecar mod.',
        });
        expect(invalidExportPrompt('Invalid inserter at index 4: Required').text).toMatch(/^The export has a problem with inserter 5\. /);
        expect(invalidExportPrompt('Something odd happened').text).toMatch(/^The export has a problem\. Copy it again/);
        expect(invalidExportPrompt('Something odd happened').text).not.toContain('odd');
    });
});

describe('openFileProblem', () => {
    it('never shows the parser text of a file that is not JSON', () => {
        let syntaxError: unknown;
        try {
            JSON.parse('{ not json');
        } catch (error) {
            syntaxError = error;
        }
        expect(openFileProblem(syntaxError)).toBe('Could not open that file: it is not a build file (it does not hold JSON).');
    });

    it('gives the reason of another error as a sentence', () => {
        expect(openFileProblem(new Error("Configuration validation failed at 'machines': Required"))).toBe(
            "Could not open that file: Configuration validation failed at 'machines': Required.",
        );
        expect(openFileProblem('odd')).toBe('Could not open that file: it is not a build file this site can read.');
    });
});
