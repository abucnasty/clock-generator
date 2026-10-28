// @vitest-environment happy-dom
import { act, renderHook, type RenderHookResult } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generatedForOf } from '../utils/resultsStaleness';
import { formDataToConfig } from '../utils/configForm/configMapping';
import { createDefaultConfig } from '../utils/configForm/formData';
import { useCopyBlueprint } from './useCopyBlueprint';

let options: Parameters<typeof useCopyBlueprint>[0];
let write: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>;
let hook: RenderHookResult<ReturnType<typeof useCopyBlueprint>, unknown>;
const update = (next: Partial<typeof options>) => { options = { ...options, ...next }; hook.rerender(); };
const request = () => act(() => hook.result.current.request());
const confirm = () => act(() => hook.result.current.confirm());
const cancel = () => act(() => hook.result.current.cancel());
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
function deferred() {
    let resolve!: () => void, reject!: (error: Error) => void;
    const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
const oldBuild = generatedForOf(formDataToConfig(createDefaultConfig()), 123);
beforeEach(() => {
    vi.useFakeTimers();
    write = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText: write } });
    options = { blueprintString: 'attempted-blueprint', rateWarning: null, staleFor: null, running: false,
        copyIdentity: {}, onCopied: vi.fn(), onPinned: vi.fn(), onCopyFailed: vi.fn(), onCopyAttempt: vi.fn() };
    hook = renderHook(() => useCopyBlueprint(options));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('shared blueprint copy lifecycle', () => {
    it.each(['reject', 'throw', 'missing'] as const)('recovers from %s without claiming success or pinning', async kind => {
        if (kind === 'reject') write.mockRejectedValueOnce(new Error('denied'));
        if (kind === 'throw') write.mockImplementationOnce(() => { throw new Error('denied'); });
        if (kind === 'missing') vi.stubGlobal('navigator', {});
        update({ running: true, rateWarning: 'Below target' });
        request(); await flush();
        expect(options.onCopyFailed).toHaveBeenCalledWith({ blueprintString: 'attempted-blueprint', rateWarning: 'Below target', staleFor: null, running: true });
        expect(hook.result.current.copied).toBe(false);
        expect(options.onCopied).not.toHaveBeenCalled(); expect(options.onPinned).not.toHaveBeenCalled();
        expect(options.onCopyAttempt).toHaveBeenCalledOnce();
    });
    it('allows repeat rejected attempts to report independently', async () => {
        write.mockRejectedValue(new Error('denied'));
        request(); await flush(); request(); await flush();
        expect(options.onCopyFailed).toHaveBeenCalledTimes(2); expect(options.onCopyAttempt).toHaveBeenCalledTimes(2);
    });
    it('keeps the exact failed snapshot after the selection, build or run changes', async () => {
        const pending = deferred(); write.mockReturnValueOnce(pending.promise);
        update({ rateWarning: 'Attempt warning', running: true });
        request();
        update({ blueprintString: 'new-output', rateWarning: null, running: false, copyIdentity: {} });
        pending.reject(new Error('denied')); await flush();
        expect(options.onCopyFailed).toHaveBeenCalledWith({ blueprintString: 'attempted-blueprint', rateWarning: 'Attempt warning', staleFor: null, running: true });
        expect(write).toHaveBeenCalledWith('attempted-blueprint'); expect(hook.result.current.copied).toBe(false);
    });
    it('never reveals or writes stale output on Cancel and invokes attempt only once on Confirm', async () => {
        update({ staleFor: oldBuild });
        request(); expect(hook.result.current.confirmingStale).toBe(true); expect(write).not.toHaveBeenCalled();
        cancel(); expect(hook.result.current.confirmingStale).toBe(false); expect(options.onCopyFailed).not.toHaveBeenCalled();
        request(); confirm(); await flush();
        expect(write).toHaveBeenCalledExactlyOnceWith('attempted-blueprint'); expect(options.onCopyAttempt).toHaveBeenCalledTimes(2);
        expect(options.onCopied).toHaveBeenCalledOnce();
    });
    it('invalidates stale confirmation when its requested identity changes', async () => {
        update({ staleFor: oldBuild }); request(); const oldConfirm = hook.result.current.confirm;
        update({ copyIdentity: {}, blueprintString: 'replacement' });
        expect(hook.result.current.confirmingStale).toBe(false); act(oldConfirm); confirm(); await flush();
        expect(write).not.toHaveBeenCalled(); expect(options.onCopyFailed).not.toHaveBeenCalled();
    });
    it('cannot confirm a canceled question or write twice through a retained confirm callback', async () => {
        update({ staleFor: oldBuild }); request(); const retained = hook.result.current.confirm;
        cancel(); act(retained); await flush(); expect(write).not.toHaveBeenCalled();
        request(); const nextConfirm = hook.result.current.confirm; act(() => { nextConfirm(); nextConfirm(); }); await flush();
        expect(write).toHaveBeenCalledOnce(); expect(options.onCopied).toHaveBeenCalledOnce();
    });
    it('reports the stale snapshot only after confirmation', async () => {
        update({ staleFor: oldBuild }); write.mockRejectedValue(new Error('denied'));
        request(); expect(options.onCopyFailed).not.toHaveBeenCalled(); confirm(); await flush();
        expect(options.onCopyFailed).toHaveBeenCalledWith(expect.objectContaining({ staleFor: oldBuild, blueprintString: 'attempted-blueprint' }));
    });
    it('pins only after resolution and reports the below-target warning once through latest callbacks', async () => {
        const pending = deferred(); write.mockReturnValueOnce(pending.promise);
        update({ running: true, rateWarning: 'Below target' }); request();
        expect(options.onPinned).not.toHaveBeenCalled();
        const previousPin = options.onPinned, previousCopy = options.onCopied;
        update({ onPinned: vi.fn(), onCopied: vi.fn() }); pending.resolve(); await flush();
        expect(previousPin).not.toHaveBeenCalled(); expect(previousCopy).not.toHaveBeenCalled();
        expect(options.onPinned).toHaveBeenCalledOnce(); expect(options.onCopied).toHaveBeenCalledExactlyOnceWith('Below target', true);
        expect(hook.result.current.copied).toBe(true);
    });
    it('ignores late success after output identity replacement', async () => {
        const pending = deferred(); write.mockReturnValueOnce(pending.promise); update({ running: true });
        request(); update({ copyIdentity: {} }); pending.resolve(); await flush();
        expect(options.onPinned).not.toHaveBeenCalled(); expect(options.onCopied).not.toHaveBeenCalled(); expect(hook.result.current.copied).toBe(false);
    });
    it.each(['resolve', 'reject'] as const)('ignores an older request that settles by %s after a newer attempt', async outcome => {
        const first = deferred(), second = deferred(); write.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
        request(); request(); second.resolve(); await flush();
        if (outcome === 'resolve') first.resolve(); else first.reject(new Error('old rejection'));
        await flush(); expect(options.onCopied).toHaveBeenCalledOnce(); expect(options.onCopyFailed).not.toHaveBeenCalled(); expect(hook.result.current.copied).toBe(true);
    });
    it.each(['resolve', 'reject'] as const)('retires pending %s on unmount', async outcome => {
        const pending = deferred(); write.mockReturnValueOnce(pending.promise); request(); hook.unmount();
        if (outcome === 'resolve') pending.resolve(); else pending.reject(new Error('denied'));
        await flush(); expect(options.onCopied).not.toHaveBeenCalled(); expect(options.onCopyFailed).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
    });
    it('clears Copied and its timer for a new attempt, and cleans the final timer on unmount', async () => {
        request(); await flush(); expect(hook.result.current.copied).toBe(true); advance(1500);
        const pending = deferred(); write.mockReturnValueOnce(pending.promise); request();
        expect(hook.result.current.copied).toBe(false); expect(vi.getTimerCount()).toBe(0); pending.resolve(); await flush();
        advance(1999); expect(hook.result.current.copied).toBe(true); advance(1); expect(hook.result.current.copied).toBe(false);
        request(); await flush(); hook.unmount(); expect(vi.getTimerCount()).toBe(0);
    });
    it('ignores empty requests without retiring feedback', () => {
        update({ blueprintString: null }); request(); expect(options.onCopyAttempt).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
    });
});
