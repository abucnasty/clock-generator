import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PickupGeometrySummary } from './PickupGeometrySummary';
import { PickupTypeSelect } from './PickupTypeSelect';

const build = { inserters: [{ id: 8, source: { type: 'belt', pickup_length: 1 } }, { id: 3, source: { type: 'belt' } }] };
const text = (html: string) => html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, '').replace(/<[^>]*>/g, '');

describe('pickup assumption presentation', () => {
    it('explains the default and underground opt-in for current and prospective builds', () => {
        const html = text(renderToStaticMarkup(<PickupGeometrySummary build={build} onEdit={() => {}} />));
        expect(html).toContain('Straight belt is the default');
        expect(html).toContain('Choose Underground belt for an entrance or exit');
        expect(html).not.toContain('missing');
        expect(html).not.toContain('older full-belt assumption');
    });
    it('preserves legacy saved-run assumptions and provides a specific inserter action', () => {
        const html = renderToStaticMarkup(<PickupGeometrySummary build={build} savedRun onEdit={() => {}} />);
        expect(text(html)).toContain('Pickup type known for 1 of 2 belt-fed inserters');
        expect(text(html)).toContain('older full-belt assumption');
        expect(html).toContain('Set pickup for Inserter 3');
        expect(html).not.toContain('Set pickup for Inserter 8');
    });
    it('does not imply missing geometry matters for backed-up timing', () => {
        const html = text(renderToStaticMarkup(<PickupGeometrySummary build={{ ...build, overrides: { non_moving_belts: true } }} />));
        expect(html).toContain('Backed-up input belts');
        expect(html).not.toContain('missing');
    });
    it('reports complete geometry without a missing-type action', () => {
        const html = text(renderToStaticMarkup(<PickupGeometrySummary build={{ inserters: [build.inserters[0]] }} savedRun />));
        expect(html).toContain('Pickup type known for all 1');
        expect(html).not.toContain('missing');
    });
    it('uses the same named picker for list and diagram without exposing fractional lengths', () => {
        for (const compact of [false, true]) {
            const html = renderToStaticMarkup(<PickupTypeSelect source={{ type: 'belt', id: 1, pickup_length: 0.5 }} compact={compact} entityLabel="Inserter 3" onChange={() => {}} />);
            expect(html).toContain('Underground belt');
            expect(html).toContain('Picks up from, Inserter 3');
            expect(text(html)).not.toContain('0.5');
        }
        expect(renderToStaticMarkup(<PickupTypeSelect source={{ type: 'machine', id: 1 }} entityLabel="Inserter 3" onChange={() => {}} />)).toBe('');
    });
    it('selects straight belt when geometry is omitted in either editor', () => {
        for (const compact of [false, true]) {
            const html = renderToStaticMarkup(<PickupTypeSelect source={{ type: 'belt', id: 1 }} compact={compact} entityLabel="Inserter 3" onChange={() => {}} />);
            expect(html).toContain('value="straight"');
            expect(text(html)).toContain('Straight belt');
            expect(html).not.toContain('Not specified');
        }
    });
});
