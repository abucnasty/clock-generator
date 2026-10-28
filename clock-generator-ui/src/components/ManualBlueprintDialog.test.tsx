// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TARGET_OUTPUT_HEADING_ID } from '../utils/introCard';
import { ManualBlueprintDialog } from './ManualBlueprintDialog';

let trigger: HTMLElement, toggle: HTMLElement, heading: HTMLElement;
/** Opens the dialog from what has focus, spoils what it hands focus back to, closes it and lets its recovery run */
async function close(spoil: () => void = () => {}) {
    const { unmount } = render(<ManualBlueprintDialog failure={{ blueprintString: '0actual-snapshot', rateWarning: null, staleFor: null, running: false }} onClose={vi.fn()} />);
    expect(screen.getByRole('textbox', { name: 'Blueprint string' })).toBe(document.activeElement);
    spoil();
    unmount();
    await Promise.resolve();
}
const notRendered = (element: HTMLElement) => vi.spyOn(element, 'getClientRects').mockReturnValue([] as unknown as DOMRectList);
beforeEach(() => {
    // a browser computes the initial visibility as visible; happy-dom leaves it empty unless it is set
    document.documentElement.style.visibility = 'visible';
    document.body.innerHTML = `<h2 id="${TARGET_OUTPUT_HEADING_ID}" tabindex="-1">Target output</h2>
        <div data-focus-fallback><button aria-pressed="true">Generate</button><button aria-pressed="false">Check only</button></div>
        <button>Copy blueprint</button>`;
    trigger = screen.getByRole('button', { name: 'Copy blueprint' });
    toggle = screen.getByRole('button', { name: 'Generate' });
    heading = screen.getByRole('heading', { name: 'Target output' });
});

describe('Manual snapshot post-MUI focus recovery', () => {
    it.each([
        { kind: 'body', open: () => {}, spoil: () => {} },
        { kind: 'html', open: () => document.documentElement.focus(), spoil: () => {} },
        // a real document falls back to its body
        { kind: 'disconnected', open: () => trigger.focus(), spoil: () => trigger.remove() },
        { kind: 'hidden', open: () => trigger.focus(), spoil: () => { trigger.hidden = true; } },
        { kind: 'not-rendered', open: () => trigger.focus(), spoil: () => { notRendered(trigger); } },
        { kind: 'invisible', open: () => trigger.focus(), spoil: () => { trigger.style.visibility = 'hidden'; } },
    ])('recovers $kind focus to the enabled selected workflow toggle', async ({ open, spoil }) => {
        open(); await close(spoil);
        expect(document.activeElement).toBe(toggle);
    });
    it('reads actual post-cleanup MUI restoration and preserves a rendered control or heading', async () => {
        trigger.focus(); await close();
        expect(document.activeElement).toBe(trigger);
        heading.focus(); await close();
        expect(document.activeElement).toBe(heading);
    });
    it('does not steal from another visible dialog while its autofocus is pending', async () => {
        await close(() => document.body.insertAdjacentHTML('beforeend', '<div role="dialog"></div>'));
        expect(document.activeElement).toBe(document.body);
    });
    it('hidden dialogs do not block recovery', async () => {
        await close(() => document.body.insertAdjacentHTML('beforeend', '<div role="dialog" hidden></div>'));
        expect(document.activeElement).toBe(toggle);
    });
    it.each(['disabled', 'aria-disabled'])('uses the rendered heading when the selected toggle is %s', async attribute => {
        toggle.setAttribute(attribute, attribute === 'disabled' ? '' : 'true'); await close();
        expect(document.activeElement).toBe(heading);
    });
    it('never focuses a hidden heading when neither fallback is usable', async () => {
        notRendered(toggle); notRendered(heading); await close();
        expect(document.activeElement).toBe(document.body);
    });
});
