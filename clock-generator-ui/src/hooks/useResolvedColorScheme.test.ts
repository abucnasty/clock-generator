// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DisplayScheme } from '../utils/displayPreferences';
import { resolveColorScheme, useResolvedColorScheme } from './useResolvedColorScheme';

const preferences = vi.hoisted(() => ({ scheme: 'system' as DisplayScheme }));
vi.mock('./useDisplayPreferences', () => ({ useDisplayPreferences: () => preferences }));
afterEach(() => { preferences.scheme = 'system'; vi.restoreAllMocks(); });

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
        const media = { matches: false, addEventListener, removeEventListener } as unknown as MediaQueryList;
        const matchMedia = vi.spyOn(window, 'matchMedia').mockReturnValue(media);
        const { result, rerender, unmount } = renderHook(() => useResolvedColorScheme());
        const change = (matches: boolean) => act(() => { (media as { matches: boolean }).matches = matches; listener?.(); });
        const scheme = (next: DisplayScheme) => { preferences.scheme = next; rerender(); };
        expect(result.current).toBe('light');
        change(true); expect(result.current).toBe('dark');
        scheme('light'); expect(result.current).toBe('light');
        change(false); expect(result.current).toBe('light');
        scheme('dark'); expect(result.current).toBe('dark');
        scheme('system'); expect(result.current).toBe('light');
        expect(matchMedia).toHaveBeenCalledExactlyOnceWith('(prefers-color-scheme: dark)');
        expect(addEventListener).toHaveBeenCalledOnce();
        const registered = listener;
        unmount();
        expect(removeEventListener).toHaveBeenCalledExactlyOnceWith('change', registered);
    });
    it('keeps System usable when media access is unavailable', () => {
        vi.spyOn(window, 'matchMedia').mockImplementation(() => { throw new Error('denied'); });
        const { result, rerender } = renderHook(() => useResolvedColorScheme());
        expect(result.current).toBe('light');
        preferences.scheme = 'dark'; rerender(); expect(result.current).toBe('dark');
    });
});
