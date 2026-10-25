import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PickupGeometrySummary } from './PickupGeometrySummary';
import { PickupTypeSelect } from './PickupTypeSelect';
import { NearLaneSelect } from './NearLaneSelect';
import type { BeltFormData } from '../utils/configForm/formData';

const build = { inserters: [{ id: 8, source: { type: 'belt', pickup_length: 1 } }, { id: 3, source: { type: 'belt' } }] };
const text = (html: string) => html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, '').replace(/<[^>]*>/g, '');

describe('pickup assumption presentation', () => {
    it('explains the default and underground opt-in for current and prospective builds', () => {
        const html = text(renderToStaticMarkup(<PickupGeometrySummary build={build} onEdit={() => {}} />));
        expect(html).toContain('Straight belt is the default');
        expect(html).toContain('Choose the belt shape and pickup approach');
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
    it.each([
        { reason: 'splitter', entity_type: 'splitter', label: 'splitter', detail: 'Its pickup tile is a splitter.' },
        { reason: 'side-loaded', entity_type: 'transport-belt', label: 'side-loaded belt', detail: 'Another belt side-loads onto its pickup tile.' },
    ])('keeps an out-of-scope $reason pickup visible as not supported in the editor and saved-run summary', ({ reason, entity_type, label, detail }) => {
        const source = {type: 'belt' as const, id: 1, pickup_length: 1 as const,
            pickup_capture: {status: 'unsupported' as const, entity_type, reason, sidecar_version: '0.11.0'}};
        for (const compact of [false, true]) {
            const html = renderToStaticMarkup(<PickupTypeSelect source={source} compact={compact} entityLabel="Inserter 3" onChange={() => {}} />);
            expect(text(html)).toContain(`Not supported: ${label}`);
            expect(text(html)).toContain(detail);
            expect(text(html)).toContain('Splitters and side-loaded belt tiles are out of scope');
            expect(text(html)).not.toContain('Unverified capture');
            expect(html).toContain('aria-disabled="true"');
            expect(html).not.toContain('value="side-straight"');
        }
        for (const savedRun of [false, true]) {
            const summary = text(renderToStaticMarkup(<PickupGeometrySummary build={{inserters: [{id: 3, source}], overrides: {backed_up_belts: true}}} savedRun={savedRun} />));
            expect(summary).toContain('1 belt pickup is not supported and blocks generation.');
            expect(summary).toContain(`Not supported: Inserter 3 (${label}). Splitters and side-loaded belt tiles are out of scope.`);
            expect(summary).toContain('Rebuild the pickup as one of these, then recapture it with Sidecar.');
            expect(summary).not.toContain('(transport-belt)');
            expect(summary).not.toContain('Unverified:');
            expect(summary).not.toContain('Updating the mod alone does not update this saved capture');
            expect(summary).not.toContain('Saturated supply with captured pickup rules');
        }
    });
    it('keeps an unverified imported pickup apart from an out-of-scope one', () => {
        const bend = {type: 'belt' as const, id: 1, pickup_capture: {status: 'unsupported' as const, entity_type: 'transport-belt', reason: 'bend'}};
        const sideLoaded = {type: 'belt' as const, id: 2, pickup_capture: {status: 'unsupported' as const, entity_type: 'transport-belt', reason: 'side-loaded'}};
        const select = text(renderToStaticMarkup(<PickupTypeSelect source={bend} entityLabel="Inserter 4" onChange={() => {}} />));
        expect(select).toContain('Unverified capture');
        expect(select).toContain('A supported Sidecar capture is required');
        expect(select).not.toContain('out of scope');
        const summary = text(renderToStaticMarkup(<PickupGeometrySummary build={{inserters: [{id: 4, source: bend}, {id: 5, source: sideLoaded}]}} />));
        expect(summary).toContain('2 belt pickups need a supported capture before generation');
        expect(summary).toContain('Not supported: Inserter 5 (side-loaded belt).');
        expect(summary).toContain('Unverified: Inserter 4 (transport-belt). Update Sidecar and recapture when the geometry is supported.');
        expect(summary).toContain('Updating the mod alone does not update this saved capture');
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


it('names the measured right-bend layout and explains its fixed lane in either editor', () => {
    const source = {type: 'belt' as const, id: 1, pickup_layout: 'bend-right-upstream' as const, pickup_length: 1 as const,
        near_lane: 1 as const, pickup_capture: {status: 'supported' as const, model: 'belt' as const, model_version: 3 as const,
            entity_type: 'transport-belt' as const, sidecar_version: '0.15.0'}};
    const belts: BeltFormData[] = [{id: 1, _uuid: 'bend', type: 'turbo-transport-belt', lanes: [
        {ingredient: 'superconductor', stack_size: 4}, {ingredient: 'holmium-plate', stack_size: 4}]}];
    for (const compact of [false, true]) {
        const html = renderToStaticMarkup(<PickupTypeSelect source={source} compact={compact} entityLabel="Inserter 4" onChange={() => {}} />);
        expect(text(html)).toContain('Right bend — upstream pickup');
        expect(html).toContain('value="bend-right-upstream"');
        expect(text(html)).not.toContain('Unverified capture');
        const lane = text(renderToStaticMarkup(<NearLaneSelect source={source} belts={belts} compact={compact} entityLabel="Inserter 4" onChange={() => {}} />));
        expect(lane).toContain('This bend pickup takes from lane 1 first. Its supported layout fixes the lane.');
    }
    const summary = text(renderToStaticMarkup(<PickupGeometrySummary build={{inserters: [{id: 4, source}]}} savedRun />));
    expect(summary).toContain('Pickup type known for all 1');
    expect(summary).not.toContain('missing');
});
