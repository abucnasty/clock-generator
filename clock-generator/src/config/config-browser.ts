import { ZodError } from "zod";
import { Config, ConfigSchema } from "./schema";
import { ConfigValidationError } from "./errors";

// ============================================================================
// Types
// ============================================================================

/**
 * Result of a config parse operation that may fail.
 */
export type ConfigParseResult =
    | { success: true; config: Config }
    | { success: false; error: ConfigValidationError | Error };

// ============================================================================
// JSON Parsing Functions (Browser-Compatible)
// ============================================================================

/**
 * Parse a JSON object and validate it against the Config schema.
 * 
 * @param jsonObject - The configuration as a plain JavaScript object
 * @returns The validated Config object
 * @throws {ConfigValidationError} If the configuration is invalid
 * 
 * @example
 * ```typescript
 * const config = parseConfigFromObject({
 *   target_output: {
 *     recipe: "electronic-circuit",
 *     items_per_second: 1.5,
 *     machines: 2
 *   },
 *   machines: [],
 *   inserters: [],
 *   belts: []
 * });
 * ```
 */
export function parseConfigFromObject(jsonObject: unknown): Config {
    try {
        return ConfigSchema.parse(jsonObject);
    } catch (error) {
        if (error instanceof ZodError) {
            throw new ConfigValidationError(error, jsonObject);
        }
        throw error;
    }
}

/**
 * Parse a JSON object and validate it, returning a result object instead of throwing.
 * 
 * @param jsonObject - The configuration as a plain JavaScript object
 * @returns A result object indicating success or failure
 */
export function parseConfigFromObjectSafe(jsonObject: unknown): ConfigParseResult {
    try {
        const config = parseConfigFromObject(jsonObject);
        return { success: true, config };
    } catch (error) {
        if (error instanceof ConfigValidationError) {
            return { success: false, error };
        }
        return {
            success: false,
            error: error instanceof Error ? error : new Error(String(error)),
        };
    }
}

/**
 * Parse a JSON string and validate it against the Config schema.
 * 
 * @param jsonString - The configuration as a JSON string
 * @returns The validated Config object
 * @throws {ConfigValidationError} If the configuration is invalid
 * @throws {SyntaxError} If JSON parsing fails
 */
export function parseConfigFromJson(jsonString: string): Config {
    const parsed = JSON.parse(jsonString);
    return parseConfigFromObject(parsed);
}

/**
 * Parse a JSON string and validate it, returning a result object instead of throwing.
 * 
 * @param jsonString - The configuration as a JSON string
 * @returns A result object indicating success or failure
 */
export function parseConfigFromJsonSafe(jsonString: string): ConfigParseResult {
    try {
        const config = parseConfigFromJson(jsonString);
        return { success: true, config };
    } catch (error) {
        if (error instanceof ConfigValidationError) {
            return { success: false, error };
        }
        return {
            success: false,
            error: error instanceof Error ? error : new Error(String(error)),
        };
    }
}
