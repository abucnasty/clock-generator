import { ChestType } from "../common/entity-types";

/**
 * Read a chest of a config from before chests had types once: a chest without `type` is a buffer chest, as every chest
 * was then. All validated, saved and exported configs name each chest's type.
 */
export function migrateChestType(value: unknown): unknown {
    if (typeof value !== "object" || value === null || Array.isArray(value) || "type" in value) {
        return value;
    }
    return { ...value, type: ChestType.BUFFER_CHEST };
}
