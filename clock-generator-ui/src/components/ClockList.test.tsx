// @vitest-environment happy-dom
import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { show } from '../test/fixtures';
import { AUTOMATION_240, MILITARY_240, viewsOf } from '../test/checkedLanesFixtures';
import { statusOf } from '../utils/clockSummary';
import { RECOMMENDED_COPY, rankOrderOf } from '../utils/recommendedClock';
import { strategyNameOf } from '../utils/strategyNames';
import type { ClockAlternativeView } from '../worker/types';
import { ClockList } from './ClockList';

type Options = { pending?: string[]; running?: boolean; onSelect?: (index: number) => void; onCompare?: () => void; notice?: React.ReactNode };
const listOf = (alternatives: ClockAlternativeView[], selectedIndex: number, options: Options = {}) =>
    <ClockList alternatives={alternatives} selectedIndex={selectedIndex} onSelect={options.onSelect ?? (() => {})}
        onCompare={options.onCompare ?? (() => {})} pending={options.pending} running={options.running} notice={options.notice} />;
const list = (alternatives: ClockAlternativeView[], selectedIndex: number, options: Options = {}) => show(listOf(alternatives, selectedIndex, options));

const group = () => screen.getByRole('radiogroup', { name: 'Clocks' });
/** The rows from the top, each the rank and the id of its clock */
const rowsOf = (alternatives: ClockAlternativeView[]) => within(group()).getAllByRole('radio').map(radio => {
    const row = radio.closest<HTMLElement>('[data-clock-row]')!;
    return [row.querySelector('[data-rank]')!.textContent, alternatives.find(view => view.id === row.dataset.clockRow)!.id];
});

describe('the list of clocks', () => {
    const views = viewsOf(AUTOMATION_240);
    const selected = AUTOMATION_240.selected_index;

    it('has a row for every clock, each with its rank, name, swings, wakeups, signals and status mark', () => {
        list(views, selected);
        const order = rankOrderOf(views);
        expect(rowsOf(views)).toEqual(order.map((index, at) => [`${at + 1}`, views[index].id]));
        for (const view of views) {
            const row = document.querySelector<HTMLElement>(`[data-clock-row="${view.id}"]`)!;
            expect(row.querySelector('[data-clock-name]')!.textContent).toBe(strategyNameOf(view));
            expect(row.querySelector('[data-clock-swings]')!.textContent).toMatch(new RegExp(`^${view.terminalSwingCount} swings?`));
            const wakeUps = view.assessment.wake_ups_per_minute;
            expect(row.querySelector('[data-wake-ups]')!.textContent).toBe(wakeUps === null ? '—' : `${Math.round(wakeUps)}`);
            expect(row.querySelector('[data-status-mark]')!.getAttribute('data-status-mark')).toBe(statusOf(view).kind);
        }
    });

    it('keeps both groups, every clock shown: the Stable ones, then the others under their divider', () => {
        list(views, selected);
        const rows = [...group().querySelectorAll<HTMLElement>('[data-clock-row], [data-clock-divider]')];
        const divider = rows.findIndex(row => row.hasAttribute('data-clock-divider'));
        expect(rows[divider].textContent).toBe(RECOMMENDED_COPY.unstableDivider);
        const kinds = rows.map(row => row.dataset.clockRow && statusOf(views.find(view => view.id === row.dataset.clockRow)!).kind);
        expect(kinds.slice(0, divider).every(kind => kind === 'stable')).toBe(true);
        expect(kinds.slice(divider + 1).every(kind => kind !== 'stable')).toBe(true);
        expect(rows.length - 1).toBe(views.length);
    });

    it('marks the selected clock, names each clock in full with its figures and its status once, and selects a clock on a press', async () => {
        const onSelect = vi.fn();
        const { user } = list(views, selected, { onSelect });
        const radios = within(group()).getAllByRole('radio');
        expect(radios.filter(radio => (radio as HTMLInputElement).checked).map(radio => radio.closest<HTMLElement>('[data-clock-row]')!.dataset.clockRow))
            .toEqual([views[selected].id]);
        const off = views.findIndex(view => view.id === 'euclidean_swings');
        const status = statusOf(views[off]);
        const name = radios.find(radio => radio.closest<HTMLElement>('[data-clock-row]')!.dataset.clockRow === 'euclidean_swings')!.getAttribute('aria-label')!;
        expect(name.split(status.text)).toHaveLength(2);
        expect(name).toContain(`${Math.round(views[off].assessment.signals_per_minute ?? 0)} signals a minute`);
        await user.click(document.querySelector<HTMLElement>('[data-clock-row="euclidean_swings"] [data-clock-name]')!);
        expect(onSelect).toHaveBeenLastCalledWith(off);
    });

    it('is one tab stop, and the arrow keys move through the clocks and select each', async () => {
        const { user, rerender } = list(views, selected, { onSelect: index => rerender(listOf(views, index, { onSelect: () => {} })) });
        const order = rankOrderOf(views);
        // Compare all, then the selected clock, then out of the list
        await user.tab();
        expect(document.activeElement!.textContent).toBe(`Compare all ${views.length}`);
        await user.tab();
        expect(document.activeElement!.closest<HTMLElement>('[data-clock-row]')!.dataset.clockRow).toBe(views[selected].id);
        await user.tab();
        expect(document.activeElement!.closest('[role="radiogroup"]')).toBeNull();
        await user.tab({ shift: true });
        const at = order.indexOf(selected);
        await user.keyboard('{ArrowDown}');
        expect(document.activeElement!.closest<HTMLElement>('[data-clock-row]')!.dataset.clockRow).toBe(views[order[at + 1]].id);
    });

    it('selects the clock an arrow key moves to', async () => {
        const onSelect = vi.fn();
        const { user } = list(views, selected, { onSelect });
        const order = rankOrderOf(views);
        await user.tab();
        await user.tab();
        await user.keyboard('{ArrowDown}');
        expect(onSelect).toHaveBeenLastCalledWith(order[order.indexOf(selected) + 1]);
    });

    it('shows the clocks still computing, with no rank and no way to select them', () => {
        list(views, selected, { pending: ['Pitch Pickups'] });
        const computing = screen.getByText('Pitch Pickups: computing…').closest('[data-clock-pending]')!;
        expect(computing.querySelector('input')).toBeNull();
        expect(group().contains(computing)).toBe(false);
    });

    it('opens the compare table from "Compare all N", a button with a table mark and no arrow', async () => {
        const onCompare = vi.fn();
        const { user } = list(views, selected, { onCompare });
        const button = screen.getByRole('button', { name: `Compare all ${views.length}` });
        expect(button.querySelector('[data-testid="TableChartOutlinedIcon"]')).not.toBeNull();
        expect(button.querySelector('[data-testid*="Expand"], [data-testid*="Arrow"], [data-testid*="Chevron"]')).toBeNull();
        expect(button.hasAttribute('aria-expanded')).toBe(false);
        await user.click(button);
        expect(onCompare).toHaveBeenCalledOnce();
    });

    it('shows the notice under the rows', () => {
        list(views, selected, { notice: <p data-testid="notice">Search deeper</p> });
        expect(screen.getByTestId('notice')).toBeTruthy();
    });
});

describe('the list of clocks while a run goes', () => {
    const views = viewsOf(MILITARY_240);
    const recommended = views[MILITARY_240.selected_index];
    const before = views.filter(view => view !== recommended);

    it('holds its rows in the order the clocks completed, and the ranks change in place', () => {
        const { rerender } = list(before, 0, { pending: [recommended.label], running: true });
        const earlier = rowsOf(before);
        rerender(listOf(views, 0, { running: true }));
        const later = rowsOf(views);
        expect(later.filter(([, id]) => id !== recommended.id)).toEqual(earlier.map(([rank, id]) => [`${Number(rank) + 1}`, id]));
        expect(later.find(([, id]) => id === recommended.id)![0]).toBe('1');
        expect(later[0][1]).not.toBe(recommended.id);
    });

    it('sorts the rows by rank once, when the run ends', () => {
        const { rerender } = list(before, 0, { running: true });
        rerender(listOf(views, 0, { running: true }));
        rerender(listOf(views, 0, { running: false }));
        const order = rankOrderOf(views);
        expect(rowsOf(views)).toEqual(order.map((index, at) => [`${at + 1}`, views[index].id]));
    });
});
