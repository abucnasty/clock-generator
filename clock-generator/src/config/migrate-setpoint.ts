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

function isRecordOf(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read the former `recipe` of a setpoint once: the setpoint counts an item, and its field is `item`. A setpoint that holds
 * only `recipe` is given back with `item` in its place and no `recipe`; one that holds both keeps its `item` and drops
 * `recipe`. The name stays as it is: no recipe's name is read as its product here. Anything else is given back as it was.
 */
export function renameRecipeToItem(setpoint: unknown): unknown {
    if (!isRecordOf(setpoint) || !("recipe" in setpoint)) {
        return setpoint;
    }
    if ("item" in setpoint) {
        const { recipe: _former, ...kept } = setpoint;
        return kept;
    }
    return Object.fromEntries(Object.entries(setpoint).map(([key, entry]) => [key === "recipe" ? "item" : key, entry]));
}

/**
 * Read the setpoint of a config through {@link renameRecipeToItem}: the config as it was where its setpoint holds no `recipe`.
 * Share links, files and saved builds from before the setpoint named its item load through this.
 */
export function renameSetpointRecipeToItem(value: unknown): unknown {
    if (!isRecordOf(value) || !isRecordOf(value.setpoint) || !("recipe" in value.setpoint)) {
        return value;
    }
    return { ...value, setpoint: renameRecipeToItem(value.setpoint) };
}
