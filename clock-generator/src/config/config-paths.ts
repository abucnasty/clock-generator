import * as path from 'path';

/**
 * Base directory for config sample files.
 */
const CONFIG_SAMPLES_DIR = path.resolve(__dirname, '../../resources/config-samples');

/**
 * Paths to all available config sample files.
 * Use these with `loadConfigFromFile()` to load configurations.
 * 
 * @example
 * ```typescript
 * import { loadConfigFromFile } from './loader';
 * import { ConfigPaths } from './config-paths';
 * 
 * const config = await loadConfigFromFile(ConfigPaths.LOGISTIC_SCIENCE_SHARED_INSERTER);
 * ```
 */
export const ConfigPaths = {
    CHEMICAL_SCIENCE: path.join(CONFIG_SAMPLES_DIR, 'chemical-science.conf'),
    CHEMICAL_SCIENCE_ADVANCED_CIRCUIT: path.join(CONFIG_SAMPLES_DIR, 'chemical-science-advanced-circuit.conf'),
    CHEMICAL_SCIENCE_DI_ENGINE: path.join(CONFIG_SAMPLES_DIR, 'chemical-science-di-engine.conf'),
    CHEMICAL_SCIENCE_ENGINES: path.join(CONFIG_SAMPLES_DIR, 'chemical-science-engines.json'),
    ELECTRIC_FURNACE: path.join(CONFIG_SAMPLES_DIR, 'electric-furnace.conf'),
    LOGISTIC_SCIENCE: path.join(CONFIG_SAMPLES_DIR, 'logistic-science.conf'),
    LOGISTIC_SCIENCE_SHARED_INSERTER: path.join(CONFIG_SAMPLES_DIR, 'logistic-science-shared-inserter.conf'),
    LOGISTIC_SCIENCE_INSERTER_CRAFTING: path.join(CONFIG_SAMPLES_DIR, 'logistic-science-inserter-crafting.conf'),
    PRODUCTION_SCIENCE: path.join(CONFIG_SAMPLES_DIR, 'production-science.conf'),
    PRODUCTION_SCIENCE_SHARED: path.join(CONFIG_SAMPLES_DIR, 'production-science-shared.conf'),
    PRODUCTION_SCIENCE_SHARED_JSON: path.join(CONFIG_SAMPLES_DIR, 'production-science-shared.json'),
    PRODUCTIVITY_MODULE: path.join(CONFIG_SAMPLES_DIR, 'productivity-module.conf'),
    SAMPLE_CONFIG: path.join(CONFIG_SAMPLES_DIR, 'sample-config.conf'),
    STONE_BRICKS_DIRECT_INSERT: path.join(CONFIG_SAMPLES_DIR, 'stone-bricks-direct-insert.conf'),
    UTILITY_SCIENCE: path.join(CONFIG_SAMPLES_DIR, 'utility-science.conf'),
    MILITARY_SCIENCE: path.join(CONFIG_SAMPLES_DIR, 'reja-military-1.json'),
    LOW_DENSITY_STRUCTURE: path.join(CONFIG_SAMPLES_DIR, 'low-density-structure-120-per-second.json'),
    METALLURGIC_SCIENCE_PACK: path.join(CONFIG_SAMPLES_DIR, 'metallurgic-science-pack.json'),
    LITHIUM_PLATES: path.join(CONFIG_SAMPLES_DIR, 'lithium-plates-40-per-second.json'),
    UTILITY_SCIENCE_BELTED_COMBINED_BLUE_AND_LDS: path.join(CONFIG_SAMPLES_DIR, 'utility-science-belted-combined-blue-and-lds.json'),
    PROCESSING_UNITS: path.join(CONFIG_SAMPLES_DIR, 'processing-units-15-per-second.json'),
    BAD_ACCUMULATOR_CONFIG: path.join(CONFIG_SAMPLES_DIR, 'bad-accumulator-config.json'),
    AUTOMATION_SCIENCE_PACK_FAILING: path.join(CONFIG_SAMPLES_DIR, 'clock-config-automation-science-pack-1774501984294.json'),
    AUTOMATION_SCIENCE_01_TERMINAL_SWINGS: path.join(CONFIG_SAMPLES_DIR, 'automation-science-01-terminal-swings.json'),
    UTILITY_SCIENCE_DIRECT_INSERT_LDS: path.join(CONFIG_SAMPLES_DIR, 'clock-config-utility-science-pack-direct-insert-lds.json'),
    PRODUCTION_SCIENCE_JSON: path.join(CONFIG_SAMPLES_DIR, 'production-science.json'),
    AUTOMATION_SCIENCE_BELTED_INTERNAL_BUFFER: path.join(CONFIG_SAMPLES_DIR, 'automation-science-belted-internal-buffer.json'),
    PROCESSING_UNITS_BELT_EXPORT: path.join(CONFIG_SAMPLES_DIR, 'processing-units-example-belt-export.json'),
    LOW_DENSITY_TWO_FOUNDRY: path.join(CONFIG_SAMPLES_DIR, 'low-density-two-foundry-120-per-second.json'),
    LOGISTIC_SCIENCE_DI: path.join(CONFIG_SAMPLES_DIR, 'logistic-science-di.json'),
} as const;
