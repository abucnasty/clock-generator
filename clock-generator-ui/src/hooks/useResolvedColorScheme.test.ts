import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DisplayScheme } from '../utils/displayPreferences';
import { resolveColorScheme, useResolvedColorScheme } from './useResolvedColorScheme';

// A focused hook lifecycle runner follows the existing Node-only hook tests.
const lifecycle = vi.hoisted(() => {
    let values: unknown[] = [], cursor = 0;
    let effect: (() => (() => void) | void) | undefined, cleanup: (() => void) | undefined;
    let mounted = false;
    const preferences = { scheme: 'system' as DisplayScheme };
    return {
        preferences,
        begin() { cursor = 0; },
        commit() { if (!mounted) { cleanup = effect?.() || undefined; mounted = true; } },
        reset() { cleanup?.(); values = []; cursor = 0; mounted = false; effect = cleanup = undefined; preferences.scheme = 'system'; },
        react: {
            useState(initial: unknown) {
                const index = cursor++;
                if (!(index in values)) values[index] = typeof initial === 'function' ? initial() : initial;
                return [values[index], (value: unknown) => { values[index] = value; }];
            },
            useEffect(value: () => (() => void) | void) { effect = value; },
        },
    };
});
vi.mock('react', () => lifecycle.react);
vi.mock('./useDisplayPreferences', () => ({ useDisplayPreferences: () => lifecycle.preferences }));
afterEach(() => { lifecycle.reset(); vi.unstubAllGlobals(); });
const Render = () => { lifecycle.begin(); const mode = useResolvedColorScheme(); lifecycle.commit(); return mode; };

describe('resolved display scheme', () => {
    it('follows the device only for System', () => {
        expect(resolveColorScheme('system', false)).toBe('light');
        expect(resolveColorScheme('system', true)).toBe('dark');
        expect(resolveColorScheme('light', true)).toBe('light');
        expect(resolveColorScheme('dark', false)).toBe('dark');
    });
    it('uses one live listener across scheme changes and cleans it up', () => {
        let listener: (() => void) | undefined;
        const addEventListener = vi.fn((_: string, callback: () => void) => { listener = callback; });
        const removeEventListener = vi.fn();
        const media = { matches: false, addEventListener, removeEventListener };
        const matchMedia = vi.fn(() => media);
        vi.stubGlobal('window', { matchMedia });
        expect(Render()).toBe('light');
        media.matches = true; listener?.(); expect(Render()).toBe('dark');
        lifecycle.preferences.scheme = 'light'; expect(Render()).toBe('light');
        media.matches = false; listener?.(); expect(Render()).toBe('light');
        lifecycle.preferences.scheme = 'dark'; expect(Render()).toBe('dark');
        lifecycle.preferences.scheme = 'system'; expect(Render()).toBe('light');
        expect(matchMedia).toHaveBeenCalledExactlyOnceWith('(prefers-color-scheme: dark)');
        expect(addEventListener).toHaveBeenCalledOnce();
        const registered = listener;
        lifecycle.reset();
        expect(removeEventListener).toHaveBeenCalledExactlyOnceWith('change', registered);
    });
    it('keeps System usable when media access is unavailable', () => {
        vi.stubGlobal('window', { matchMedia() { throw new Error('denied'); } });
        expect(Render()).toBe('light');
        lifecycle.preferences.scheme = 'dark'; expect(Render()).toBe('dark');
    });
});
