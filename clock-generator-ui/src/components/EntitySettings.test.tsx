// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { EntitySettings } from './EntitySettings';

type Props = Parameters<typeof EntitySettings>[0];
const props: Props = {
    label: 'Machine 1', actionContainerId: 'machine-actions', children: 'general-content',
    summary: openTab => <button onClick={() => openTab('Output Routes')}>machine-summary</button>,
    tabs: [{ label: 'Input Routes', content: 'input-content' }, { label: 'Output Routes', content: 'output-content' }, { label: 'Machine Facts', content: 'facts-content' }],
};
// the details toggle is portalled into the row's action container
const settings = (overrides: Partial<Props>) => <><div id="machine-actions" /><EntitySettings {...props} {...overrides} /></>;
function Render(overrides: Partial<Props> = {}) {
    const view = render(settings(overrides));
    return { user: userEvent.setup(), rerender: (next: Partial<Props>) => view.rerender(settings(next)) };
}
const details = () => screen.getByRole('button', { name: 'Entity details for Machine 1' });
const tab = (name: string) => screen.getByRole('tab', { name, hidden: true });
const hiddenPanels = () => screen.getAllByRole('tabpanel', { hidden: true }).map(panel => panel.hidden);

afterEach(() => { vi.restoreAllMocks(); });

it('labels the details toggle accessibly and starts closed with route tabs lazy until visited', async () => {
    const { user } = Render();
    expect(details().getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById(details().getAttribute('aria-controls')!)?.hidden).toBe(true);
    expect(screen.queryByRole('tablist', { hidden: true })).toBeNull();
    expect(screen.queryAllByRole('tabpanel', { hidden: true })).toHaveLength(0);

    await user.click(details());
    expect(screen.getByRole('tablist', { name: 'Machine 1 entity details' })).toBeDefined();
    expect(screen.getAllByRole('tab').map(element => element.textContent)).toEqual(['General', 'Input Routes', 'Output Routes', 'Machine Facts']);
    expect(hiddenPanels()).toEqual([false, true, true, true]);
    expect(screen.queryByText('input-content')).toBeNull();
    expect(screen.queryByText('output-content')).toBeNull();
    expect(screen.queryByText('facts-content')).toBeNull();
});

it('provides a visible focus target for Add and Duplicate when marked first', () => {
    Render({ first: true });
    const first = document.querySelectorAll('[data-row-first]');
    expect(first).toHaveLength(1);
    expect(first[0]).toBe(details());
    expect(details().getAttribute('aria-expanded')).toBe('false');
});

it('keeps the panel mounted but hidden when toggled closed and visits input and output tabs on selection', async () => {
    const { user } = Render();
    await user.click(details());
    await user.click(tab('Input Routes'));
    expect(hiddenPanels()).toEqual([true, false, true, true]);
    expect(screen.getByText('input-content')).toBeDefined();

    await user.click(tab('Output Routes'));
    expect(hiddenPanels()).toEqual([true, true, false, true]);
    expect(screen.getByText('output-content')).toBeDefined();

    await user.click(details());
    expect(document.getElementById(details().getAttribute('aria-controls')!)?.hidden).toBe(true);
    expect(screen.getByRole('tablist', { hidden: true })).toBeDefined();
});

it('opens the requested summary tab and requests focus for that tab', async () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    const { user } = Render();
    await user.click(screen.getByRole('button', { name: 'machine-summary' }));
    expect(hiddenPanels()).toEqual([true, true, false, true]);
    expect(document.activeElement).toBe(tab('Output Routes'));
    expect(focus.mock.contexts.at(-1)).toBe(tab('Output Routes'));
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
});

it('reveals General for a new field navigation request, including after another tab was visited', async () => {
    const { user, rerender } = Render();
    await user.click(details());
    await user.click(tab('Output Routes'));
    rerender({ request: { tab: 'General' } });
    expect(hiddenPanels()).toEqual([false, true, true, true]);
    expect(screen.getByText('general-content')).toBeDefined();
    expect(details().getAttribute('aria-expanded')).toBe('true');
});
