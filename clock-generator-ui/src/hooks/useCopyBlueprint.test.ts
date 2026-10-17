import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generatedForOf } from '../utils/resultsStaleness';
import { formDataToConfig } from '../utils/configForm/configMapping';
import { createDefaultConfig } from '../utils/configForm/formData';
import { useCopyBlueprint } from './useCopyBlueprint';

// The established Node-only hook runner retains state, effects and teardown without introducing a DOM dependency.
const runner = vi.hoisted(() => {
    let states: unknown[] = [], refs: { current: unknown }[] = [];
    let memos: { deps: readonly unknown[]; value: unknown }[] = [];
    let effects: { deps: readonly unknown[]; cleanup?: () => void }[] = [];
    let queued: (() => void)[] = [];
    let si = 0, ri = 0, mi = 0, ei = 0;
    const same = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
    return {
        reset() { states = []; refs = []; memos = []; effects = []; queued = []; },
        begin() { si = ri = mi = ei = 0; queued = []; },
        commit() { queued.forEach(f => f()); },
        unmount() { effects.forEach(e => e.cleanup?.()); },
        react: {
            useState(initial: unknown) {
                const i = si++;
                if (!(i in states)) states[i] = initial;
                return [states[i], (value: unknown) => { states[i] = value; }];
            },
            useRef(value: unknown) { return refs[ri++] ??= { current: value }; },
            useCallback(fn: unknown, deps: readonly unknown[]) {
                const i = mi++;
                if (!memos[i] || !same(memos[i].deps, deps)) memos[i] = { deps, value: fn };
                return memos[i].value;
            },
            useEffect(effect: () => (() => void) | void, deps?: readonly unknown[]) {
                const i = ei++;
                if (!deps || !effects[i] || !same(effects[i].deps, deps)) queued.push(() => {
                    effects[i]?.cleanup?.(); effects[i] = { deps: deps ?? [], cleanup: effect() || undefined };
                });
            },
        },
    };
});
vi.mock('react', () => ({ ...runner.react, useLayoutEffect: runner.react.useEffect }));
let options: Parameters<typeof useCopyBlueprint>[0];
let write: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>;
const Render = () => { runner.begin(); const hook = useCopyBlueprint(options); runner.commit(); return hook; };
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
function deferred() {
    let resolve!: () => void, reject!: (error: Error) => void;
    const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
const oldBuild = generatedForOf(formDataToConfig(createDefaultConfig()), 123);
beforeEach(() => {
    runner.reset(); vi.useFakeTimers();
    write = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText: write } });
    options = { blueprintString: 'attempted-blueprint', rateWarning: null, staleFor: null, running: false,
        copyIdentity: {}, onCopied: vi.fn(), onPinned: vi.fn(), onCopyFailed: vi.fn(), onCopyAttempt: vi.fn() };
});
afterEach(() => { runner.unmount(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('shared blueprint copy lifecycle', () => {
    it.each(['reject', 'throw', 'missing'] as const)('recovers from %s without claiming success or pinning', async kind => {
        if (kind === 'reject') write.mockRejectedValueOnce(new Error('denied'));
        if (kind === 'throw') write.mockImplementationOnce(() => { throw new Error('denied'); });
        if (kind === 'missing') vi.stubGlobal('navigator', {});
        options.running = true; options.rateWarning = 'Below target';
        Render().request(); await flush();
        expect(options.onCopyFailed).toHaveBeenCalledWith({ blueprintString: 'attempted-blueprint', rateWarning: 'Below target', staleFor: null, running: true });
        expect(Render().copied).toBe(false);
        expect(options.onCopied).not.toHaveBeenCalled(); expect(options.onPinned).not.toHaveBeenCalled();
        expect(options.onCopyAttempt).toHaveBeenCalledOnce();
    });
    it('allows repeat rejected attempts to report independently', async () => {
        write.mockRejectedValue(new Error('denied'));
        Render().request(); await flush(); Render().request(); await flush();
        expect(options.onCopyFailed).toHaveBeenCalledTimes(2); expect(options.onCopyAttempt).toHaveBeenCalledTimes(2);
    });
    it('keeps the exact failed snapshot after the selection, build or run changes', async () => {
        const pending = deferred(); write.mockReturnValueOnce(pending.promise);
        options.rateWarning = 'Attempt warning'; options.running = true;
        Render().request();
        options = { ...options, blueprintString: 'new-output', rateWarning: null, running: false, copyIdentity: {} }; Render();
        pending.reject(new Error('denied')); await flush();
        expect(options.onCopyFailed).toHaveBeenCalledWith({ blueprintString: 'attempted-blueprint', rateWarning: 'Attempt warning', staleFor: null, running: true });
        expect(write).toHaveBeenCalledWith('attempted-blueprint'); expect(Render().copied).toBe(false);
    });
    it('never reveals or writes stale output on Cancel and invokes attempt only once on Confirm', async () => {
        options.staleFor = oldBuild;
        Render().request(); expect(Render().confirmingStale).toBe(true); expect(write).not.toHaveBeenCalled();
        Render().cancel(); expect(Render().confirmingStale).toBe(false); expect(options.onCopyFailed).not.toHaveBeenCalled();
        Render().request(); Render().confirm(); await flush();
        expect(write).toHaveBeenCalledExactlyOnceWith('attempted-blueprint'); expect(options.onCopyAttempt).toHaveBeenCalledTimes(2);
        expect(options.onCopied).toHaveBeenCalledOnce();
    });
    it('invalidates stale confirmation when its requested identity changes', async () => {
        options.staleFor = oldBuild; Render().request(); const oldConfirm = Render().confirm;
        options = { ...options, copyIdentity: {}, blueprintString: 'replacement' }; Render();
        expect(Render().confirmingStale).toBe(false); oldConfirm(); Render().confirm(); await flush();
        expect(write).not.toHaveBeenCalled(); expect(options.onCopyFailed).not.toHaveBeenCalled();
    });
    it('cannot confirm a canceled question or write twice through a retained confirm callback', async () => {
        options.staleFor = oldBuild; Render().request(); const confirm = Render().confirm;
        Render().cancel(); confirm(); await flush(); expect(write).not.toHaveBeenCalled();
        Render().request(); const nextConfirm = Render().confirm; nextConfirm(); nextConfirm(); await flush();
        expect(write).toHaveBeenCalledOnce(); expect(options.onCopied).toHaveBeenCalledOnce();
    });
    it('reports the stale snapshot only after confirmation', async () => {
        options.staleFor = oldBuild; write.mockRejectedValue(new Error('denied'));
        Render().request(); expect(options.onCopyFailed).not.toHaveBeenCalled(); Render().confirm(); await flush();
        expect(options.onCopyFailed).toHaveBeenCalledWith(expect.objectContaining({ staleFor: oldBuild, blueprintString: 'attempted-blueprint' }));
    });
    it('pins only after resolution and reports the below-target warning once through latest callbacks', async () => {
        const pending = deferred(); write.mockReturnValueOnce(pending.promise);
        options.running = true; options.rateWarning = 'Below target'; Render().request();
        expect(options.onPinned).not.toHaveBeenCalled();
        const previousPin = options.onPinned, previousCopy = options.onCopied;
        options = { ...options, onPinned: vi.fn(), onCopied: vi.fn() }; Render(); pending.resolve(); await flush();
        expect(previousPin).not.toHaveBeenCalled(); expect(previousCopy).not.toHaveBeenCalled();
        expect(options.onPinned).toHaveBeenCalledOnce(); expect(options.onCopied).toHaveBeenCalledExactlyOnceWith('Below target', true);
        expect(Render().copied).toBe(true);
    });
    it('ignores late success after output identity replacement', async () => {
        const pending = deferred(); write.mockReturnValueOnce(pending.promise); options.running = true;
        Render().request(); options = { ...options, copyIdentity: {} }; Render(); pending.resolve(); await flush();
        expect(options.onPinned).not.toHaveBeenCalled(); expect(options.onCopied).not.toHaveBeenCalled(); expect(Render().copied).toBe(false);
    });
    it.each(['resolve', 'reject'] as const)('ignores an older request that settles by %s after a newer attempt', async outcome => {
        const first = deferred(), second = deferred(); write.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
        Render().request(); Render().request(); second.resolve(); await flush();
        if (outcome === 'resolve') first.resolve(); else first.reject(new Error('old rejection'));
        await flush(); expect(options.onCopied).toHaveBeenCalledOnce(); expect(options.onCopyFailed).not.toHaveBeenCalled(); expect(Render().copied).toBe(true);
    });
    it.each(['resolve', 'reject'] as const)('retires pending %s on unmount', async outcome => {
        const pending = deferred(); write.mockReturnValueOnce(pending.promise); Render().request(); runner.unmount();
        if (outcome === 'resolve') pending.resolve(); else pending.reject(new Error('denied'));
        await flush(); expect(options.onCopied).not.toHaveBeenCalled(); expect(options.onCopyFailed).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
    });
    it('clears Copied and its timer for a new attempt, and cleans the final timer on unmount', async () => {
        Render().request(); await flush(); expect(Render().copied).toBe(true); vi.advanceTimersByTime(1500);
        const pending = deferred(); write.mockReturnValueOnce(pending.promise); Render().request();
        expect(Render().copied).toBe(false); expect(vi.getTimerCount()).toBe(0); pending.resolve(); await flush();
        vi.advanceTimersByTime(1999); expect(Render().copied).toBe(true); vi.advanceTimersByTime(1); expect(Render().copied).toBe(false);
        Render().request(); await flush(); runner.unmount(); expect(vi.getTimerCount()).toBe(0);
    });
    it('ignores empty requests without retiring feedback', () => {
        options.blueprintString = null; Render().request(); expect(options.onCopyAttempt).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
    });
});
