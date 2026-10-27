import { pickupLengthForLayout, type BeltPickupLayout } from 'clock-generator/light';
import type { InserterFormData } from './configForm/formData';

export type PickupType = BeltPickupLayout;
type Source = InserterFormData['source'];
type Capture = Source['pickup_capture'];

/** A capture that cannot drive generation: recorded as unsupported or unclassified, or an old underground declaration */
const isUnverified = (capture: Capture) => capture !== undefined
    && (capture.status !== 'supported' || (capture.model_version === 1 && capture.entity_type === 'underground-belt'));

export function pickupTypeOf(source: Source): PickupType | 'underground' | 'unverified' {
    if (isUnverified(source.pickup_capture)) return 'unverified';
    return source.pickup_layout ?? (source.pickup_length === 0.5 ? 'underground' : 'side-straight');
}

/** A pickup that the clock generator leaves out on purpose, by the reason its capture gives */
type OutOfScopePickup = 'splitter' | 'side-loaded';

/** How an out-of-scope pickup is named, and what makes it one */
export const OUT_OF_SCOPE_PICKUPS: Readonly<Record<OutOfScopePickup, { label: string; detail: string }>> = {
    'splitter': { label: 'splitter', detail: 'Its pickup tile is a splitter.' },
    'side-loaded': { label: 'side-loaded belt', detail: 'Another belt side-loads onto its pickup tile.' },
};

/** Why no update of Sidecar or recapture makes an out-of-scope pickup supported, and what to build instead */
export const OUT_OF_SCOPE_PICKUP_SCOPE = 'Splitters and side-loaded belt tiles are out of scope.'
    + ' Use a supported straight belt, bend or underground pickup.'
    + ' Rebuild the pickup as one of these, then recapture it with Sidecar.';

/**
 * The out-of-scope pickup an imported capture records, or null. Only the reasons that the engine refuses as out of
 * scope count; any other unsupported capture stays unverified.
 */
export function unsupportedPickupOf(source: { pickup_capture?: Capture }): OutOfScopePickup | null {
    const capture = source.pickup_capture;
    if (capture?.status !== 'unsupported') return null;
    const reason = capture.reason;
    return reason === 'splitter' || reason === 'side-loaded' ? reason : null;
}

export function withPickupType(source: Source, type: PickupType): Source {
    if (source.type !== 'belt' || pickupTypeOf(source) === 'unverified') return source;
    const length = pickupLengthForLayout(type);
    const updated = { ...source, pickup_length: length, pickup_layout: type,
        ...(type === 'bend-right-upstream' && {near_lane: 1 as const}) };
    // A deliberate geometry edit becomes a manual configuration, not a new physical capture.
    if (pickupTypeOf(source) !== type || updated.near_lane !== source.near_lane) delete updated.pickup_capture;
    return updated;
}

/** Make the UI's straight-belt default explicit for generation and export, including older saved forms. */
export function withDefaultPickupType(source: Source): Source {
    return source.type === 'belt' && source.pickup_length === undefined
        ? {...source, pickup_length: source.pickup_layout ? pickupLengthForLayout(source.pickup_layout) : 1} : source;
}

export interface PickupBuild {
    inserters: readonly { id?: number; source: { type: string; pickup_length?: number; pickup_layout?: BeltPickupLayout; pickup_capture?: Source['pickup_capture'] } }[];
    overrides?: { backed_up_belts?: boolean };
}

export function pickupGeometryOf(build: PickupBuild) {
    const inputs = build.inserters.map((inserter, index) => ({ id: inserter.id ?? index + 1, source: inserter.source }))
        .filter(inserter => inserter.source.type === 'belt');
    const unverified = inputs.filter(inserter => isUnverified(inserter.source.pickup_capture)).map(i => i.id);
    // Out of scope: a subset of the unverified pickups, which no recapture makes supported
    const unsupported = inputs.filter(inserter => unsupportedPickupOf(inserter.source) !== null).map(i => i.id);
    const missing = inputs.filter(({source}) => source.pickup_layout
        ? source.pickup_length !== pickupLengthForLayout(source.pickup_layout)
        : source.pickup_length !== 1).map(i => i.id);
    return { total: inputs.length, known: inputs.filter(i => !missing.includes(i.id) && !unverified.includes(i.id)).length, missing, unverified, unsupported, backedUp: build.overrides?.backed_up_belts === true };
}
