// @vitest-environment happy-dom
import { act, renderHook, type RenderHookResult } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePersistedConfigForm, type BuildMutationSnapshot } from './usePersistedConfigForm';
import { useUndo } from './useUndo';
import { createDefaultConfig } from '../utils/configForm/formData';
import { formDataToConfig } from '../utils/configForm/configMapping';
import type { MessageInput } from '../utils/messages';
import { backupKey, buildKey, LIBRARY_KEY } from '../utils/buildLibrary';

const { ask, notify, quiet } = vi.hoisted(() => ({ ask: vi.fn(), notify: vi.fn(), quiet: vi.fn() }));
vi.mock('../worker/engineClient', () => ({ askEngine: ask }));
vi.mock('./useMessages', () => ({ useNotify: () => notify, useDismissMessage: () => quiet, useAnnounce: () => quiet, useAnnounceMessage: () => quiet }));

function useBuild() {
    const owner = usePersistedConfigForm();
    return { ...owner, ...useUndo(owner.config, owner.setConfig, owner.isLoaded) };
}
let rendered: RenderHookResult<ReturnType<typeof useBuild>, unknown>;
const mount = (options?: { reactStrictMode: boolean }) => (rendered = renderHook(useBuild, options)).result.current;
const latest = () => rendered.result.current;
/** A synchronous action in one React update, giving back what it returns */
const run = <T>(action: () => T): T => { let value!: T; act(() => { value = action(); }); return value; };
/** Awaits an async action in React's scope, so the updates it makes when it settles are committed */
const settle = <T>(promise: Promise<T>) => act(() => promise);
const tick = () => act(() => Promise.resolve());
beforeEach(() => {
    localStorage.clear(); sessionStorage.clear(); ask.mockReset();
    // the saved build's check gives back the build as it loads it, its machines' former types read
    ask.mockImplementation(async (query: { kind: string; config?: unknown }) => query.kind === 'saved-config' ? { problem: null, form: query.config } : null);
    notify.mockReset(); notify.mockReturnValue(1);
});

function pendingCheck() {
    let done!: (answer: { problem: string | null; form: unknown }) => void;
    let reject!: (error: Error) => void;
    let checked: unknown;
    const answer = new Promise<{ problem: string | null; form: unknown }>((resolve, fail) => { done = resolve; reject = fail; });
    // the check gives back the build it checked, with its problem
    ask.mockImplementationOnce((query: { config: unknown }) => { checked = query.config; return answer; });
    return { resolve: (problem: string | null) => done({ problem, form: checked }), reject };
}

function savedBuilds() {
    const initial = mount(), snapshot = initial.captureBuildMutation(), meta = initial.library.currentMeta;
    const first = run(() => initial.library.addBuild({ ...createDefaultConfig(), target_output: { recipe: 'iron-gear-wheel', items_per_second: 1, copies: 1 } }, 'First'));
    const second = run(() => initial.library.addBuild({ ...createDefaultConfig(), target_output: { recipe: 'copper-cable', items_per_second: 2, copies: 1 } }, 'Second'));
    run(() => initial.library.restore({ meta, form: snapshot.form }));
    return { hook: latest(), first: first.id, second: second.id };
}

const changedElsewhere = (text: string) => act(() => {
    window.dispatchEvent(new StorageEvent('storage', { storageArea: localStorage, key: buildKey(latest().library.currentId), newValue: text }));
});

describe('async build loading ownership', () => {
    it.each(['valid', 'invalid', 'failed'] as const)('never saves the startup placeholder when a cross-tab load overtakes a %s initial answer', async outcome => {
        const saved = { ...createDefaultConfig(), target_output: { recipe: 'iron-gear-wheel', items_per_second: 1, copies: 1 } };
        const text = JSON.stringify(saved);
        localStorage.setItem(buildKey('default'), text);
        const initial = pendingCheck(), hook = mount();
        changedElsewhere(JSON.stringify({ ...saved, target_output: { ...saved.target_output, copies: 4 } }));
        const newer = pendingCheck(), before = vi.fn(), loading = hook.library.loadOtherTabVersion(before);
        if (outcome === 'valid') initial.resolve(null);
        if (outcome === 'invalid') initial.resolve('Old validation problem');
        if (outcome === 'failed') initial.reject(new Error('Old worker failure'));
        await tick();
        expect(latest().isLoaded).toBe(false);
        expect(localStorage.getItem(buildKey('default'))).toBe(text);
        expect(latest().loadError).toBeNull();
        expect(latest().loadNotice).toBeNull();
        newer.resolve(null);
        expect(await settle(loading)).toBe(true);
        expect(before).toHaveBeenCalledOnce();
        expect(latest().isLoaded).toBe(true);
        expect(latest().config.target_output.copies).toBe(4);
    });

    it.each([true, false])('finishes startup if the newer load fails (initial answer first: %s)', async initialFirst => {
        const saved = { ...createDefaultConfig(), target_output: { recipe: 'iron-gear-wheel', items_per_second: 1, copies: 1 } };
        localStorage.setItem(buildKey('default'), JSON.stringify(saved));
        const initial = pendingCheck(), hook = mount();
        changedElsewhere(JSON.stringify({ ...saved, target_output: { ...saved.target_output, copies: 4 } }));
        const newer = pendingCheck(), loading = hook.library.loadOtherTabVersion(vi.fn());
        if (initialFirst) { initial.resolve(null); await tick(); }
        newer.resolve('Invalid newer config');
        expect(await settle(loading)).toBe(false);
        if (!initialFirst) { initial.resolve(null); await tick(); }
        expect(latest().isLoaded).toBe(true);
        expect(latest().config.target_output).toEqual(saved.target_output);
    });

    it('keeps the replayed startup validation current after effect cleanup', async () => {
        const saved = { ...createDefaultConfig(), target_output: { recipe: 'iron-gear-wheel', items_per_second: 1, copies: 1 } };
        localStorage.setItem(buildKey('default'), JSON.stringify(saved));
        // StrictMode starts the check, cleans it up, and starts it again
        const older = pendingCheck(), newer = pendingCheck();
        mount({ reactStrictMode: true });
        older.resolve(null); await tick();
        expect(latest().isLoaded).toBe(false);
        newer.resolve(null); await tick();
        expect(latest().isLoaded).toBe(true);
        expect(latest().config.target_output).toEqual(saved.target_output);
    });

    it('only opens the latest requested build when checks finish out of order', async () => {
        const { hook, first, second } = savedBuilds();
        const older = pendingCheck(), openFirst = hook.library.openBuild(first);
        const newer = pendingCheck(), openSecond = hook.library.openBuild(second);
        newer.resolve(null);
        expect(await settle(openSecond)).toBe(true);
        older.resolve(null);
        expect(await settle(openFirst)).toBe(false);
        expect(latest().library.currentId).toBe(second);
        expect(latest().config.target_output.recipe).toBe('copper-cable');
    });

    it.each(['new', 'duplicate', 'edit', 'restore'] as const)('ignores an open after a synchronous %s action, before React commits', async action => {
        const { hook, first } = savedBuilds();
        const check = pendingCheck(), opening = hook.library.openBuild(first);
        let expected!: BuildMutationSnapshot;
        await act(async () => {
            if (action === 'new') hook.library.newBuild();
            if (action === 'duplicate') hook.library.duplicateBuild();
            if (action === 'edit') hook.setConfig(form => ({ ...form, target_output: { ...form.target_output, copies: 5 } }));
            if (action === 'restore') hook.library.restore({ meta: hook.library.currentMeta, form: hook.config });
            expected = hook.captureBuildMutation();
            check.resolve(null);
            expect(await opening).toBe(false);
        });
        expect(hook.captureBuildMutation()).toEqual(expected);
    });

    it.each(['invalid', 'failed'] as const)('does not show or back up a stale %s answer', async outcome => {
        const { hook, first, second } = savedBuilds();
        const check = pendingCheck(), opening = hook.library.openBuild(first);
        expect(await settle(hook.library.openBuild(second))).toBe(true);
        if (outcome === 'invalid') check.resolve('Old validation problem');
        else check.reject(new Error('Old worker failure'));
        expect(await settle(opening)).toBe(false);
        expect(latest().loadNotice).toBeNull();
        expect(localStorage.getItem(backupKey(first))).toBeNull();
    });

    it('cancels deletion without deleting storage, clearing results, or offering Undo after a newer open', async () => {
        const { hook, second } = savedBuilds();
        const originalText = localStorage.getItem(buildKey(hook.library.currentId));
        const before = vi.fn(), check = pendingCheck(), deleting = hook.library.deleteBuild(before);
        expect(await settle(hook.library.openBuild(second))).toBe(true);
        const index = localStorage.getItem(LIBRARY_KEY);
        check.resolve(null);
        expect(await settle(deleting)).toBeNull();
        expect(before).not.toHaveBeenCalled();
        expect(localStorage.getItem(buildKey(hook.library.currentId))).toBe(originalText);
        expect(localStorage.getItem(LIBRARY_KEY)).toBe(index);
        expect(latest().library.currentId).toBe(second);
    });

    it('rejects deletion after a same-build edit and commits a current deletion once', async () => {
        const { hook } = savedBuilds();
        const before = vi.fn(), check = pendingCheck(), deleting = hook.library.deleteBuild(before);
        run(() => hook.setConfig(form => ({ ...form, target_output: { ...form.target_output, copies: 3 } })));
        check.resolve(null);
        expect(await settle(deleting)).toBeNull();
        expect(before).not.toHaveBeenCalled();
        const result = await settle(hook.library.deleteBuild(before));
        expect(result?.deleted.id).toBe(hook.library.currentId);
        expect(before).toHaveBeenCalledOnce();
        expect(localStorage.getItem(buildKey(hook.library.currentId))).toBeNull();
    });

    it.each(['edit', 'episode', 'dismiss'] as const)('does not apply a cross-tab load after a newer %s', async action => {
        const { hook } = savedBuilds();
        changedElsewhere(JSON.stringify({ ...hook.config, target_output: { ...hook.config.target_output, copies: 4 } }));
        const check = pendingCheck(), before = vi.fn(), loading = hook.library.loadOtherTabVersion(before);
        let expected!: BuildMutationSnapshot;
        await act(async () => {
            if (action === 'edit') hook.setConfig(form => ({ ...form, target_output: { ...form.target_output, copies: 9 } }));
            if (action === 'episode') changedElsewhere(JSON.stringify({ ...hook.config, target_output: { ...hook.config.target_output, copies: 7 } }));
            if (action === 'dismiss') hook.library.closeConflict();
            expected = hook.captureBuildMutation();
            check.resolve(null);
            expect(await loading).toBe(false);
        });
        expect(before).not.toHaveBeenCalled();
        expect(hook.captureBuildMutation()).toEqual(expected);
        if (action === 'episode') {
            expect(await settle(hook.library.loadOtherTabVersion(before))).toBe(true);
            expect(hook.captureBuildMutation().form.target_output.copies).toBe(7);
            expect(before).toHaveBeenCalledOnce();
        }
    });

    it('ignores requests that finish after unmount', async () => {
        const { hook, first } = savedBuilds();
        const check = pendingCheck(), opening = hook.library.openBuild(first), expected = hook.captureBuildMutation();
        rendered.unmount();
        check.resolve(null);
        expect(await settle(opening)).toBe(false);
        expect(hook.captureBuildMutation()).toEqual(expected);
    });
});

describe('authoritative build mutation with whole-build Undo', () => {
    it('rejects changed-then-restored ownership and keeps beforeCommit once outside React updates with exact synchronous Undo snapshot', () => {
        const hook = mount(), captured = hook.captureBuildMutation();
        const metadataEdit = { ...captured.form, machines: captured.form.machines.map(row => ({ ...row, _uuid: 'new-ui-identity' })) };
        let expected!: BuildMutationSnapshot;
        const commit = vi.fn(() => hook.offerUndo('Converted complete unit.', { snapshot: expected.form, deferAnnouncement: true }));
        act(() => {
            hook.setConfig(metadataEdit);
            expect(formDataToConfig(metadataEdit)).toEqual(formDataToConfig(captured.form));
            hook.setConfig(captured.form);
            const before = vi.fn();
            expect(hook.commitBuildReplacement(captured, createDefaultConfig(), before)).toBe(false);
            expect(before).not.toHaveBeenCalled();

            // No render/effect between this edit, capture and commit: useUndo's default effect-ref is still older.
            hook.setConfig(metadataEdit);
            const current = hook.captureBuildMutation(), next = { ...current.form, target_output: { ...current.form.target_output, copies: 8 } };
            const transform = vi.fn((form: typeof current.form) => ({ ...form, overrides: { loop_seed_items: 0 } }));
            hook.setConfig(transform);
            expect(transform).toHaveBeenCalledOnce();
            expected = hook.captureBuildMutation();
            expect(hook.commitBuildReplacement(expected, next, commit)).toBe(true);
            expect(commit).toHaveBeenCalledOnce();
            expect(hook.captureBuildMutation().form).toBe(next);
        });
        expect(commit).toHaveBeenCalledOnce();
        const message = notify.mock.calls.at(-1)![0] as MessageInput;
        act(() => message.action!.onClick());
        expect(hook.captureBuildMutation().form).toBe(expected.form);
        expect(hook.captureBuildMutation().form.machines[0]._uuid).toBe('new-ui-identity');
        expect(hook.captureBuildMutation().form.overrides).toEqual({ loop_seed_items: 0 });
    });

    it('does not accept delayed initial saved data after a build switch away and back', async () => {
        const saved = createDefaultConfig(); saved.target_output.recipe = 'iron-gear-wheel';
        localStorage.setItem('clock-generator-config', JSON.stringify(saved));
        let resolve!: (value: { problem: string | null; form: unknown }) => void;
        ask.mockReturnValueOnce(new Promise<{ problem: string | null; form: unknown }>(done => { resolve = done; }));
        const hook = mount(), initial = hook.captureBuildMutation();
        const meta = hook.library.currentMeta;
        act(() => { hook.library.newBuild(); hook.library.restore({ meta, form: initial.form }); });
        const returned = hook.captureBuildMutation();
        expect(returned.buildId).toBe(initial.buildId);
        expect(returned.form).toBe(initial.form);
        expect(returned.revision).toBeGreaterThan(initial.revision);
        resolve({ problem: null, form: saved }); await tick();
        expect(hook.captureBuildMutation().form).toBe(initial.form);
        expect(latest().isLoaded).toBe(true);
        expect(hook.commitBuildReplacement(initial, saved, vi.fn())).toBe(false);
    });
});
