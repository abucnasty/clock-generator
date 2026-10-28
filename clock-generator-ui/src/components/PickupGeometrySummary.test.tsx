// @vitest-environment happy-dom
import { screen } from '@testing-library/react';
import { BELT_PICKUP_LAYOUT_LABELS } from 'clock-generator/light';
import { expect, it, vi } from 'vitest';
import { belt, inserter, show } from '../test/fixtures';
import type { InserterFormData } from '../utils/configForm/formData';
import { OUT_OF_SCOPE_PICKUP_SCOPE, OUT_OF_SCOPE_PICKUPS } from '../utils/pickupGeometry';
import { NearLaneSelect } from './NearLaneSelect';
import { PickupGeometrySummary } from './PickupGeometrySummary';
import { PickupTypeSelect } from './PickupTypeSelect';

type Source = InserterFormData['source'];
const fromBelt = (fields: Partial<Source> = {}): Source => ({ type: 'belt', id: 1, ...fields });
/** Inserter 8 picks up from a straight belt; inserter 3, saved before pickup types, from a belt of no known type */
const twoInputs = { inserters: [inserter(8, { source: fromBelt({ pickup_length: 1 }) }), inserter(3, { source: fromBelt() })] };
const underground = { inserters: [inserter(4, { source: fromBelt({ pickup_length: 0.5 }) })] };
const bend = fromBelt({ pickup_layout: 'bend-right-upstream', pickup_length: 1, near_lane: 1, pickup_capture: { status: 'supported', model: 'belt',
    model_version: 3, entity_type: 'transport-belt', sidecar_version: '0.15.0' } });
/** A pickup Sidecar recorded but the generator cannot use, and why */
const unsupported = (reason: string) => fromBelt({ pickup_capture: { status: 'unsupported', entity_type: 'transport-belt', reason } });
const STRAIGHT_DEFAULT = 'Moving input belts · Straight belt is the default. Choose the belt shape and pickup approach.';
const BACKED_UP = 'Backed-up input belts · Saturated supply with captured pickup rules.';
const KNOWN_FOR_ALL = 'Moving input belts · Pickup type known for all 1 belt-fed inserter.';

/** The List row's picker and the diagram's, both of Inserter 3 */
function showPickers(source: Source) {
    const view = show(<>{[false, true].map(compact => <PickupTypeSelect key={String(compact)} source={source} compact={compact} entityLabel="Inserter 3" onChange={vi.fn()} />)}</>);
    return { ...view, pickers: screen.getAllByRole('combobox', { name: 'Picks up from, Inserter 3' }) };
}
/** What each picker described by `description` shows, and whether it is disabled */
const lockedPickers = (description: string) => screen.getAllByRole('combobox', { name: 'Picks up from, Inserter 3', description })
    .map(picker => [picker.textContent, picker.getAttribute('aria-disabled')]);

it.each([
    { why: 'a current build', build: twoInputs, savedRun: false, says: STRAIGHT_DEFAULT },
    { why: 'backed-up belts', build: { ...twoInputs, overrides: { backed_up_belts: true } }, savedRun: false, says: BACKED_UP },
    { why: 'a saved run of complete geometry', build: { inserters: [twoInputs.inserters[0]] }, savedRun: true, says: KNOWN_FOR_ALL },
    { why: 'a saved run of a measured right bend', build: { inserters: [inserter(4, { source: bend })] }, savedRun: true, says: KNOWN_FOR_ALL },
])('explains the pickup assumption of $why without asking for a missing type', ({ build, savedRun, says }) => {
    show(<PickupGeometrySummary build={build} savedRun={savedRun} onEdit={vi.fn()} />);
    expect(screen.getByText(says)).toBeDefined();
    expect(screen.queryByText(/missing|Saved results retain/)).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
});

it.each([
    { why: 'a legacy saved run', build: twoInputs, savedRun: true, says: 'Moving input belts · Pickup type known for 1 of 2 belt-fed inserters.', id: 3 },
    { why: 'a moving underground pickup', build: underground, savedRun: false, says: STRAIGHT_DEFAULT, id: 4 },
    { why: 'a backed-up underground pickup', build: { ...underground, overrides: { backed_up_belts: true } }, savedRun: false, says: BACKED_UP, id: 4 },
])('asks for the pickup layout of each inserter that lacks one in $why', async ({ build, savedRun, says, id }) => {
    const onEdit = vi.fn();
    const { user } = show(<PickupGeometrySummary build={build} savedRun={savedRun} onEdit={onEdit} />);
    expect(screen.getByText(says)).toBeDefined();
    expect(screen.getByText('Pickup type is missing for 1 inserter. Choose a pickup layout before generating again. Saved results retain their original timing assumptions.')).toBeDefined();
    expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual([`Set pickup for Inserter ${id}`]);
    await user.click(screen.getByRole('button'));
    expect(onEdit).toHaveBeenCalledExactlyOnceWith(id);
});

it.each([
    { why: 'straight belt for omitted geometry', source: fromBelt(), shown: BELT_PICKUP_LAYOUT_LABELS['side-straight'] },
    { why: 'an underground layout to choose', source: fromBelt({ pickup_length: 0.5 }), shown: 'Choose underground layout' },
    { why: 'the measured right-bend layout', source: bend, shown: BELT_PICKUP_LAYOUT_LABELS['bend-right-upstream'] },
])('selects $why in the same named picker of the list and the diagram, never a fractional length', async ({ source, shown }) => {
    const { user, pickers } = showPickers(source);
    expect(pickers.map(picker => picker.textContent)).toEqual([shown, shown]);
    await user.click(pickers[0]);
    expect(screen.getByRole('option', { selected: true }).textContent).toBe(shown);
    expect(screen.queryByText(/0\.5|Not specified|Unverified capture/)).toBeNull();
});

it('shows no pickup picker for an inserter that does not take from a belt', () => {
    const { container } = show(<PickupTypeSelect source={{ type: 'machine', id: 1 }} entityLabel="Inserter 3" onChange={vi.fn()} />);
    expect(container.firstChild).toBeNull();
});

it.each([
    { reason: 'splitter', entity_type: 'splitter' },
    { reason: 'side-loaded', entity_type: 'transport-belt' },
] as const)('keeps an out-of-scope $reason pickup visible as not supported in the editor and saved-run summary', ({ reason, entity_type }) => {
    const { label, detail } = OUT_OF_SCOPE_PICKUPS[reason];
    const source = fromBelt({ pickup_length: 1, pickup_capture: { status: 'unsupported', entity_type, reason, sidecar_version: '0.11.0' } });
    const { unmount } = showPickers(source);
    const shown = `Not supported: ${label}`;
    expect(lockedPickers(`This imported pickup is not supported. ${detail} ${OUT_OF_SCOPE_PICKUP_SCOPE}`)).toEqual([[shown, 'true'], [shown, 'true']]);
    unmount();
    for (const savedRun of [false, true]) {
        const { unmount } = show(<PickupGeometrySummary build={{ inserters: [inserter(3, { source })], overrides: { backed_up_belts: true } }} savedRun={savedRun} />);
        expect(screen.getByText('1 belt pickup is not supported and blocks generation.')).toBeDefined();
        // named by what puts it out of scope, never by its entity type
        expect(screen.getByText(`Not supported: Inserter 3 (${label}). ${OUT_OF_SCOPE_PICKUP_SCOPE}`)).toBeDefined();
        expect(screen.queryByText(/\(transport-belt\)|Unverified|Updating the mod alone|Saturated supply/)).toBeNull();
        unmount();
    }
});

it('keeps an unverified imported pickup apart from an out-of-scope one', () => {
    const { unmount } = showPickers(unsupported('bend'));
    const shown = 'Unverified capture';
    expect(lockedPickers('This imported pickup is unverified. A supported Sidecar capture is required; choosing a default cannot classify it.'))
        .toEqual([[shown, 'true'], [shown, 'true']]);
    expect(screen.queryByText(/out of scope/)).toBeNull();
    unmount();
    show(<PickupGeometrySummary build={{ inserters: [inserter(4, { source: unsupported('bend') }), inserter(5, { source: unsupported('side-loaded') })] }} />);
    expect(screen.getByText('2 belt pickups need a supported capture before generation. Recorded unsupported or unclassified pickups are retained when this build is saved.')).toBeDefined();
    expect(screen.getByText(`Not supported: Inserter 5 (${OUT_OF_SCOPE_PICKUPS['side-loaded'].label}). ${OUT_OF_SCOPE_PICKUP_SCOPE}`)).toBeDefined();
    expect(screen.getByText('Unverified: Inserter 4 (transport-belt). Update Sidecar and recapture when the geometry is supported.'
        + ' Updating the mod alone does not update this saved capture.')).toBeDefined();
});

it('explains the fixed lane of a measured right bend in either editor', () => {
    const belts = [belt(1, { lanes: [{ ingredient: 'superconductor', stack_size: 4 }, { ingredient: 'holmium-plate', stack_size: 4 }] })];
    show(<>{[false, true].map(compact => <NearLaneSelect key={String(compact)} source={bend} belts={belts} compact={compact} entityLabel="Inserter 4" onChange={vi.fn()} />)}</>);
    expect(screen.getAllByRole('combobox', { name: 'Nearest lane of the belt, Inserter 4',
        description: 'This bend pickup takes from lane 1 first. Its supported layout fixes the lane.' })).toHaveLength(2);
});
