import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultConfig } from '../utils/configForm/formData';
import { contextKeyOf, defaultBuildViewContext, readBuildViewContext, writeBuildViewContext } from '../utils/buildViewContext';
import { serializeConfig } from './usePersistedConfigForm';
import { useBuildViewContext } from './useBuildViewContext';

const runner = await vi.hoisted(async () => {
    const { createHookRunner } = await import('../test/hookRunner');
    return {
        ...createHookRunner(),
    };
});
vi.mock('react', () => ({ ...runner.react, createContext: () => ({}), useContext: () => null }));
// This hook only needs the authoritative serializer, not the form-owner hooks in this controlled React runner.
vi.mock('./usePersistedConfigForm', () => ({ serializeConfig: (form: unknown) => JSON.stringify(form, (key, value) => key === '_uuid' ? undefined : value) }));
let options: Omit<Parameters<typeof useBuildViewContext>[0], 'formKey'>;
let values: Map<string, string>, localStorage: Storage;
let frames: Map<number, FrameRequestCallback>, nextFrame: number;
let target: EventTarget, scrollTo: ReturnType<typeof vi.fn>;
const Render = () => { runner.begin(); const hook = useBuildViewContext({ ...options, formKey: serializeConfig(options.form) }); runner.commit(); return hook; };
const settle = () => { Render(); return Render(); };
const complete = () => { options = { ...options, ready: { buildId: options.buildId, formKey: serializeConfig(options.form), replacementRevision: options.replacementRevision } }; return settle(); };
const runFrames = () => { for (let round = 0; round < 2; round++) { const pending = [...frames.values()]; frames.clear(); pending.forEach(frame => frame(round)); } };
beforeEach(() => {
    runner.reset(); values = new Map(); frames = new Map(); nextFrame = 0; target = new EventTarget(); scrollTo = vi.fn();
    localStorage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } } as Storage;
    vi.stubGlobal('window', { localStorage, scrollY: 0, innerHeight: 700, scrollTo, addEventListener: target.addEventListener.bind(target), removeEventListener: target.removeEventListener.bind(target) });
    const anchor = { dataset: { buildAnchor: 'build' }, getClientRects: () => [1], getBoundingClientRect: () => ({ top: 400, height: 800 }) };
    vi.stubGlobal('document', { documentElement: { scrollHeight: 3000 }, querySelectorAll: () => [anchor] });
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '80' }));
    vi.stubGlobal('requestAnimationFrame', (frame: FrameRequestCallback) => { frames.set(++nextFrame, frame); return nextFrame; });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id); });
    options = { buildId: 'one', ready: null, form: createDefaultConfig(), hasResults: true, hasFuel: false, replacementRevision: 0, insightIds: [] };
});
afterEach(() => { runner.unmount(); vi.unstubAllGlobals(); });

describe('working-context hydration and pending restoration', () => {
    it('never writes defaults before matching build/form/cache completion, including effect replay and same-config build switches', () => {
        const saved = { ...defaultBuildViewContext(), resultDetail: 'timeline' as const, configView: 'diagram' as const, entityConfigKey: serializeConfig(options.form) };
        writeBuildViewContext(localStorage, 'one', saved);
        const original = values.get(contextKeyOf('one'));
        Render(); runner.replay(); settle();
        expect(values.get(contextKeyOf('one'))).toBe(original);
        options.ready = { buildId: 'other', formKey: serializeConfig(options.form), replacementRevision: 0 };
        settle(); expect(values.get(contextKeyOf('one'))).toBe(original);
        options.ready = { buildId: 'one', formKey: 'wrong-form', replacementRevision: 0 };
        settle(); expect(values.get(contextKeyOf('one'))).toBe(original);
        // A deliberate pre-ready navigation wins while unrelated saved choices still hydrate.
        Render().patch({ view: 'results' });
        expect(complete().context).toMatchObject({ view: 'results', configView: 'diagram', resultDetail: 'timeline' });
        runner.replay(); settle();
        localStorage.setItem(contextKeyOf('two'), JSON.stringify({ ...saved, configView: 'list', resultDetail: 'wake' }));
        options = { ...options, buildId: 'two' }; // The form is intentionally identical.
        settle(); expect(readBuildViewContext(localStorage, 'two').resultDetail).toBe('timeline');
        expect(complete().context).toMatchObject({ configView: 'list', resultDetail: 'timeline' });
    });

    it('restores once without focus changes and cancels delayed position for explicit navigation or native input', () => {
        const saved = { ...defaultBuildViewContext(), entityConfigKey: serializeConfig(options.form), position: { configure: { anchor: 'build' as const, offset: 20 } } };
        writeBuildViewContext(localStorage, 'one', saved);
        complete(); runFrames(); expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 332, behavior: 'instant' });
        settle(); runFrames(); expect(scrollTo).toHaveBeenCalledOnce();
        target.dispatchEvent(new Event('scroll'));
        Render().patch({ view: 'results' }); settle();
        Render().patch({ resultDetail: 'timeline' }); settle();
        expect(readBuildViewContext(localStorage, 'one').position).toEqual({ configure: { anchor: 'build', offset: -312 }, results: { anchor: 'build', offset: -312 } });
        options = { ...options, buildId: 'two', ready: null };
        writeBuildViewContext(localStorage, 'two', saved); settle(); complete();
        target.dispatchEvent(new Event('wheel')); runFrames(); expect(scrollTo).toHaveBeenCalledOnce();
        options = { ...options, buildId: 'three', ready: null };
        writeBuildViewContext(localStorage, 'three', saved); settle(); complete().patch({ configView: 'diagram' });
        settle(); runFrames(); expect(scrollTo).toHaveBeenCalledOnce();
        expect(readBuildViewContext(localStorage, 'three').configView).toBe('diagram');
        // A fresh destination has no saved offset: it starts at the containing heading, once, instead of leaking the previous page position.
        options = { ...options, buildId: 'fresh', ready: null }; settle(); complete(); runFrames();
        expect(scrollTo).toHaveBeenLastCalledWith({ top: 312, behavior: 'instant' });
        expect(scrollTo).toHaveBeenCalledTimes(2);
        settle(); runFrames(); expect(scrollTo).toHaveBeenCalledTimes(2);
    });
});
