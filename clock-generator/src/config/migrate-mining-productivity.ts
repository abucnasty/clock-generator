import type { RefinementCtx } from "zod";

/** Each level of mining productivity research gives +10% mining productivity, as in the game */
export const PRODUCTIVITY_PER_MINING_LEVEL = 10;

export const MINING_PRODUCTIVITY_LEVEL_AND_PRODUCTIVITY_ERROR = "`mining_productivity_level` is the former spelling of each "
    + "drill's `productivity` (the level x 10%): give one or the other, not both";

export const MINING_PRODUCTIVITY_LEVEL_ERROR = "`mining_productivity_level` must be a whole number of levels, 0 or more";

/**
 * Read the former spelling of the drills' productivity once: one `mining_productivity_level` for every drill becomes
 * each drill's `productivity`, the level x 10%. All validated, saved and exported configs give each drill its own
 * `productivity`. `issue` is told of a level given with any drill's productivity, and of a level that is not a whole
 * number of levels; the drills are then left as they are.
 */
export function migrateMiningProductivityLevel(value: unknown, issue?: (message: string) => void): unknown {
    if (typeof value !== "object" || value === null || Array.isArray(value) || !("mining_productivity_level" in value)) {
        return value;
    }
    const { mining_productivity_level: level, ...drills } = value as Record<string, unknown>;
    const configs = Array.isArray(drills.configs) ? drills.configs : undefined;
    const isDrillWithProductivity = (config: unknown) => typeof config === "object" && config !== null && "productivity" in config;
    if (configs?.some(isDrillWithProductivity)) {
        issue?.(MINING_PRODUCTIVITY_LEVEL_AND_PRODUCTIVITY_ERROR);
        return value;
    }
    if (typeof level !== "number" || !Number.isInteger(level) || level < 0) {
        issue?.(MINING_PRODUCTIVITY_LEVEL_ERROR);
        return value;
    }
    if (!configs) {
        return drills;
    }
    const productivity = level * PRODUCTIVITY_PER_MINING_LEVEL;
    return {
        ...drills,
        configs: configs.map(config => typeof config === "object" && config !== null ? { ...config, productivity } : config)
    };
}

/** The migration as a schema step: its problems are the config's issues at `mining_productivity_level` */
export function migrateMiningProductivityLevelStep(value: unknown, context: RefinementCtx): unknown {
    return migrateMiningProductivityLevel(value, message =>
        context.addIssue({ code: "custom", path: ["mining_productivity_level"], message }));
}
