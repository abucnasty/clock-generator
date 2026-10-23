import { ParsedConfig, ConfigSchema } from "./schema";
import { ConfigValidationError } from "./errors";
import { migrateChestType } from "./migrate-chest-type";
import * as fs from "fs";
import * as path from "path";

// ============================================================================
// Types
// ============================================================================

/**
 * Result of a config parse operation that may fail.
 */
type ConfigParseResult =
    | { success: true; config: ParsedConfig }
    | { success: false; error: ConfigValidationError };

// ============================================================================
// Core Parsing Functions
// ============================================================================

/**
 * Parse a JSON string and validate it against the Config schema.
 *
 * @param jsonString - The configuration as a JSON string
 * @returns The validated Config object
 * @throws {ConfigValidationError} If the configuration does not match the schema
 * @throws {Error} If the string is not JSON
 */
export async function parseConfig(jsonString: string): Promise<ParsedConfig> {
    let parsed: unknown;
    try {
        parsed = JSON.parse(jsonString);
    } catch (error) {
        throw new Error(`Config is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    // Normalize config for backwards compatibility
    const normalized = normalizeConfig(parsed);

    const result = ConfigSchema.safeParse(normalized);
    if (!result.success) {
        throw new ConfigValidationError(result.error, normalized);
    }
    return result.data;
}

/**
 * Parse a JSON string and return a result object instead of throwing.
 * 
 * @param jsonString - The JSON configuration as a string
 * @returns A result object indicating success or failure
 * 
 * @example
 * ```typescript
 * const result = await parseConfigSafe(jsonString);
 * if (result.success) {
 *   console.log(result.config);
 * } else {
 *   console.error(result.error.getFormattedIssues());
 * }
 * ```
 */
export async function parseConfigSafe(jsonString: string): Promise<ConfigParseResult> {
    try {
        const config = await parseConfig(jsonString);
        return { success: true, config };
    } catch (error) {
        if (error instanceof ConfigValidationError) {
            return { success: false, error };
        }
        throw error; // Re-throw unexpected errors
    }
}

// ============================================================================
// File Loading Functions
// ============================================================================

/**
 * Load and parse a JSON configuration file.
 * 
 * @param filePath - Absolute or relative path to the JSON file
 * @returns The validated Config object
 * @throws {ConfigValidationError} If the configuration is invalid
 * @throws {Error} If file reading or JSON parsing fails
 * 
 * @example
 * ```typescript
 * const config = await loadConfigFromFile("./config/production.json");
 * ```
 */
export async function loadConfigFromFile(filePath: string): Promise<ParsedConfig> {
    const absolutePath = path.isAbsolute(filePath)
        ? filePath
        : path.resolve(process.cwd(), filePath);

    const content = await fs.promises.readFile(absolutePath, "utf-8");

    return parseConfig(content);
}

// ============================================================================
// Config Normalization Functions
// ============================================================================

/**
 * Normalize a raw config object for backwards compatibility: a chest without `type` is a buffer chest
 * (`migrateChestType`). The schema runs the other migrations.
 *
 * @param rawConfig - The raw parsed config object (before Zod validation)
 * @returns The normalized config object
 */
function normalizeConfig(rawConfig: unknown): unknown {
    if (typeof rawConfig !== "object" || rawConfig === null) {
        return rawConfig;
    }

    const config = rawConfig as Record<string, unknown>;
    if (Array.isArray(config.chests)) {
        config.chests = config.chests.map(migrateChestType);
    }

    return config;
}
