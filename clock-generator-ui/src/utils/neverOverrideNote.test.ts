import { describe, expect, it } from 'vitest';
import { neverOverrideNoteOf, neverOverrideNoteOfConfig, neverOverrideNoteOfText, withNeverOverrideNote } from './neverOverrideNote';

const never = { overrides: { enable_control: { mode: 'NEVER' } } };

describe('neverOverrideNoteOf', () => {
    it.each<[string, Parameters<typeof neverOverrideNoteOf>[0], string | null]>([
        ['says nothing when no entity had the override', [], null],
        ['names one inserter', [{ type: 'inserter', id: 3 }], 'Never on is no longer an option: inserter 3 now uses Auto.'],
        ['names one mining drill', [{ type: 'drill', id: 1 }], 'Never on is no longer an option: mining drill 1 now uses Auto.'],
        ['lists several inserters', [{ type: 'inserter', id: 2 }, { type: 'inserter', id: 5 }, { type: 'inserter', id: 9 }],
            'Never on is no longer an option: inserters 2, 5 and 9 now use Auto.'],
        ['lists inserters and then mining drills', [{ type: 'drill', id: 1 }, { type: 'drill', id: 2 }, { type: 'inserter', id: 2 }, { type: 'inserter', id: 5 }],
            'Never on is no longer an option: inserters 2 and 5, and mining drills 1 and 2 now use Auto.'],
    ])('%s', (_, entities, text) => {
        expect(neverOverrideNoteOf(entities)).toBe(text);
    });
});

describe('neverOverrideNoteOfConfig and neverOverrideNoteOfText', () => {
    const config = { inserters: [{ id: 4, ...never }, { id: 5 }], drills: { configs: [{ id: 2, ...never }] } };

    it('name the entities of a config that is not yet checked', () => {
        const note = 'Never on is no longer an option: inserter 4, and mining drill 2 now use Auto.';
        expect(neverOverrideNoteOfConfig(config)).toBe(note);
        expect(neverOverrideNoteOfText(JSON.stringify(config))).toBe(note);
    });

    it('say nothing for a config without the override, and for text that is not JSON', () => {
        expect(neverOverrideNoteOfConfig({ inserters: [{ id: 1, overrides: { enable_control: { mode: 'ALWAYS' } } }] })).toBeNull();
        expect(neverOverrideNoteOfText('{ not json')).toBeNull();
    });
});

describe('withNeverOverrideNote', () => {
    it('puts the note after a message, when there is one', () => {
        expect(withNeverOverrideNote('Configuration file opened.', 'A note.')).toBe('Configuration file opened. A note.');
        expect(withNeverOverrideNote('Configuration file opened.', null)).toBe('Configuration file opened.');
    });
});
