import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ManualBlueprintDialog } from './ManualBlueprintDialog';

const effects = vi.hoisted(() => ({ cleanup: undefined as (() => void) | undefined }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(), useId: () => 'manual-test',
    useRef: () => ({ current: null }), useEffect: (effect: () => (() => void)) => { effects.cleanup = effect(); } }));
vi.mock('../hooks/useGameNames', () => ({ useGameNames: () => ({ recipeLabel: (id: string) => id }) }));

class ElementStub {
    isConnected = true;
    rendered = true;
    hidden = false;
    visibility = 'visible';
    disabled = false;
    focus = vi.fn(() => { documentStub.activeElement = this; });
    getClientRects() { return this.rendered ? [{}] : []; }
    closest() { return this.hidden ? this : null; }
    matches() { return this.disabled; }
}
let documentStub: { body: ElementStub; documentElement: ElementStub; activeElement: ElementStub | null;
    querySelector: () => ElementStub | null; querySelectorAll: () => ElementStub[]; getElementById: () => ElementStub | null };
let toggle: ElementStub | null, heading: ElementStub | null, dialogs: ElementStub[];
function render() {
    ManualBlueprintDialog({ failure: { blueprintString: '0actual-snapshot', rateWarning: null, staleFor: null, running: false }, onClose: vi.fn() });
}
async function close() { render(); effects.cleanup!(); await Promise.resolve(); }
beforeEach(() => {
    toggle = new ElementStub(); heading = new ElementStub(); dialogs = [];
    const body = new ElementStub(), documentElement = new ElementStub();
    documentStub = { body, documentElement, activeElement: body, querySelector: () => toggle,
        querySelectorAll: () => dialogs, getElementById: () => heading };
    vi.stubGlobal('document', documentStub); vi.stubGlobal('HTMLElement', ElementStub);
    vi.stubGlobal('getComputedStyle', (element: ElementStub) => ({ visibility: element.visibility }));
});
afterEach(() => vi.unstubAllGlobals());

describe('Manual snapshot post-MUI focus recovery', () => {
    it.each(['body', 'html', 'disconnected', 'hidden', 'not-rendered', 'invisible'] as const)('recovers %s focus to the enabled selected workflow toggle', async kind => {
        const active = new ElementStub();
        if (kind === 'disconnected') active.isConnected = false;
        if (kind === 'hidden') active.hidden = true;
        if (kind === 'not-rendered') active.rendered = false;
        if (kind === 'invisible') active.visibility = 'hidden';
        documentStub.activeElement = kind === 'body' ? documentStub.body : kind === 'html' ? documentStub.documentElement : active;
        await close(); expect(toggle!.focus).toHaveBeenCalledOnce(); expect(heading!.focus).not.toHaveBeenCalled();
    });
    it('reads actual post-cleanup MUI restoration and preserves a rendered control or heading', async () => {
        render(); const restored = new ElementStub(); documentStub.activeElement = restored;
        effects.cleanup!(); await Promise.resolve();
        expect(toggle!.focus).not.toHaveBeenCalled(); expect(heading!.focus).not.toHaveBeenCalled();
    });
    it('does not steal from another visible dialog while its autofocus is pending', async () => {
        dialogs = [new ElementStub()]; await close();
        expect(toggle!.focus).not.toHaveBeenCalled(); expect(heading!.focus).not.toHaveBeenCalled();
    });
    it('hidden dialogs do not block recovery', async () => {
        const old = new ElementStub(); old.hidden = true; dialogs = [old]; await close();
        expect(toggle!.focus).toHaveBeenCalledOnce();
    });
    it('uses the rendered heading when the selected toggle is disabled', async () => {
        toggle!.disabled = true; await close(); expect(toggle!.focus).not.toHaveBeenCalled(); expect(heading!.focus).toHaveBeenCalledOnce();
    });
    it('never focuses a hidden heading when neither fallback is usable', async () => {
        toggle!.rendered = false; heading!.rendered = false; await close();
        expect(toggle!.focus).not.toHaveBeenCalled(); expect(heading!.focus).not.toHaveBeenCalled();
    });
});
