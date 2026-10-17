import { describe, expect, it } from 'vitest';
import { DEFAULT_DISPLAY_PREFERENCES, DISPLAY_PREFERENCES_KEY, readDisplayPreferences, writeDisplayPreferences } from './displayPreferences';

describe('browser display preferences', () => {
    const read = (value: string | null) => readDisplayPreferences({ getItem: () => value });

    it('starts dark and ignores retired density settings while preserving saved themes', () => {
        expect(DEFAULT_DISPLAY_PREFERENCES.scheme).toBe('dark');
        expect(read(null)).toEqual(DEFAULT_DISPLAY_PREFERENCES);
        expect(read('{')).toEqual(DEFAULT_DISPLAY_PREFERENCES);
        expect(read('{"version":2,"density":"compact","scheme":"dark"}')).toEqual(DEFAULT_DISPLAY_PREFERENCES);
        expect(read('{"version":1,"density":"explanatory","scheme":"dark"}')).toEqual({ version: 1, scheme: 'dark' });
        expect(read('{"version":1,"density":"compact","scheme":"light"}')).toEqual({ version: 1, scheme: 'light' });
        expect(read('{"version":1,"scheme":"system"}')).toEqual({ version: 1, scheme: 'system' });
        expect(read('{"version":1,"density":"compact","scheme":"unknown"}')).toEqual(DEFAULT_DISPLAY_PREFERENCES);
    });

    it('round trips the browser preference independently of build data and preserves the stored scheme', () => {
        const values = new Map<string, string>();
        const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
        values.set(DISPLAY_PREFERENCES_KEY, '{"version":1,"density":"explanatory","scheme":"dark"}');
        writeDisplayPreferences(storage, readDisplayPreferences(storage));
        expect([...values.keys()]).toEqual([DISPLAY_PREFERENCES_KEY]);
        expect(readDisplayPreferences(storage)).toEqual({ version: 1, scheme: 'dark' });
        expect(JSON.parse(values.get(DISPLAY_PREFERENCES_KEY)!)).toEqual({ version: 1, scheme: 'dark' });
    });

    it('keeps defaults and usable in-memory callers when browser storage is denied', () => {
        expect(readDisplayPreferences({ getItem: () => { throw new Error('denied'); } })).toEqual(DEFAULT_DISPLAY_PREFERENCES);
        expect(() => writeDisplayPreferences({ setItem: () => { throw new Error('denied'); } }, { version: 1, scheme: 'light' })).not.toThrow();
    });
});
