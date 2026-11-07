/**
 * Read the former `period_duration_ticks` of a Clocked enable control override once: it is the `window_cycle_ticks` (maintainer glossary,
 * Window cycle). An override that carries only the former name loads as one that carries the new name, at the same place in the object;
 * one that carries both keeps its `window_cycle_ticks`. The schema runs this step on every enable control override of an inserter and a drill.
 */
export function renameClockedPeriodToWindowCycle(value: unknown): unknown {
    if (typeof value !== "object" || value === null || Array.isArray(value) || !("period_duration_ticks" in value)) {
        return value;
    }
    const override = value as Record<string, unknown>;
    if ("window_cycle_ticks" in override) {
        const { period_duration_ticks, ...kept } = override;
        return kept;
    }
    return Object.fromEntries(Object.entries(override).map(([key, entry]) => [key === "period_duration_ticks" ? "window_cycle_ticks" : key, entry]));
}

function renameInOverrides(overrides: unknown): unknown {
    if (typeof overrides !== "object" || overrides === null || Array.isArray(overrides) || !("enable_control" in overrides)) {
        return overrides;
    }
    const record = overrides as Record<string, unknown>;
    return { ...record, enable_control: renameClockedPeriodToWindowCycle(record.enable_control) };
}

function renameInEntries(entries: unknown): unknown {
    if (!Array.isArray(entries)) return entries;
    return entries.map(entry => typeof entry === "object" && entry !== null && !Array.isArray(entry) && "overrides" in entry
        ? { ...entry, overrides: renameInOverrides((entry as Record<string, unknown>).overrides) }
        : entry);
}

/**
 * The same step for a whole config that is not yet checked against the schema (a saved form, an imported file, a share link): it reads the
 * former name in the `overrides.enable_control` of each inserter and each drill. The UI uses it for the files and forms it reads itself.
 */
export function renameClockedPeriodInConfig(config: unknown): unknown {
    if (typeof config !== "object" || config === null || Array.isArray(config)) return config;
    const record = config as Record<string, unknown>;
    const result: Record<string, unknown> = { ...record };
    if ("inserters" in record) result.inserters = renameInEntries(record.inserters);
    const drills = record.drills;
    if (typeof drills === "object" && drills !== null && !Array.isArray(drills) && "configs" in drills) {
        result.drills = { ...drills, configs: renameInEntries((drills as Record<string, unknown>).configs) };
    }
    return result;
}
