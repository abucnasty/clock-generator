import * as path from 'path';

/**
 * Base directory for config sample files.
 */
const CONFIG_SAMPLES_DIR = path.resolve(__dirname, '../../resources/config-samples');

/**
 * Named general-build samples used by clock generation and sample sweeps.
 * Use these with `loadConfigFromFile()` to load configurations.
 * 
 * @example
 * ```typescript
 * import { loadConfigFromFile } from './loader';
 * import { ConfigPaths } from './config-paths';
 * 
 * const config = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE_240);
 * ```
 */
export const ConfigPaths = {
    ADVANCED_CIRCUIT_240: path.join(CONFIG_SAMPLES_DIR, 'intermediates', 'advanced-circuit', 'advanced-circuit-240.json'),
    ADVANCED_CIRCUIT_230: path.join(CONFIG_SAMPLES_DIR, 'intermediates', 'advanced-circuit', 'advanced-circuit-230.json'),
    /** One block of four chemical science assemblers, four engine assemblers and one foundry casting the pipes for all four engines; 5.5 copies make 240 a second */
    CHEMICAL_SCIENCE_240_SHARED_FOUNDRY: path.join(CONFIG_SAMPLES_DIR, 'science', 'chemical', 'chemical-240-shared-foundry.json'),
    /** One electromagnetic plant making electromagnetic science packs from accumulators and supercapacitors on one belt; 11 copies make 330 a second */
    ELECTROMAGNETIC_SCIENCE_330: path.join(CONFIG_SAMPLES_DIR, 'science', 'electromagnetic', 'electromagnetic-330.json'),
    ELECTRIC_FURNACE_20: path.join(CONFIG_SAMPLES_DIR, 'intermediates', 'electric-furnace', 'electric-furnace-20.json'),
    /** One logistic science assembler: one inserter takes both ingredients from a turbo belt, one packs onto a second belt; 11 copies make 240 a second */
    LOGISTIC_SCIENCE_240: path.join(CONFIG_SAMPLES_DIR, 'science', 'logistic', 'logistic-240.json'),
    INSERTER_CRAFTING_240_SHARED_SIGNAL_CLOCK: path.join(CONFIG_SAMPLES_DIR, 'intermediates', 'inserter-crafting', 'inserter-crafting-240-shared-signal-clock.json'),
    STONE_BRICK_120_DRILL_DIRECT_INSERT: path.join(CONFIG_SAMPLES_DIR, 'smelting', 'stone-brick', 'stone-brick-120-drill-direct-insert.json'),
    UTILITY_SCIENCE_120: path.join(CONFIG_SAMPLES_DIR, 'science', 'utility', 'utility-120.json'),
    MILITARY_SCIENCE_120: path.join(CONFIG_SAMPLES_DIR, 'science', 'military', 'military-120.json'),
    LDS_240: path.join(CONFIG_SAMPLES_DIR, 'intermediates', 'lds', 'lds-240.json'),
    METALLURGIC_SCIENCE_45: path.join(CONFIG_SAMPLES_DIR, 'science', 'metallurgic', 'metallurgic-45.json'),
    UTILITY_SCIENCE_120_PROCESSING_UNIT_AND_LDS_ON_ONE_BELT: path.join(CONFIG_SAMPLES_DIR, 'science', 'utility', 'utility-120-processing-unit-and-lds-on-one-belt.json'),
    PROCESSING_UNIT_15_CHEST_FED: path.join(CONFIG_SAMPLES_DIR, 'intermediates', 'processing-unit', 'processing-unit-15-chest-fed.json'),
    ACCUMULATOR_640: path.join(CONFIG_SAMPLES_DIR, 'intermediates', 'accumulator', 'accumulator-640.json'),
    AUTOMATION_SCIENCE_240: path.join(CONFIG_SAMPLES_DIR, 'science', 'automation', 'automation-240.json'),
    /** Two foundries casting gears and copper onto one belt, which feeds an assembler making the packs */
    AUTOMATION_SCIENCE_120_FOUNDRIES_FEED_BELT_TO_ASSEMBLER: path.join(CONFIG_SAMPLES_DIR, 'science', 'automation', 'automation-120-foundries-feed-belt-to-assembler.json'),
    PRODUCTION_SCIENCE_120_TWO_BELTS: path.join(CONFIG_SAMPLES_DIR, 'science', 'production', 'production-120-two-belts.json'),
    FLYING_ROBOT_FRAME_160: path.join(CONFIG_SAMPLES_DIR, 'intermediates', 'flying-robot-frame', 'flying-robot-frame-160.json'),
    LOGISTIC_SCIENCE_240_DIRECT_INSERT: path.join(CONFIG_SAMPLES_DIR, 'science', 'logistic', 'logistic-240-direct-insert.json'),
    ROCKET_FUEL_60: path.join(CONFIG_SAMPLES_DIR, 'gleba', 'rocket-fuel', 'rocket-fuel-60.json'),
    AGRICULTURAL_SCIENCE_250: path.join(CONFIG_SAMPLES_DIR, 'science', 'agricultural', 'agricultural-250.json'),
    IRON_BACTERIA_380_CULTIVATION: path.join(CONFIG_SAMPLES_DIR, 'gleba', 'iron-bacteria', 'iron-bacteria-380-cultivation.json'),
    PROCESSING_UNIT_80_CIRCUIT_EXPORT: path.join(CONFIG_SAMPLES_DIR, 'intermediates', 'processing-unit', 'processing-unit-80-circuit-export.json'),
    UTILITY_SCIENCE_480_LDS_FOUNDRY_CHAIN: path.join(CONFIG_SAMPLES_DIR, 'science', 'utility', 'utility-480-lds-foundry-chain.json'),
    /** The original duplicated electromagnetic science scaffold, described as one cell: five cells make 240/s */
    ELECTROMAGNETIC_SCIENCE_240_RECYCLER_BELT_FED: path.join(CONFIG_SAMPLES_DIR, 'science', 'electromagnetic', 'electromagnetic-240-recycler-belt-fed.json'),
    /** The lithium plate build, 80 a second: two cryogenic plants fill a rocket silo used as a chest, which six furnaces empty */
    LITHIUM_PLATE_80_SILO_CHEST: path.join(CONFIG_SAMPLES_DIR, 'smelting', 'lithium-plate', 'lithium-plate-80-silo-chest.json'),
    /** The iron plate build, 80 a second: a big mining drill drops ore into a car, which two furnaces empty */
    IRON_PLATE_80_CAR_CHEST: path.join(CONFIG_SAMPLES_DIR, 'smelting', 'iron-plate', 'iron-plate-80-car-chest.json'),
    /** The grenade build, 240 a second over 7 copies: four assemblers, a foundry and four drills a copy, the grenades on a belt of two full lanes */
    GRENADE_240_FILLS_BELT_EXACTLY: path.join(CONFIG_SAMPLES_DIR, 'intermediates', 'grenade', 'grenade-240-fills-belt-exactly.json'),
    /** A productivity module build, 80 a second over 6 copies: a chain of nine machines (plastic, cables, circuits, advanced circuits and the modules) with chests between them, a coal belt and an output belt */
    PRODUCTIVITY_MODULE_80_CHEST_CHAIN: path.join(CONFIG_SAMPLES_DIR, 'intermediates', 'productivity-module', 'productivity-module-80-chest-chain.json'),
    /**
     * A recycler voiding iron ore at exact speed (16.875, 540 crafts a second), 400 ore a second destroyed: four inserters
     * bring it in, the recycler places what it gives back into a car, two inserters bring that back (the ore voider
     * benchmark's save F)
     */
    IRON_ORE_VOIDER_400_EXACT_SPEED: path.join(CONFIG_SAMPLES_DIR, 'recycling', 'iron-ore', 'iron-ore-voider-400-exact-speed.json'),
    /** The same cell with six beacons on the recycler (26.634, 852.3 crafts a second), 400 ore a second destroyed (save B) */
    IRON_ORE_VOIDER_400_OVERBEACONED: path.join(CONFIG_SAMPLES_DIR, 'recycling', 'iron-ore', 'iron-ore-voider-400-overbeaconed.json'),
    /** The steel build, 26 a second: one cargo wagon as a hub between a mining drill and two furnaces */
    STEEL_PLATE_26_WAGON_CHEST: path.join(CONFIG_SAMPLES_DIR, 'smelting', 'steel-plate', 'steel-plate-26-wagon-chest.json'),
} as const;
