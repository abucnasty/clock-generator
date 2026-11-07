/**
 * Read the former `target_output` of a config once: it is the `setpoint` (maintainer glossary, Setpoint). A config that carries only the
 * former name loads as one that carries the new name, at the same place in the object; one that carries both keeps its `setpoint`.
 * Share links and saved builds that hold the former name load through this step of the schema.
 */
export function renameTargetOutputToSetpoint(value: unknown): unknown {
    if (typeof value !== "object" || value === null || Array.isArray(value) || !("target_output" in value)) {
        return value;
    }
    const config = value as Record<string, unknown>;
    if ("setpoint" in config) {
        const { target_output, ...kept } = config;
        return kept;
    }
    return Object.fromEntries(Object.entries(config).map(([key, entry]) => [key === "target_output" ? "setpoint" : key, entry]));
}
