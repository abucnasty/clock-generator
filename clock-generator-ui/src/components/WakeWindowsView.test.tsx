import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ClockAlternativeView } from '../worker/types';
import { WakeWindowsView } from './WakeWindowsView';

const alternative = { simulationDurationTicks: 480, clockWindows: { 'inserter:1': [{ start: 0, end: 20 }] },
    stateTransitionHistory: { entities: [] }, asBuilt: null, fuelView: null,
} as unknown as ClockAlternativeView;

it.each([false, true])('places the legend before the first plotted row (cycle view: %s)', cycleView => {
    const html = renderToStaticMarkup(<WakeWindowsView alternative={alternative} cycleView={cycleView} asTable={false} onAsTableChange={() => {}} />);
    const legend = html.indexOf('data-wake-legend');
    expect(legend).toBeGreaterThan(0);
    expect(legend).toBeLessThan(html.indexOf('data-wake-row="inserter:1"'));
    expect(html).toContain(cycleView ? 'One crafting cycle' : 'One clock period');
});

// Atlan cell 29's selected clock: its period is 2880000/997 ticks, and its blueprint counts 2888 ("clock rounded to 2888
// ticks, runs 0.02% fast")
it('heads a rounded clock with the period its blueprint counts, and any other clock with its own', () => {
    const rounded = { ...alternative, simulationDurationTicks: 2880000 / 997, roundedPeriodTicks: 2888 };
    const html = renderToStaticMarkup(<WakeWindowsView alternative={rounded} asTable={false} onAsTableChange={() => {}} />);
    expect(html).toContain('Clock period 2888 ticks (48.13 s)');
    expect(html).not.toContain('Clock period 2888.67');
    expect(renderToStaticMarkup(<WakeWindowsView alternative={alternative} asTable={false} onAsTableChange={() => {}} />))
        .toContain('Clock period 480 ticks (8 s)');
});
