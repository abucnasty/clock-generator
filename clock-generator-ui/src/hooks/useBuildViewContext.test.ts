// @vitest-environment happy-dom
import { Activity, createElement, type ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultConfig } from '../utils/configForm/formData';
import { contextKeyOf, defaultBuildViewContext, readBuildViewContext, writeBuildViewContext } from '../utils/buildViewContext';
import { serializeConfig } from './usePersistedConfigForm';
import { useBuildViewContext } from './useBuildViewContext';

let options: Omit<Parameters<typeof useBuildViewContext>[0], 'formKey'>;
let frames: Map<number, FrameRequestCallback>, nextFrame: number;
let scrollTo: ReturnType<typeof vi.fn>, visible: boolean;
// StrictMode replays the effects on mount; hiding and showing the Activity replays them later in the hook's life.
const wrapper = ({ children }: { children: ReactNode }) => createElement(Activity, { mode: visible ? 'visible' : 'hidden', children });
const mount = () => renderHook(() => useBuildViewContext({ ...options, formKey: serializeConfig(options.form) }), { wrapper, reactStrictMode: true });
const replay = (hook: ReturnType<typeof mount>) => { visible = false; hook.rerender(); visible = true; hook.rerender(); };
const complete = (hook: ReturnType<typeof mount>) => {
    options = { ...options, ready: { buildId: options.buildId, formKey: serializeConfig(options.form), replacementRevision: options.replacementRevision } };
    hook.rerender(); return hook.result.current;
};
const runFrames = () => { for (let round = 0; round < 2; round++) { const pending = [...frames.values()]; frames.clear(); pending.forEach(frame => frame(round)); } };
beforeEach(() => {
    localStorage.clear(); frames = new Map(); nextFrame = 0; visible = true;
    scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    vi.stubGlobal('innerHeight', 700);
    vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(3000);
    const anchor = { dataset: { buildAnchor: 'build' }, getClientRects: () => [1], getBoundingClientRect: () => ({ top: 400, height: 800 }) };
    vi.spyOn(document, 'querySelectorAll').mockReturnValue([anchor] as unknown as NodeListOf<Element>);
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ getPropertyValue: () => '80' } as unknown as CSSStyleDeclaration);
    vi.stubGlobal('requestAnimationFrame', (frame: FrameRequestCallback) => { frames.set(++nextFrame, frame); return nextFrame; });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id); });
    options = { buildId: 'one', ready: null, form: createDefaultConfig(), hasResults: true, hasFuel: false, replacementRevision: 0, insightIds: [] };
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('working-context hydration and pending restoration', () => {
    it('never writes defaults before matching build/form/cache completion, including effect replay and same-config build switches', () => {
        const saved = { ...defaultBuildViewContext(), resultDetail: 'timeline' as const, configView: 'diagram' as const, entityConfigKey: serializeConfig(options.form) };
        writeBuildViewContext(localStorage, 'one', saved);
        const original = localStorage.getItem(contextKeyOf('one'));
        const hook = mount(); hook.rerender();
        expect(localStorage.getItem(contextKeyOf('one'))).toBe(original);
        options.ready = { buildId: 'other', formKey: serializeConfig(options.form), replacementRevision: 0 };
        hook.rerender(); expect(localStorage.getItem(contextKeyOf('one'))).toBe(original);
        options.ready = { buildId: 'one', formKey: 'wrong-form', replacementRevision: 0 };
        hook.rerender(); expect(localStorage.getItem(contextKeyOf('one'))).toBe(original);
        // A deliberate pre-ready navigation wins while unrelated saved choices still hydrate.
        act(() => hook.result.current.patch({ view: 'results' }));
        expect(complete(hook).context).toMatchObject({ view: 'results', configView: 'diagram', resultDetail: 'timeline' });
        replay(hook);
        localStorage.setItem(contextKeyOf('two'), JSON.stringify({ ...saved, configView: 'list', resultDetail: 'wake' }));
        options = { ...options, buildId: 'two' }; // The form is intentionally identical.
        hook.rerender(); expect(readBuildViewContext(localStorage, 'two').resultDetail).toBe('timeline');
        expect(complete(hook).context).toMatchObject({ configView: 'list', resultDetail: 'timeline' });
    });

    it('restores once without focus changes and cancels delayed position for explicit navigation or native input', () => {
        const saved = { ...defaultBuildViewContext(), entityConfigKey: serializeConfig(options.form), position: { configure: { anchor: 'build' as const, offset: 20 } } };
        writeBuildViewContext(localStorage, 'one', saved);
        const hook = mount();
        complete(hook); runFrames(); expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 332, behavior: 'instant' });
        hook.rerender(); runFrames(); expect(scrollTo).toHaveBeenCalledOnce();
        window.dispatchEvent(new Event('scroll'));
        act(() => hook.result.current.patch({ view: 'results' }));
        act(() => hook.result.current.patch({ resultDetail: 'timeline' }));
        expect(readBuildViewContext(localStorage, 'one').position).toEqual({ configure: { anchor: 'build', offset: -312 }, results: { anchor: 'build', offset: -312 } });
        options = { ...options, buildId: 'two', ready: null };
        writeBuildViewContext(localStorage, 'two', saved); hook.rerender(); complete(hook);
        window.dispatchEvent(new Event('wheel')); runFrames(); expect(scrollTo).toHaveBeenCalledOnce();
        options = { ...options, buildId: 'three', ready: null };
        writeBuildViewContext(localStorage, 'three', saved); hook.rerender(); complete(hook);
        act(() => hook.result.current.patch({ configView: 'diagram' }));
        runFrames(); expect(scrollTo).toHaveBeenCalledOnce();
        expect(readBuildViewContext(localStorage, 'three').configView).toBe('diagram');
        // A fresh destination has no saved offset: it starts at the containing heading, once, instead of leaking the previous page position.
        options = { ...options, buildId: 'fresh', ready: null }; hook.rerender(); complete(hook); runFrames();
        expect(scrollTo).toHaveBeenLastCalledWith({ top: 312, behavior: 'instant' });
        expect(scrollTo).toHaveBeenCalledTimes(2);
        hook.rerender(); runFrames(); expect(scrollTo).toHaveBeenCalledTimes(2);
    });
});
