import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_INSPECTION } from '../utils/timelineInspection';
import { TimelineSignals } from './TimelineSignals';

it('makes states-only an explicitly selected preset inside the signals disclosure', () => {
    const html = renderToStaticMarkup(<TimelineSignals signals={['state']} onChange={() => {}} />);
    expect(html).toContain('Signals · States only');
    expect(html).toContain('aria-label="Signal preset"');
    expect(html).toMatch(/<button[^>]*value="states"[^>]*aria-pressed="true"/);
});
it('distinguishes default and custom signals without adding another timeline view', () => {
    const standard = renderToStaticMarkup(<TimelineSignals signals={DEFAULT_INSPECTION.signals} onChange={() => {}} />);
    expect(standard).toContain('Signals · Default');
    const custom = renderToStaticMarkup(<TimelineSignals signals={['state', 'hand']} onChange={() => {}} />);
    expect(custom).toContain('Signals · 2 selected');
    expect(custom).not.toContain('aria-pressed="true"');
});
