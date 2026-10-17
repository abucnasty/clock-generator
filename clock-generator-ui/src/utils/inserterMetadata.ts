import type { BeltFormData, InserterFormData } from './configForm/formData';

/** Capacities of the supported prototypes with all research; checked against the engine's game data in tests. */
const CAPACITY: Record<string, number> = {
    'stack-inserter': 16,
    'bulk-inserter': 12,
    'fast-inserter': 4,
    'long-handed-inserter': 4,
    inserter: 4,
};

/** Explicit overrides stay explicit. Unknown/unsupported prototypes have no assumed capacity. */
export function effectiveInserterStackSize(inserter: Pick<InserterFormData, 'prototype' | 'stack_size'>): number {
    return inserter.stack_size ?? CAPACITY[inserter.prototype ?? 'stack-inserter'] ?? Number.NaN;
}

const title = (value: string) => value.charAt(0).toUpperCase() + value.slice(1).replaceAll('-', ' ');

/** Read-only timing labels; omission uses the engine's Stack/Legendary fallbacks. */
export function inserterTimingLabels(inserter: Pick<InserterFormData, 'prototype' | 'quality'>): { type: string; quality: string } {
    return { type: title(inserter.prototype ?? 'stack-inserter'), quality: `${title(inserter.quality ?? 'legendary')} quality` };
}

/** Read-only type and quality, with the engine's defaults when the import did not supply them. */
export function inserterMetadataText(inserter: Pick<InserterFormData, 'prototype' | 'quality'>): string {
    const labels = inserterTimingLabels(inserter);
    return `${labels.type} · ${labels.quality}`;
}

export function inserterStackSizeHelp(inserter: Pick<InserterFormData, 'prototype' | 'stack_size'>): string | undefined {
    if (inserter.stack_size !== undefined) return undefined;
    const size = effectiveInserterStackSize(inserter);
    return Number.isFinite(size) ? `Automatic: ${size} items, with all capacity research.`
        : 'Automatic capacity is unavailable for this inserter type. Check the build for details.';
}

export const INSERTER_TIMING_ASSUMPTION = 'When missing, type defaults to Stack inserter and quality to Legendary. '
    + 'Sidecar exports omit these details and use this timing assumption.';

export const DROP_ROUTE_READ_ONLY = 'Imported geometry: route read-only. Edit and reopen the build file to change it.';
export const DROP_BELT_READ_ONLY = 'Imported drop positions: belt type and lane layout are read-only. Edit and reopen the build file to change them.';

export function hasImportedBeltDrops(inserters: readonly Pick<InserterFormData, 'sink'>[], beltId: number): boolean {
    return inserters.some(inserter => inserter.sink.type === 'belt' && inserter.sink.id === beltId && inserter.sink.drop !== undefined);
}

/** Strategy and consumption-only changes do not alter the imported belt geometry. */
export function beltGeometryEditProblem(
    inserters: readonly Pick<InserterFormData, 'sink'>[],
    belt: Pick<BeltFormData, 'id' | 'type' | 'lanes'>,
    updates: Partial<BeltFormData>,
): string | null {
    if (!hasImportedBeltDrops(inserters, belt.id)) return null;
    const changed = (updates.type !== undefined && updates.type !== belt.type)
        || (updates.lanes !== undefined && (updates.lanes.length !== belt.lanes.length
            || updates.lanes.some((lane, i) => lane.ingredient !== belt.lanes[i]?.ingredient || lane.stack_size !== belt.lanes[i]?.stack_size)));
    return changed ? DROP_BELT_READ_ONLY : null;
}

export function endpointEditProblem(inserter: InserterFormData, side: 'source' | 'sink', endpoint: { type: InserterFormData['source']['type']; id: number }): string | null {
    const old = inserter[side];
    return (old.type !== endpoint.type || old.id !== endpoint.id) && inserter.sink.drop !== undefined ? DROP_ROUTE_READ_ONLY : null;
}

/** No-op endpoint selection preserves lane/drop fields and explicit-vs-omitted values. */
export function endpointUpdate(inserter: InserterFormData, side: 'source' | 'sink', endpoint: { type: InserterFormData['source']['type']; id: number }): Partial<InserterFormData> {
    const old = inserter[side];
    if (old.type === endpoint.type && old.id === endpoint.id) return {};
    if (endpointEditProblem(inserter, side, endpoint)) return {};
    return { [side]: endpoint };
}
