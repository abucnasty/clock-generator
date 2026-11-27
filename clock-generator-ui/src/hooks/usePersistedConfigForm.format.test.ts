// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { savedFormatProblem, serializeConfig, usePersistedConfigForm } from './usePersistedConfigForm';
import { createDefaultConfig } from '../utils/configForm/formData';
import { backupKey, buildKey, LIBRARY_KEY, REFUSED_BUILD_LABELS, refusedOpenNotice, refusedStartNotice } from '../utils/buildLibrary';

const { ask, notify, quiet } = vi.hoisted(() => ({ ask: vi.fn(), notify: vi.fn(), quiet: vi.fn() }));
vi.mock('../worker/engineClient', () => ({ askEngine: ask }));
vi.mock('./useMessages', () => ({ useNotify: () => notify, useDismissMessage: () => quiet, useAnnounce: () => quiet, useAnnounceMessage: () => quiet }));

const gears = { ...createDefaultConfig(), setpoint: { item: 'iron-gear-wheel', items_per_second: 1, copies: 1 } };
/** A build saved before the format had a number: the same form, without the key */
const oldText = JSON.stringify(gears);
/** A build saved so long ago that it has none of the parts the form state has now */
const ancientText = JSON.stringify({ target_output: { recipe: 'iron-gear-wheel', items_per_second: 1 } });
const index = (ids: string[]) => JSON.stringify({ version: 1, builds: ids.map((id, n) => ({ id, name: `Build ${id}`, recipe: '', createdAt: n, openedAt: n })) });
const tick = () => act(() => Promise.resolve());

/** The form the worker loads: without the format of its saved text */
const unmarked = (config: unknown) => { const { format: _format, ...form } = config as Record<string, unknown>; void _format; return form; };
beforeEach(() => {
    localStorage.clear(); sessionStorage.clear(); ask.mockReset(); notify.mockReset();
    ask.mockImplementation(async (query: { kind: string; config?: unknown }) => query.kind === 'saved-config' ? { problem: null, form: unmarked(query.config) } : null);
});

describe('savedFormatProblem', () => {
    it('reads the format before anything else, and leaves text that is no JSON object to the shape test', () => {
        expect(savedFormatProblem(serializeConfig(gears))).toBeNull();
        expect(savedFormatProblem(oldText)).toBe('old');
        expect(savedFormatProblem(ancientText)).toBe('old');
        expect(savedFormatProblem(JSON.stringify({ format: 2, ...gears }))).toBe('newer');
        expect(savedFormatProblem('not json')).toBeNull();
        expect(savedFormatProblem('[1]')).toBeNull();
    });

    it('is written first by the save', () => {
        expect(Object.keys(JSON.parse(serializeConfig(gears)))[0]).toBe('format');
    });
});

describe('a saved build made before this format', () => {
    it.each([['an old build', oldText], ['an old build without the parts the form has now', ancientText]])(
        'opening first, opens a new untitled build, keeps %s listed, and says so once', async (_name, text) => {
            localStorage.setItem(LIBRARY_KEY, index(['old']));
            localStorage.setItem(buildKey('old'), text);
            const { result } = renderHook(usePersistedConfigForm);
            await tick();
            const hook = result.current;
            expect(hook.library.currentId).not.toBe('old');
            expect(hook.config.setpoint.item).toBe('');
            expect(hook.loadNotice).toBe(refusedStartNotice('old'));
            expect(hook.library.builds.map(build => build.id)).toEqual(['old', hook.library.currentId]);
            expect(hook.library.refused.get('old')).toEqual({ problem: 'old', text });
            // not loaded, not overwritten, not backed up
            expect(localStorage.getItem(buildKey('old'))).toBe(text);
            expect(localStorage.getItem(backupKey('old'))).toBeNull();
            expect(ask).not.toHaveBeenCalled();
        });

    it('is not opened from the list: the notice says why, and the open build stays', async () => {
        localStorage.setItem(LIBRARY_KEY, index(['old', 'new']));
        localStorage.setItem(buildKey('old'), oldText);
        localStorage.setItem(buildKey('new'), serializeConfig(gears));
        const { result } = renderHook(usePersistedConfigForm);
        await tick();
        expect(result.current.library.currentId).toBe('new');
        expect(result.current.config.setpoint.item).toBe('iron-gear-wheel');
        let opened: boolean | undefined;
        await act(async () => { opened = await result.current.library.openBuild('old'); });
        expect(opened).toBe(false);
        expect(result.current.library.currentId).toBe('new');
        expect(result.current.loadNotice).toBe(refusedOpenNotice('old'));
        expect(localStorage.getItem(buildKey('old'))).toBe(oldText);
        expect(localStorage.getItem(backupKey('old'))).toBeNull();
    });

    it('goes on Remove, from the storage and the list', async () => {
        localStorage.setItem(LIBRARY_KEY, index(['old', 'new']));
        localStorage.setItem(buildKey('old'), oldText);
        localStorage.setItem(buildKey('new'), serializeConfig(gears));
        const { result } = renderHook(usePersistedConfigForm);
        await tick();
        act(() => result.current.library.removeRefused('old'));
        expect(localStorage.getItem(buildKey('old'))).toBeNull();
        expect(result.current.library.builds.map(build => build.id)).toEqual(['new']);
        expect(result.current.library.refused.size).toBe(0);
    });

    it('of a newer version is kept and listed the same way', async () => {
        const newer = JSON.stringify({ format: 2, ...gears });
        localStorage.setItem(LIBRARY_KEY, index(['later']));
        localStorage.setItem(buildKey('later'), newer);
        const { result } = renderHook(usePersistedConfigForm);
        await tick();
        expect(result.current.loadNotice).toBe(refusedStartNotice('newer'));
        expect(result.current.library.refused.get('later')?.problem).toBe('newer');
        expect(REFUSED_BUILD_LABELS[result.current.library.refused.get('later')!.problem]).toBe(REFUSED_BUILD_LABELS.newer);
        expect(localStorage.getItem(buildKey('later'))).toBe(newer);
    });
});

describe('a saved build of this format', () => {
    it('saves and loads again: the round trip of a saved build', async () => {
        localStorage.setItem(LIBRARY_KEY, index(['one']));
        localStorage.setItem(buildKey('one'), serializeConfig(gears));
        const { result } = renderHook(usePersistedConfigForm);
        await tick();
        expect(result.current.library.currentId).toBe('one');
        expect(result.current.config.setpoint.item).toBe('iron-gear-wheel');
        expect(result.current.loadNotice).toBeNull();
        expect(result.current.library.refused.size).toBe(0);
    });
});
