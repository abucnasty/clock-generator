// @vitest-environment happy-dom
import { screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { show } from '../test/fixtures';
import { LEGEND_LABEL, LEGEND_SELECTED, LEGEND_SLACK, LEGEND_TRACK, LEGEND_WINDOW, summaryText } from '../utils/wakeWindowCopy';
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
        .toEqual([LEGEND_WINDOW, LEGEND_SLACK, LEGEND_SELECTED, cycleView ? 'One crafting cycle' : LEGEND_TRACK]);
});

// Atlan cell 29's selected clock: its period is 2880000/997 ticks, and its blueprint counts 2888 ("clock rounded to 2888
// ticks, runs 0.02% fast")
it.each([
    { clock: 'a rounded clock', view: { ...alternative, simulationDurationTicks: 2880000 / 997, roundedPeriodTicks: 2888 }, periodTicks: 2888,
        period: 'Clock period 2888 ticks (48.13 s)' },
    { clock: 'any other clock', view: alternative, periodTicks: 480, period: 'Clock period 480 ticks (8 s)' },
])('heads $clock with the period its blueprint counts', ({ view, periodTicks, period }) => {
    show(<WakeWindowsView alternative={view} asTable={false} onAsTableChange={() => {}} />);
    const subtitle = screen.getByText(/^Clock period /).textContent!;
    // one inserter, and no as-built run to count its wake-ups
    expect(subtitle).toBe(summaryText({ periodTicks, inserters: 1, drills: 0, wakeUps: null }));
    // the copy has no test of its own: the period reads in whole ticks and seconds, as the blueprint counts it
    expect(subtitle.split(' · ')[0]).toBe(period);
});
