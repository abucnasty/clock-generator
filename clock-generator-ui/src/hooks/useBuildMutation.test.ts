import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePersistedConfigForm } from './usePersistedConfigForm';
import { createDefaultConfig } from '../utils/configForm/formData';
import { formDataToConfig } from '../utils/configForm/configMapping';
import type { MessageInput } from '../utils/messages';
import { backupKey, buildKey, LIBRARY_KEY } from '../utils/buildLibrary';

// Reuses the established Node-only hook runner approach: retain actual state/effects, including the interval
// between an authoritative edit and the next React commit. No DOM or replacement production state owner.
const runner = vi.hoisted(() => {
    let states: unknown[] = [], refs: { current: unknown }[] = [], queued: (() => void)[] = [];
    let memos: { deps: readonly unknown[]; value: unknown }[] = [], effects: { deps: readonly unknown[]; cleanup?: () => void }[] = [];
    let si = 0, ri = 0, mi = 0, ei = 0;
    const same = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
    const memo = (create: () => unknown, deps: readonly unknown[]) => {
        const i = mi++;
        if (!memos[i] || !same(memos[i].deps, deps)) memos[i] = { deps, value: create() };
        return memos[i].value;
    };
    return {
        ask: vi.fn(), notify: vi.fn(), dismiss: vi.fn(), announce: vi.fn(), announceMessage: vi.fn(),
        reset() { states = []; refs = []; queued = []; memos = []; effects = []; },
        begin() { si = ri = mi = ei = 0; queued = []; },
        commit() { queued.forEach(effect => effect()); },
        unmount() { effects.forEach(effect => effect.cleanup?.()); },
        react: {
            useState(initial: unknown) {
                const i = si++;
                if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial;
                return [states[i], (next: unknown) => { states[i] = typeof next === 'function' ? next(states[i]) : next; }];
            },
            useRef(value: unknown) { return refs[ri++] ??= { current: value }; },
            useMemo: memo, useCallback: (fn: unknown, deps: readonly unknown[]) => memo(() => fn, deps),
            useEffect(create: () => (() => void) | void, deps?: readonly unknown[]) {
                const i = ei++, next = deps ?? [];
                if (!effects[i] || !deps || !same(effects[i].deps, next)) queued.push(() => {
                    effects[i]?.cleanup?.(); effects[i] = { deps: next, cleanup: create() || undefined };
                });
            },
        },
    };
});
vi.mock('react', () => runner.react);
vi.mock('../worker/engineClient', () => ({ askEngine: (...args: unknown[]) => runner.ask(...args) }));
vi.mock('./useMessages', () => ({ useNotify: () => runner.notify, useDismissMessage: () => runner.dismiss,
    useAnnounce: () => runner.announce, useAnnounceMessage: () => runner.announceMessage }));

function storage() {
    const values = new Map<string, string>();
    return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); },
        removeItem: (key: string) => { values.delete(key); }, clear: () => values.clear(), key: (index: number) => [...values.keys()][index] ?? null,
        get length() { return values.size; } };
}
let local: ReturnType<typeof storage>;
let useUndo: typeof import('./useUndo')['useUndo'];
function Render() {
    runner.begin();
    const owner = usePersistedConfigForm(), undo = useUndo(owner.config, owner.setConfig, owner.isLoaded);
    runner.commit();
    return { ...owner, ...undo };
}
beforeEach(async () => {
    runner.reset(); runner.ask.mockReset(); runner.ask.mockResolvedValue(null);
    runner.notify.mockReset(); runner.notify.mockReturnValue(1); runner.dismiss.mockClear();
    local = storage();
    vi.stubGlobal('window', { localStorage: local, sessionStorage: storage(), addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.stubGlobal('document', { activeElement: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), querySelector: vi.fn() });
    vi.stubGlobal('HTMLElement', class {});
    vi.stubGlobal('navigator', { platform: 'MacIntel', userAgent: '' });
    useUndo = (await import('./useUndo')).useUndo;
});
afterEach(() => { runner.unmount(); vi.unstubAllGlobals(); });

function pendingCheck() {
    let resolve!: (problem: string | null) => void;
    let reject!: (error: Error) => void;
    runner.ask.mockReturnValueOnce(new Promise<string | null>((done, fail) => { resolve = done; reject = fail; }));
    return { resolve, reject };
}

function savedBuilds() {
    const initial = Render(), snapshot = initial.captureBuildMutation(), meta = initial.library.currentMeta;
    const first = initial.library.addBuild({ ...createDefaultConfig(), target_output: { recipe: 'iron-gear-wheel', items_per_second: 1, copies: 1 } }, 'First');
    Render();
    const second = initial.library.addBuild({ ...createDefaultConfig(), target_output: { recipe: 'copper-cable', items_per_second: 2, copies: 1 } }, 'Second');
    Render();
    initial.library.restore({ meta, form: snapshot.form });
    return { hook: Render(), first: first.id, second: second.id };
}

function changedElsewhere(text: string) {
    const onStorage = vi.mocked(window.addEventListener).mock.calls.find(([type]) => type === 'storage')![1] as (event: Partial<StorageEvent>) => void;
    onStorage({ storageArea: local, key: buildKey(Render().library.currentId), newValue: text });
}

describe('async build loading ownership', () => {
    it('only opens the latest requested build when checks finish out of order', async () => {
        const { hook, first, second } = savedBuilds();
        const older = pendingCheck(), openFirst = hook.library.openBuild(first);
        const newer = pendingCheck(), openSecond = hook.library.openBuild(second);
        newer.resolve(null);
        expect(await openSecond).toBe(true);
        older.resolve(null);
        expect(await openFirst).toBe(false);
        expect(Render().library.currentId).toBe(second);
        expect(Render().config.target_output.recipe).toBe('copper-cable');
    });

    it.each(['new', 'duplicate', 'edit', 'restore'] as const)('ignores an open after a synchronous %s action, before React commits', async action => {
        const { hook, first } = savedBuilds();
        const check = pendingCheck(), opening = hook.library.openBuild(first);
        if (action === 'new') hook.library.newBuild();
        if (action === 'duplicate') hook.library.duplicateBuild();
        if (action === 'edit') hook.setConfig(form => ({ ...form, target_output: { ...form.target_output, copies: 5 } }));
        if (action === 'restore') hook.library.restore({ meta: hook.library.currentMeta, form: hook.config });
        const expected = hook.captureBuildMutation();
        check.resolve(null);
        expect(await opening).toBe(false);
        expect(hook.captureBuildMutation()).toEqual(expected);
    });

    it.each(['invalid', 'failed'] as const)('does not show or back up a stale %s answer', async outcome => {
        const { hook, first, second } = savedBuilds();
        const check = pendingCheck(), opening = hook.library.openBuild(first);
        expect(await hook.library.openBuild(second)).toBe(true);
        if (outcome === 'invalid') check.resolve('Old validation problem');
        else check.reject(new Error('Old worker failure'));
        expect(await opening).toBe(false);
        expect(Render().loadNotice).toBeNull();
        expect(local.getItem(backupKey(first))).toBeNull();
    });

    it('cancels deletion without deleting storage, clearing results, or offering Undo after a newer open', async () => {
        const { hook, second } = savedBuilds();
        const originalText = local.getItem(buildKey(hook.library.currentId));
        const before = vi.fn(), check = pendingCheck(), deleting = hook.library.deleteBuild(before);
        expect(await hook.library.openBuild(second)).toBe(true);
        const index = local.getItem(LIBRARY_KEY);
        check.resolve(null);
        expect(await deleting).toBeNull();
        expect(before).not.toHaveBeenCalled();
        expect(local.getItem(buildKey(hook.library.currentId))).toBe(originalText);
        expect(local.getItem(LIBRARY_KEY)).toBe(index);
        expect(Render().library.currentId).toBe(second);
    });

    it('rejects deletion after a same-build edit and commits a current deletion once', async () => {
        const { hook } = savedBuilds();
        const before = vi.fn(), check = pendingCheck(), deleting = hook.library.deleteBuild(before);
        hook.setConfig(form => ({ ...form, target_output: { ...form.target_output, copies: 3 } }));
        check.resolve(null);
        expect(await deleting).toBeNull();
        expect(before).not.toHaveBeenCalled();
        const result = await hook.library.deleteBuild(before);
        expect(result?.deleted.id).toBe(hook.library.currentId);
        expect(before).toHaveBeenCalledOnce();
        expect(local.getItem(buildKey(hook.library.currentId))).toBeNull();
    });

    it.each(['edit', 'episode', 'dismiss'] as const)('does not apply a cross-tab load after a newer %s', async action => {
        const { hook } = savedBuilds();
        changedElsewhere(JSON.stringify({ ...hook.config, target_output: { ...hook.config.target_output, copies: 4 } }));
        const check = pendingCheck(), before = vi.fn(), loading = hook.library.loadOtherTabVersion(before);
        if (action === 'edit') hook.setConfig(form => ({ ...form, target_output: { ...form.target_output, copies: 9 } }));
        if (action === 'episode') changedElsewhere(JSON.stringify({ ...hook.config, target_output: { ...hook.config.target_output, copies: 7 } }));
        if (action === 'dismiss') hook.library.closeConflict();
        const expected = hook.captureBuildMutation();
        check.resolve(null);
        expect(await loading).toBe(false);
        expect(before).not.toHaveBeenCalled();
        expect(hook.captureBuildMutation()).toEqual(expected);
        if (action === 'episode') {
            expect(await hook.library.loadOtherTabVersion(before)).toBe(true);
            expect(hook.captureBuildMutation().form.target_output.copies).toBe(7);
            expect(before).toHaveBeenCalledOnce();
        }
    });

    it('ignores requests that finish after unmount', async () => {
        const { hook, first } = savedBuilds();
        const check = pendingCheck(), opening = hook.library.openBuild(first), expected = hook.captureBuildMutation();
        runner.unmount();
        check.resolve(null);
        expect(await opening).toBe(false);
        expect(hook.captureBuildMutation()).toEqual(expected);
    });
});

describe('authoritative build mutation with whole-build Undo', () => {
    it('rejects changed-then-restored ownership and keeps beforeCommit once outside React updates with exact synchronous Undo snapshot', () => {
        const hook = Render(), captured = hook.captureBuildMutation();
        const metadataEdit = { ...captured.form, machines: captured.form.machines.map(row => ({ ...row, _uuid: 'new-ui-identity' })) };
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
        const expected = hook.captureBuildMutation();
        const commit = vi.fn(() => hook.offerUndo('Converted complete unit.', { snapshot: expected.form, deferAnnouncement: true }));
        expect(hook.commitBuildReplacement(expected, next, commit)).toBe(true);
        expect(commit).toHaveBeenCalledOnce();
        expect(hook.captureBuildMutation().form).toBe(next);
        Render(); Render();
        expect(commit).toHaveBeenCalledOnce();
        const message = runner.notify.mock.calls.at(-1)![0] as MessageInput;
        message.action!.onClick();
        expect(hook.captureBuildMutation().form).toBe(expected.form);
        expect(hook.captureBuildMutation().form.machines[0]._uuid).toBe('new-ui-identity');
        expect(hook.captureBuildMutation().form.overrides).toEqual({ loop_seed_items: 0 });
    });

    it('does not accept delayed initial saved data after a build switch away and back', async () => {
        const saved = createDefaultConfig(); saved.target_output.recipe = 'iron-gear-wheel';
        local.setItem('clock-generator-config', JSON.stringify(saved));
        let resolve!: (value: null) => void;
        runner.ask.mockReturnValueOnce(new Promise<null>(done => { resolve = done; }));
        const hook = Render(), initial = hook.captureBuildMutation();
        const meta = hook.library.currentMeta;
        hook.library.newBuild();
        hook.library.restore({ meta, form: initial.form });
        const returned = hook.captureBuildMutation();
        expect(returned.buildId).toBe(initial.buildId);
        expect(returned.form).toBe(initial.form);
        expect(returned.revision).toBeGreaterThan(initial.revision);
        resolve(null); await Promise.resolve();
        expect(Render().captureBuildMutation().form).toBe(initial.form);
        expect(Render().isLoaded).toBe(true);
        expect(hook.commitBuildReplacement(initial, saved, vi.fn())).toBe(false);
    });
});
