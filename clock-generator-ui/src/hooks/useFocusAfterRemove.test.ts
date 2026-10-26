import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useFocusAfterRemove } from './useFocusAfterRemove';

const hooks = vi.hoisted(() => {
    let refs: { current: unknown }[] = [], index = 0;
    const effects: { run: () => void | (() => void); mount: boolean }[] = [];
    return {
        effects,
        reset() { refs = []; effects.length = 0; },
        begin() { index = 0; effects.length = 0; },
        react: {
            useRef(initial: unknown) { return refs[index++] ??= { current: initial }; },
            useCallback<T>(callback: T) { return callback; },
            useEffect(run: () => void | (() => void), deps?: unknown[]) { effects.push({ run, mount: !!deps }); },
        },
    };
});
vi.mock('react', async original => ({ ...await original<typeof import('react')>(), ...hooks.react }));

let frame: (() => void) | undefined;
const cancel = vi.fn();
const Render = (count: number, onRemove = vi.fn()) => {
    hooks.begin();
    return useFocusAfterRemove(count, onRemove);
};
const commit = () => hooks.effects.filter(effect => !effect.mount).forEach(effect => effect.run());

beforeEach(() => {
    hooks.reset(); frame = undefined; cancel.mockClear();
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => { frame = callback; return 42; });
    vi.stubGlobal('cancelAnimationFrame', cancel);
});
afterEach(() => vi.unstubAllGlobals());

it('resolves the new row after its portal mounts, across incidental rerenders', () => {
    const oldButton = { matches: () => true, focus: vi.fn(), closest: () => null, scrollIntoView: vi.fn() };
    const newButton = { ...oldButton, focus: vi.fn(), scrollIntoView: vi.fn() };
    let firsts = [oldButton];
    const card = { querySelectorAll: vi.fn(() => firsts) };
    const view = Render(1);
    view.cardRef.current = card as unknown as HTMLElement;
    view.afterAdd(() => {});
    Render(2); commit();
    expect(card.querySelectorAll).not.toHaveBeenCalled();
    // Portal's second commit supplies the new visible button before the animation frame.
    firsts = [oldButton, newButton];
    Render(2); commit();
    frame!();
    expect(oldButton.focus).not.toHaveBeenCalled();
    expect(newButton.focus).toHaveBeenCalledOnce();
    expect(newButton.scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
});

it('cancels queued Add focus when deleting a row or unmounting the list', () => {
    let view = Render(1);
    const cleanup = hooks.effects.find(effect => effect.mount)!.run() as () => void;
    view.afterAdd(() => {});
    view = Render(2); commit();
    view.remove(1);
    expect(cancel).toHaveBeenCalledWith(42);
    cancel.mockClear();
    view.afterAdd(() => {});
    Render(3); commit();
    cleanup();
    expect(cancel).toHaveBeenCalledWith(42);
});
