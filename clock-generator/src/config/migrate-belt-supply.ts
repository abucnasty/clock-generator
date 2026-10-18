/** Read the former config spelling once; all validated, saved and exported configs use backed_up_belts. */
export function migrateBeltSupplyOverrides(value: unknown): unknown {
    if (typeof value !== "object" || value === null || Array.isArray(value) || !("non_moving_belts" in value)) {
        return value;
    }
    const { non_moving_belts, ...overrides } = value as Record<string, unknown>;
    return "backed_up_belts" in overrides ? overrides : { ...overrides, backed_up_belts: non_moving_belts };
}
