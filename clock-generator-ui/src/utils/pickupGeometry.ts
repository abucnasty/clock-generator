import type { InserterFormData } from './configForm/formData';

export type PickupType = 'straight' | 'underground' | 'unspecified';
type Source = InserterFormData['source'];

export function pickupTypeOf(source: Source): PickupType {
    return source.pickup_length === 1 ? 'straight' : source.pickup_length === 0.5 ? 'underground' : 'unspecified';
}

export function withPickupType(source: Source, type: PickupType): Source {
    if (source.type !== 'belt') return source;
    const next = { ...source };
    delete next.pickup_length;
    if (type !== 'unspecified') next.pickup_length = type === 'straight' ? 1 : 0.5;
    return next;
}

export interface PickupBuild {
    inserters: readonly { id?: number; source: { type: string; pickup_length?: number } }[];
    overrides?: { non_moving_belts?: boolean };
}

export function pickupGeometryOf(build: PickupBuild) {
    const inputs = build.inserters.map((inserter, index) => ({ id: inserter.id ?? index + 1, source: inserter.source }))
        .filter(inserter => inserter.source.type === 'belt');
    const missing = inputs.filter(inserter => inserter.source.pickup_length !== 1 && inserter.source.pickup_length !== 0.5).map(i => i.id);
    return { total: inputs.length, known: inputs.length - missing.length, missing, standing: build.overrides?.non_moving_belts === true };
}

