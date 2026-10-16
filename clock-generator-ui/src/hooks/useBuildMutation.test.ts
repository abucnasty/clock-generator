import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePersistedConfigForm } from './usePersistedConfigForm';
import { createDefaultConfig } from '../utils/configForm/formData';
import { formDataToConfig } from '../utils/configForm/configMapping';
import type { MessageInput } from '../utils/messages';

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
        removeItem: (key: string) => { values.delete(key); }, key: (index: number) => [...values.keys()][index] ?? null,
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
