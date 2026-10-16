import type { InserterFormData } from './configForm/formData';

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

/** Read-only type and quality, with the engine's defaults when the import did not supply them. */
export function inserterMetadataText(inserter: Pick<InserterFormData, 'prototype' | 'quality'>): string {
    return `${title(inserter.prototype ?? 'stack-inserter')} · ${title(inserter.quality ?? 'legendary')} quality`;
}

export function inserterStackSizeHelp(inserter: Pick<InserterFormData, 'prototype' | 'stack_size'>): string {
    if (inserter.stack_size !== undefined) return 'Items per swing. Clear for Automatic.';
    const size = effectiveInserterStackSize(inserter);
    return Number.isFinite(size) ? `Automatic: ${size} items, with all capacity research.`
        : 'Automatic capacity is unavailable for this inserter type. Check the build for details.';
}

export const INSERTER_TIMING_ASSUMPTION = 'When missing, type defaults to Stack inserter and quality to Legendary. '
    + 'Sidecar exports omit these details and use this timing assumption.';
