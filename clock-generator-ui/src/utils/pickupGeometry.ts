import type { InserterFormData } from './configForm/formData';

export type PickupType = 'straight' | 'underground';
type Source = InserterFormData['source'];

export function pickupTypeOf(source: Source): PickupType {
    return source.pickup_length === 0.5 ? 'underground' : 'straight';
}

export function withPickupType(source: Source, type: PickupType): Source {
    if (source.type !== 'belt') return source;
    return { ...source, pickup_length: type === 'straight' ? 1 : 0.5 };
}

/** Make the UI's straight-belt default explicit for generation and export, including older saved forms. */
export function withDefaultPickupType(source: Source): Source {
    return source.type === 'belt' && source.pickup_length === undefined ? withPickupType(source, 'straight') : source;
}

export interface PickupBuild {
    inserters: readonly { id?: number; source: { type: string; pickup_length?: number } }[];
    overrides?: { backed_up_belts?: boolean };
}

export function pickupGeometryOf(build: PickupBuild) {
    const inputs = build.inserters.map((inserter, index) => ({ id: inserter.id ?? index + 1, source: inserter.source }))
        .filter(inserter => inserter.source.type === 'belt');
    const missing = inputs.filter(inserter => inserter.source.pickup_length !== 1 && inserter.source.pickup_length !== 0.5).map(i => i.id);
    return { total: inputs.length, known: inputs.length - missing.length, missing, backedUp: build.overrides?.backed_up_belts === true };
}

