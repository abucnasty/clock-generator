import { describe, expect, it } from 'vitest';
import { DEFAULT_DISPLAY_PREFERENCES, DISPLAY_PREFERENCES_KEY, readDisplayPreferences, writeDisplayPreferences } from './displayPreferences';

describe('browser display preferences', () => {
    const read = (value: string | null) => readDisplayPreferences({ getItem: () => value });

    it('starts explanatory/system and rejects malformed or unsupported saved versions', () => {
        expect(read(null)).toEqual(DEFAULT_DISPLAY_PREFERENCES);
        expect(read('{')).toEqual(DEFAULT_DISPLAY_PREFERENCES);
        expect(read('{"version":2,"density":"compact","scheme":"dark"}')).toEqual(DEFAULT_DISPLAY_PREFERENCES);
        expect(read('{"version":1,"density":"unknown","scheme":"dark"}')).toEqual({ version: 1, density: 'explanatory', scheme: 'dark' });
        expect(read('{"version":1,"density":"compact","scheme":"unknown"}')).toEqual({ version: 1, density: 'compact', scheme: 'system' });
    });

    it('round trips the browser preference independently of build data and preserves the stored scheme', () => {
        const values = new Map<string, string>();
        const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
        writeDisplayPreferences(storage, { version: 1, density: 'compact', scheme: 'dark' });
        expect([...values.keys()]).toEqual([DISPLAY_PREFERENCES_KEY]);
        expect(readDisplayPreferences(storage)).toEqual({ version: 1, density: 'compact', scheme: 'dark' });
    });

    it('keeps defaults and usable in-memory callers when browser storage is denied', () => {
        expect(readDisplayPreferences({ getItem: () => { throw new Error('denied'); } })).toEqual(DEFAULT_DISPLAY_PREFERENCES);
        expect(() => writeDisplayPreferences({ setItem: () => { throw new Error('denied'); } }, { version: 1, density: 'compact', scheme: 'light' })).not.toThrow();
    });
});
