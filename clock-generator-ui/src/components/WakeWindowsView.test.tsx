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
