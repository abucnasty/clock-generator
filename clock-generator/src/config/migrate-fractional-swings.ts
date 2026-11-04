/**
 * Read the former `use_fractional_swings` override once: a config that carries it loads and generates as without it. The
 * generator turns fractional swings on only for the "Fractional swings" alternative it offers on every build, on a copy of
 * the config it makes itself, so no loaded config holds the field.
 */
export function dropFractionalSwingsOverride(value: unknown): unknown {
    if (typeof value !== "object" || value === null || Array.isArray(value) || !("use_fractional_swings" in value)) {
        return value;
    }
    const { use_fractional_swings, ...overrides } = value as Record<string, unknown>;
    return overrides;
}
