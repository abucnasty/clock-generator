/**
 * Read the former `use_fractional_swings` override once: a config that carries it loads and generates as without it. The
 * generator plans fractional swings only for the "Euclidean Swings" alternative it offers on every build, which asks
 * for them as an argument of its planning (`fractional_swings` of GenerateClockOptions), so no config holds the field.
 */
export function dropFractionalSwingsOverride(value: unknown): unknown {
    if (typeof value !== "object" || value === null || Array.isArray(value) || !("use_fractional_swings" in value)) {
        return value;
    }
    const { use_fractional_swings, ...overrides } = value as Record<string, unknown>;
    return overrides;
}
