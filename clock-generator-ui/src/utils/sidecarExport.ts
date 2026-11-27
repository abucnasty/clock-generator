/**
 * What JSON pasted or opened as a file is: a build file (a configuration) when it has a `setpoint` or a `target_output`,
 * else an export of the Clock Generator Sidecar mod, which the site no longer reads.
 */

const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

export const isBuildFile = (value: unknown): value is Record<string, unknown> => isObject(value) && ('setpoint' in value || 'target_output' in value);
