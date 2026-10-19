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
        expect(html).toContain('Choose the underground endpoint and pickup approach');
        expect(html).not.toContain('missing');
        expect(html).not.toContain('Saved results retain their original timing assumptions');
    });
    it('preserves legacy saved-run assumptions and provides a specific inserter action', () => {
        const html = renderToStaticMarkup(<PickupGeometrySummary build={build} savedRun onEdit={() => {}} />);
        expect(text(html)).toContain('Pickup type known for 1 of 2 belt-fed inserters');
        expect(text(html)).toContain('Saved results retain their original timing assumptions');
        expect(html).toContain('Set pickup for Inserter 3');
        expect(html).not.toContain('Set pickup for Inserter 8');
    });
    it('does not imply missing geometry matters for backed-up timing', () => {
        const html = text(renderToStaticMarkup(<PickupGeometrySummary build={{ ...build, overrides: { backed_up_belts: true } }} />));
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
            expect(html).toContain('Choose underground layout');
            expect(html).toContain('Picks up from, Inserter 3');
            expect(text(html)).not.toContain('0.5');
        }
        expect(renderToStaticMarkup(<PickupTypeSelect source={{ type: 'machine', id: 1 }} entityLabel="Inserter 3" onChange={() => {}} />)).toBe('');
    });
    it('keeps an unsupported imported pickup visible in the editor and saved-run summary', () => {
        const source = {type: 'belt' as const, id: 1, pickup_length: 1 as const,
            pickup_capture: {status: 'unsupported' as const, entity_type: 'splitter', reason: 'splitter', sidecar_version: '0.11.0'}};
        const html = renderToStaticMarkup(<PickupTypeSelect source={source} entityLabel="Inserter 3" onChange={() => {}} />);
        expect(text(html)).toContain('Unverified capture');
        expect(html).toContain('aria-disabled="true"');
        expect(html).not.toContain('value="side-straight"');
        for (const savedRun of [false, true]) {
            const summary = text(renderToStaticMarkup(<PickupGeometrySummary build={{inserters: [{id: 3, source}], overrides: {backed_up_belts: true}}} savedRun={savedRun} />));
            expect(summary).toContain('pickup needs a supported capture before generation');
            expect(summary).toContain('Updating the mod alone does not update this saved capture');
            expect(summary).not.toContain('Saturated supply with captured pickup rules');
        }
    });
    it('selects straight belt when geometry is omitted in either editor', () => {
        for (const compact of [false, true]) {
            const html = renderToStaticMarkup(<PickupTypeSelect source={{ type: 'belt', id: 1 }} compact={compact} entityLabel="Inserter 3" onChange={() => {}} />);
            expect(html).toContain('value="side-straight"');
            expect(text(html)).toContain('Straight belt');
            expect(html).not.toContain('Not specified');
        }
    });
});

it('requires a manual underground layout for moving and backed-up inputs', () => {
    for (const backed_up_belts of [false, true]) {
        const html = text(renderToStaticMarkup(<PickupGeometrySummary build={{inserters: [{id: 4,
            source: {type: 'belt', pickup_length: 0.5}}], overrides: {backed_up_belts}}} onEdit={() => {}} />));
        expect(html).toContain('Choose a pickup layout before generating again');
        expect(html).toContain('Set pickup for Inserter 4');
    }
});
