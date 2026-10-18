import type { InserterFormData } from './configForm/formData';

export type PickupType = 'straight' | 'underground';
type Source = InserterFormData['source'];

export function pickupTypeOf(source: Source): PickupType | 'unverified' {
    if (source.pickup_capture && source.pickup_capture.status !== 'supported') return 'unverified';
    return source.pickup_length === 0.5 ? 'underground' : 'straight';
}

export function withPickupType(source: Source, type: PickupType): Source {
    if (source.type !== 'belt' || pickupTypeOf(source) === 'unverified') return source;
    const length = type === 'straight' ? 1 : 0.5;
    const updated = { ...source, pickup_length: length as 1 | 0.5 };
    // A deliberate geometry edit becomes a manual configuration, not a new physical capture.
    if (source.pickup_length !== length) delete updated.pickup_capture;
    if (type === 'underground') {
        delete updated.pickup_merge;
        delete updated.pickup_supply;
    }
    return updated;
}

/** Make the UI's straight-belt default explicit for generation and export, including older saved forms. */
export function withDefaultPickupType(source: Source): Source {
    return source.type === 'belt' && source.pickup_length === undefined ? withPickupType(source, 'straight') : source;
}

export interface PickupBuild {
    inserters: readonly { id?: number; source: { type: string; pickup_length?: number; pickup_capture?: Source['pickup_capture'] } }[];
    overrides?: { backed_up_belts?: boolean };
}

export function pickupGeometryOf(build: PickupBuild) {
    const inputs = build.inserters.map((inserter, index) => ({ id: inserter.id ?? index + 1, source: inserter.source }))
        .filter(inserter => inserter.source.type === 'belt');
    const unverified = inputs.filter(inserter => inserter.source.pickup_capture && inserter.source.pickup_capture.status !== 'supported').map(i => i.id);
    const missing = inputs.filter(inserter => inserter.source.pickup_length !== 1 && inserter.source.pickup_length !== 0.5).map(i => i.id);
    return { total: inputs.length, known: inputs.filter(i => !missing.includes(i.id) && !unverified.includes(i.id)).length, missing, unverified, backedUp: build.overrides?.backed_up_belts === true };
}

