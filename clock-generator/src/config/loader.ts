import { ZodError } from "zod";
import { ChestType } from "../common/entity-types";
import { Config, ConfigSchema } from "./schema";
import { ConfigValidationError } from "./errors";
import * as fs from "fs";
import * as path from "path";

// ============================================================================
// Types
// ============================================================================

/**
 * Options for parsing JSON configuration.
 */
export interface ConfigLoaderOptions {
    /**
     * Whether to allow JSON include directives.
     * 
     * - `true` (default for Node.js): Enables include directives for splitting
     *   large configs across multiple files.
     * - `false` (recommended for browser): Disables includes for security and
     *   because file system access is not available.
     */
    allowIncludes?: boolean;

    /**
     * Base directory for resolving relative include paths.
     * Only used when `allowIncludes` is true.
     */
    basePath?: string;
}

/**
 * Interface for abstracting file reading operations.
 * Implement this for custom file loading in browser environments.
 */
export interface ConfigFileReader {
    /**
     * Read the contents of a file as a string.
     */
    readFile(filePath: string): Promise<string>;

    /**
     * Resolve a relative path against a base path.
     */
    resolvePath(basePath: string, relativePath: string): string;
}

/**
 * Result of a config parse operation that may fail.
 */
export type ConfigParseResult =
    | { success: true; config: Config }
    | { success: false; error: ConfigValidationError };

// ============================================================================
// Default File Reader (Node.js)
// ============================================================================

/**
 * Default file reader implementation using Node.js fs module.
 */
export const NodeFileReader: ConfigFileReader = {
    async readFile(filePath: string): Promise<string> {
        return fs.promises.readFile(filePath, "utf-8");
    },
    resolvePath(basePath: string, relativePath: string): string {
        return path.resolve(basePath, relativePath);
    }
};

// ============================================================================
// Core Parsing Functions
// ============================================================================

/**
 * Parse a JSON string and validate it against the Config schema.
 *
 * @param jsonString - The configuration as a JSON string
 * @param options - Loader options (kept for callers; nothing to configure for JSON)
 * @returns The validated Config object
 * @throws {ConfigValidationError} If the configuration does not match the schema
 * @throws {Error} If the string is not JSON
 */
export async function parseConfig(
    jsonString: string,
    options: ConfigLoaderOptions = {}
): Promise<Config> {
    void options;
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
        throw new ConfigValidationError(result.error);
    }
    return result.data;
}

/**
 * Parse a JSON string and return a result object instead of throwing.
 * 
 * @param jsonString - The JSON configuration as a string
 * @param options - Optional parsing options
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
export async function parseConfigSafe(
    jsonString: string,
    options: ConfigLoaderOptions = {}
): Promise<ConfigParseResult> {
    try {
        const config = await parseConfig(jsonString, options);
        return { success: true, config };
    } catch (error) {
        if (error instanceof ConfigValidationError) {
            return { success: false, error };
        }
        // Re-wrap other errors (JSON parse errors) as validation errors
        if (error instanceof ZodError) {
            return { success: false, error: new ConfigValidationError(error) };
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
 * @param options - Optional parsing options
 * @param fileReader - Optional custom file reader (defaults to Node.js fs)
 * @returns The validated Config object
 * @throws {ConfigValidationError} If the configuration is invalid
 * @throws {Error} If file reading or JSON parsing fails
 * 
 * @example
 * ```typescript
 * const config = await loadConfigFromFile("./config/production.json");
 * ```
 */
export async function loadConfigFromFile(
    filePath: string,
    options: ConfigLoaderOptions = {},
    fileReader: ConfigFileReader = NodeFileReader
): Promise<Config> {
    const absolutePath = path.isAbsolute(filePath)
        ? filePath
        : path.resolve(process.cwd(), filePath);

    const content = await fileReader.readFile(absolutePath);

    return parseConfig(content, options);
}

/**
 * Load and parse a JSON configuration file, returning a result object.
 * 
 * @param filePath - Path to the JSON file
 * @param options - Optional parsing options
 * @param fileReader - Optional custom file reader
 * @returns A result object indicating success or failure
 */
export async function loadConfigFromFileSafe(
    filePath: string,
    options: ConfigLoaderOptions = {},
    fileReader: ConfigFileReader = NodeFileReader
): Promise<ConfigParseResult> {
    try {
        const config = await loadConfigFromFile(filePath, options, fileReader);
        return { success: true, config };
    } catch (error) {
        if (error instanceof ConfigValidationError) {
            return { success: false, error };
        }
        throw error;
    }
}

// ============================================================================
// Browser-Compatible Loader Factory
// ============================================================================

/**
 * Create a config loader for browser environments.
 * 
 * @param fetchFn - Function to fetch file contents (e.g., using fetch API)
 * @returns An object with parse and load functions configured for browser use
 * 
 * @example
 * ```typescript
 * const loader = createBrowserConfigLoader(async (url) => {
 *   const response = await fetch(url);
 *   return response.text();
 * });
 * 
 * const config = await loader.loadFromUrl("/api/config");
 * ```
 */
export function createBrowserConfigLoader(
    fetchFn: (url: string) => Promise<string>
) {
    return {
        /**
         * Parse a JSON string. Includes are disabled by default in browser.
         */
        async parse(jsonString: string): Promise<Config> {
            return parseConfig(jsonString, { allowIncludes: false });
        },

        /**
         * Parse a JSON string, returning a result object.
         */
        async parseSafe(jsonString: string): Promise<ConfigParseResult> {
            return parseConfigSafe(jsonString, { allowIncludes: false });
        },

        /**
         * Load config from a URL.
         */
        async loadFromUrl(url: string): Promise<Config> {
            const content = await fetchFn(url);
            return parseConfig(content, { allowIncludes: false });
        },

        /**
         * Load config from a URL, returning a result object.
         */
        async loadFromUrlSafe(url: string): Promise<ConfigParseResult> {
            try {
                const config = await this.loadFromUrl(url);
                return { success: true, config };
            } catch (error) {
                if (error instanceof ConfigValidationError) {
                    return { success: false, error };
                }
                throw error;
            }
        }
    };
}

// ============================================================================
// Config Normalization Functions
// ============================================================================

/**
 * Normalize a raw config object for backwards compatibility.
 * 
 * This function applies the following transformations:
 * - Adds `type: "buffer-chest"` to chest configs missing the type field
 * 
 * @param rawConfig - The raw parsed config object (before Zod validation)
 * @returns The normalized config object
 */
function normalizeConfig(rawConfig: unknown): unknown {
    if (typeof rawConfig !== "object" || rawConfig === null) {
        return rawConfig;
    }

    const config = rawConfig as Record<string, unknown>;
    
    // Normalize chest configs
    if (Array.isArray(config.chests)) {
        config.chests = config.chests.map(normalizeChestConfig);
    }

    return config;
}

/**
 * Normalize a single chest config.
 * 
 * If the chest config is missing the `type` field, defaults to "buffer-chest"
 * for backwards compatibility with existing configs.
 */
function normalizeChestConfig(chestConfig: unknown): unknown {
    if (typeof chestConfig !== "object" || chestConfig === null) {
        return chestConfig;
    }

    const chest = chestConfig as Record<string, unknown>;
    
    // If no type specified, default to buffer-chest for backwards compatibility
    if (!("type" in chest)) {
        return {
            ...chest,
            type: ChestType.BUFFER_CHEST
        };
    }

    return chest;
}

// ============================================================================
// Config Validation Functions
// ============================================================================

/**
 * Validate config for chest usage constraints.
 * 
 * Throws an error if:
 * - A buffer chest is used only as a source without being a sink for another inserter
 *   (the chest would start empty and never be filled)
 * - Infinity chests are exempt from this validation as they are infinite sources
 * 
 * @param config - The parsed config to validate
 * @throws {Error} If validation fails
 */
export function validateChestUsage(config: Config): void {
    const chests = config.chests ?? [];
    
    if (chests.length === 0) {
        return; // No chests to validate
    }

    // Collect all chest IDs that are used as sinks
    const chestIdsUsedAsSink = new Set<number>();
    // Collect all chest IDs that are used as sources
    const chestIdsUsedAsSource = new Set<number>();

    for (const inserter of config.inserters) {
        if (inserter.sink.type === "chest") {
            chestIdsUsedAsSink.add(inserter.sink.id);
        }
        if (inserter.source.type === "chest") {
            chestIdsUsedAsSource.add(inserter.source.id);
        }
    }

    // Check each chest that is used as a source
    for (const chestId of chestIdsUsedAsSource) {
        if (!chestIdsUsedAsSink.has(chestId)) {
            const chest = chests.find(c => c.id === chestId);
            
            // Infinity chests are exempt - they are infinite sources by design
            if (chest && chest.type === ChestType.INFINITY_CHEST) {
                continue;
            }
            
            throw new Error(
                `Buffer chest with id ${chestId} is used as a source but is never filled by any inserter. ` +
                `A buffer chest must be used as a sink by at least one inserter before it can be used as a source. ` +
                `Use an infinity chest instead if you need an infinite source.`
            );
        }
    }
}
