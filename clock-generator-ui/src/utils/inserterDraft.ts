import type { InserterFormData } from './configForm/formData';

/** The fields the diagram's inserter dialog edits on its Config tab */
const CONFIG_FIELDS = ['source', 'sink', 'stack_size', 'filters'] as const;

/** JSON of a value with the keys of its objects sorted, so that key order does not count */
function sortedJson(value: unknown): string | undefined {
    return JSON.stringify(value, (_key, v: unknown) =>
        v && typeof v === 'object' && !Array.isArray(v)
            ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
            : v,
    );
}

/**
 * The Config tab's fields that differ in the draft from the saved inserter, with their draft values. A field the draft
 * removed is there with the value undefined, so that the update removes it too.
 */
export function changedConfigFields(draft: InserterFormData, saved: InserterFormData): Partial<InserterFormData> {
    return Object.fromEntries(
        CONFIG_FIELDS
            .filter((key) => sortedJson(draft[key]) !== sortedJson(saved[key]))
            .map((key) => [key, draft[key]]),
    ) as Partial<InserterFormData>;
}
