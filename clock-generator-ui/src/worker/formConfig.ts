import { COPIES_DECIMAL_ERROR } from 'clock-generator/light';
import type { z } from 'zod';

/**
 * Checks the form state (saved in localStorage, or exported to a file) against a schema, accepting values out of
 * bounds: the form can hold values the generator rejects, e.g. 0 items per second or an inserter end left unset after
 * its entity was removed, and shows them to be fixed there. Only a broken structure is rejected.
 *
 * The schema is given by the caller, as only the simulation worker loads the engine.
 */
export function parseFormConfig<T>(schema: z.ZodType<T>, config: unknown): z.ZodSafeParseResult<T> {
    const result = schema.safeParse(config);
    if (result.success || !result.error.issues.every((issue) => issue.code === 'too_small' || issue.code === 'too_big'
        || (issue.code === 'custom' && issue.path.length === 2 && issue.path[0] === 'target_output'
            && issue.path[1] === 'copies' && issue.message === COPIES_DECIMAL_ERROR)
        // Spatial cross-field issues are editable drafts, not broken saved structures. Check/Generate still parse
        // the strict schema. A bad drop shape/type is not a custom refinement and remains rejected here.
        || (issue.code === 'custom' && issue.path.length === 4 && issue.path[0] === 'inserters'
            && typeof issue.path[1] === 'number' && (issue.path[2] === 'source' || issue.path[2] === 'sink')
            && issue.path[3] === 'drop'))) {
        return result;
    }
    return { success: true, data: config as T };
}
