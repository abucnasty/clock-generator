import { pickupLengthForLayout, type BeltPickupLayout } from 'clock-generator/light';
import type { InserterFormData } from './configForm/formData';

export type PickupType = BeltPickupLayout;
type Source = InserterFormData['source'];

export function pickupTypeOf(source: Source): PickupType | 'underground' | 'unverified' {
    const capture = source.pickup_capture;
    if (capture && (capture.status !== 'supported' || (capture.model_version === 1 && capture.entity_type === 'underground-belt'))) return 'unverified';
    return source.pickup_layout ?? (source.pickup_length === 0.5 ? 'underground' : 'side-straight');
}

export function withPickupType(source: Source, type: PickupType): Source {
    if (source.type !== 'belt' || pickupTypeOf(source) === 'unverified') return source;
    const length = pickupLengthForLayout(type);
    const updated = { ...source, pickup_length: length, pickup_layout: type };
    // A deliberate geometry edit becomes a manual configuration, not a new physical capture.
    if (pickupTypeOf(source) !== type) delete updated.pickup_capture;
    if (type !== 'side-straight') {
        delete updated.pickup_merge;
        delete updated.pickup_supply;
    }
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
    const unverified = inputs.filter(inserter => {
        const capture = inserter.source.pickup_capture;
        return capture && (capture.status !== 'supported' || (capture.model_version === 1 && capture.entity_type === 'underground-belt'));
    }).map(i => i.id);
    const missing = inputs.filter(inserter => (inserter.source.pickup_length !== 1 && inserter.source.pickup_length !== 0.5)
        || (inserter.source.pickup_length === 0.5 && !inserter.source.pickup_layout)).map(i => i.id);
    return { total: inputs.length, known: inputs.filter(i => !missing.includes(i.id) && !unverified.includes(i.id)).length, missing, unverified, backedUp: build.overrides?.backed_up_belts === true };
}

