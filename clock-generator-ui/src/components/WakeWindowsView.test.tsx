// @vitest-environment happy-dom
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { show } from '../test/fixtures';
import { LEGEND_LABEL, LEGEND_SELECTED, LEGEND_TRACK, LEGEND_WINDOW, summaryText } from '../utils/wakeWindowCopy';
import type { ClockAlternativeView } from '../worker/types';
import { WakeWindowsView } from './WakeWindowsView';

const alternative = { simulationDurationTicks: 480, clockWindows: { 'inserter:1': [{ start: 0, end: 20 }] },
    stateTransitionHistory: { entities: [] }, asBuilt: null, fuelView: null,
} as unknown as ClockAlternativeView;

it.each([false, true])('places the legend before the first plotted row (cycle view: %s)', cycleView => {
    show(<WakeWindowsView alternative={alternative} cycleView={cycleView} asTable={false} onAsTableChange={() => {}} />);
    const legend = screen.getByRole('list', { name: LEGEND_LABEL });
    expect(legend.compareDocumentPosition(screen.getByRole('group', { name: /^Inserter 1\b/ })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(legend).getAllByRole('listitem').map(item => item.textContent))
        .toEqual([LEGEND_WINDOW, LEGEND_SELECTED, cycleView ? 'One output cycle' : LEGEND_TRACK]);
});

// an iron gear wheel build at 9.97 a second's selected clock: its window cycle is 2880000/997 ticks, and its blueprint counts 2888 ("clock rounded to 2888
// ticks, runs 0.02% fast")
it.each([
    { clock: 'a rounded clock', view: { ...alternative, simulationDurationTicks: 2880000 / 997, roundedWindowCycleTicks: 2888 }, windowCycleTicks: 2888,
        window_cycle: 'Window cycle time 2888 ticks (48.13 s)' },
    { clock: 'any other clock', view: alternative, windowCycleTicks: 480, window_cycle: 'Window cycle time 480 ticks (8 s)' },
])('heads $clock with the period its blueprint counts', ({ view, windowCycleTicks, window_cycle }) => {
    show(<WakeWindowsView alternative={view} asTable={false} onAsTableChange={() => {}} />);
    const subtitle = screen.getByText(/^Window cycle time /).textContent!;
    // one inserter, and no as-built run to count its wake-ups
    expect(subtitle).toBe(summaryText({ windowCycleTicks, inserters: 1, drills: 0, wakeUps: null }));
    // the copy has no test of its own: the window cycle reads in whole ticks and seconds, as the blueprint counts it
    expect(subtitle.split(' · ')[0]).toBe(window_cycle);
});

describe('the Enable windows chart\'s words', () => {
    it('ask to select an enable window and leave the keys to "Reading this chart"', () => {
        show(<WakeWindowsView alternative={alternative} asTable={false} onAsTableChange={() => {}} />);
        expect(screen.getByText('Select an enable window for details.')).toBeTruthy();
        expect(document.body.textContent).not.toContain('Use ↑ ↓ to change rows');
    });

    it('lead with the window cycle and the rows; the wakeups of one copy only where the card has none or another figure', () => {
        const args = { windowCycleTicks: 216, inserters: 2, drills: 0 };
        expect(summaryText({ ...args, wakeUps: 192.1 })).toBe('Window cycle time 216 ticks (3.6 s) · 2 inserters');
        expect(summaryText({ ...args, wakeUps: null })).toBe('Window cycle time 216 ticks (3.6 s) · 2 inserters · Wakeups not counted');
        expect(summaryText({ ...args, wakeUps: 192.1, fromColdStart: true }))
            .toBe('Window cycle time 216 ticks (3.6 s) · 2 inserters · 192 wakeups a minute for one copy from a cold start');
    });
});
