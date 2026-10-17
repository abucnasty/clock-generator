import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TimelineRecording } from 'clock-generator/browser';
import { TimelinePauses } from './TimelinePauses';
const recording = { end_tick: 100, truncated: false, entities: [{ id: 'machine:1', signals: [{ id: 'state', ticks: [0, 40, 60, 80], values: ['working', 'item_ingredient_shortage', 'working', 'item_ingredient_shortage'] }] }] } as TimelineRecording;
it('starts collapsed, explains expected pauses and groups repeated ingredient shortages', () => {
    const html = renderToStaticMarkup(<TimelinePauses recording={recording} entityId="machine:1" targetMet onExplore={() => {}} />);
    const details = html.match(/<details[^>]*>/)?.[0];
    expect(details).toBeDefined();
    expect(details).not.toMatch(/\bopen(?:=|\s|>)/);
    expect(html).toContain('Explore pauses');
    expect(html).toContain('meets the assessed target despite its pauses');
    expect(html).toContain('Waiting for ingredients');
    expect(html).toContain('40 ticks across 2 pauses');
    expect(html).not.toContain('Investigate waits');
});
it('does not claim the target was met for an underperforming clock', () => {
    const html = renderToStaticMarkup(<TimelinePauses recording={recording} entityId="machine:1" targetMet={false} onExplore={() => {}} />);
    expect(html).toContain('A pause by itself does not explain a missed target');
    expect(html).not.toContain('meets the assessed target');
});
