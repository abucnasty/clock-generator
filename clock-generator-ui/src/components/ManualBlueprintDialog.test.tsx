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
    it.each<{ when: string; before?: () => void; spoil?: () => void; focused: 'toggle' | 'trigger' | 'heading' | 'body' }>([
        { when: 'MUI restores to the body', focused: 'toggle' },
        { when: 'MUI restores to html', before: () => document.documentElement.focus(), focused: 'toggle' },
        // a real document falls back to its body
        { when: 'MUI restores to a disconnected trigger', before: () => trigger.focus(), spoil: () => trigger.remove(), focused: 'toggle' },
        { when: 'MUI restores to a hidden trigger', before: () => trigger.focus(), spoil: () => { trigger.hidden = true; }, focused: 'toggle' },
        { when: 'MUI restores to a not-rendered trigger', before: () => trigger.focus(), spoil: () => { notRendered(trigger); }, focused: 'toggle' },
        { when: 'MUI restores to an invisible trigger', before: () => trigger.focus(), spoil: () => { trigger.style.visibility = 'hidden'; }, focused: 'toggle' },
        { when: 'MUI restores to a rendered control', before: () => trigger.focus(), focused: 'trigger' },
        { when: 'MUI restores to a rendered heading', before: () => heading.focus(), focused: 'heading' },
        { when: 'a visible dialog has yet to autofocus', spoil: () => document.body.insertAdjacentHTML('beforeend', '<div role="dialog"></div>'), focused: 'body' },
        { when: 'only a hidden dialog is open', spoil: () => document.body.insertAdjacentHTML('beforeend', '<div role="dialog" hidden></div>'), focused: 'toggle' },
        { when: 'the selected toggle is disabled', before: () => toggle.setAttribute('disabled', ''), focused: 'heading' },
        { when: 'the selected toggle is aria-disabled', before: () => toggle.setAttribute('aria-disabled', 'true'), focused: 'heading' },
        { when: 'neither toggle nor heading is rendered', before: () => { notRendered(toggle); notRendered(heading); }, focused: 'body' },
    ])('$when, focus ends on the $focused', async ({ before, spoil, focused }) => {
        before?.(); await close(spoil);
        expect(document.activeElement).toBe({ toggle, trigger, heading, body: document.body }[focused]);
    });
});
