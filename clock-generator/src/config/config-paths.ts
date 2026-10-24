import * as path from 'path';

/**
 * Base directory for config sample files.
 */
const CONFIG_SAMPLES_DIR = path.resolve(__dirname, '../../resources/config-samples');

/**
 * Named general-build samples used by clock generation and sample sweeps.
 * Use these with `loadConfigFromFile()` to load configurations. A few exist to be refused (`ExpectedRefusals`).
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
    ADVANCED_CIRCUIT: path.join(CONFIG_SAMPLES_DIR, 'intermediates', 'advanced-circuit', 'advanced-circuit.json'),
    ADVANCED_CIRCUIT_230: path.join(CONFIG_SAMPLES_DIR, 'intermediates', 'advanced-circuit', 'advanced-circuit-230.json'),
    /** One block of four chemical science assemblers, four engine assemblers and one foundry casting the pipes for all four engines; 5.5 copies make 240 a second */
    CHEMICAL_SCIENCE_SHARED_FOUNDRY: path.join(CONFIG_SAMPLES_DIR, 'science', 'chemical-science', 'chemical-science-shared-foundry.json'),
    /** One electromagnetic plant making electromagnetic science packs from accumulators and supercapacitors on one belt; 11 copies make 330 a second */
    ELECTROMAGNETIC_SCIENCE: path.join(CONFIG_SAMPLES_DIR, 'science', 'electromagnetic-science', 'electromagnetic-science.json'),
    /** The same build with the enable control of both output inserters on AUTO */
    ELECTROMAGNETIC_SCIENCE_AUTO: path.join(CONFIG_SAMPLES_DIR, 'science', 'electromagnetic-science', 'electromagnetic-science-auto.json'),
    ELECTRIC_FURNACE: path.join(CONFIG_SAMPLES_DIR, 'smelting', 'electric-furnace', 'electric-furnace.json'),
    LOGISTIC_SCIENCE: path.join(CONFIG_SAMPLES_DIR, 'science', 'logistic-science', 'logistic-science.json'),
    LOGISTIC_SCIENCE_SHARED_INSERTER: path.join(CONFIG_SAMPLES_DIR, 'science', 'logistic-science', 'logistic-science-shared-inserter.json'),
    LOGISTIC_SCIENCE_INSERTER_CRAFTING: path.join(CONFIG_SAMPLES_DIR, 'science', 'logistic-science', 'logistic-science-inserter-crafting.json'),
    PRODUCTION_SCIENCE: path.join(CONFIG_SAMPLES_DIR, 'science', 'production-science', 'production-science-belt-fed.json'),
    PRODUCTION_SCIENCE_SHARED: path.join(CONFIG_SAMPLES_DIR, 'science', 'production-science', 'production-science-shared-whole-swings.json'),
    PRODUCTION_SCIENCE_SHARED_JSON: path.join(CONFIG_SAMPLES_DIR, 'science', 'production-science', 'production-science-shared.json'),
    SAMPLE_CONFIG: path.join(CONFIG_SAMPLES_DIR, 'science', 'logistic-science', 'logistic-science-sample.json'),
    STONE_BRICKS_DIRECT_INSERT: path.join(CONFIG_SAMPLES_DIR, 'smelting', 'stone-bricks', 'stone-bricks-direct-insert.json'),
    STONE_BRICKS_DIRECT_INSERT_2_1: path.join(CONFIG_SAMPLES_DIR, 'smelting', 'stone-bricks', 'stone-bricks-direct-insert-2-1.json'),
    UTILITY_SCIENCE: path.join(CONFIG_SAMPLES_DIR, 'science', 'utility-science', 'utility-science.json'),
    MILITARY_SCIENCE: path.join(CONFIG_SAMPLES_DIR, 'science', 'military-science', 'military-science-1-inserter.json'),
    LOW_DENSITY_STRUCTURE: path.join(CONFIG_SAMPLES_DIR, 'intermediates', 'low-density-structure', 'low-density-structure.json'),
    METALLURGIC_SCIENCE_PACK: path.join(CONFIG_SAMPLES_DIR, 'science', 'metallurgic-science', 'metallurgic-science.json'),
    LITHIUM_PLATES: path.join(CONFIG_SAMPLES_DIR, 'intermediates', 'lithium-plates', 'lithium-plates.json'),
    UTILITY_SCIENCE_BELTED_COMBINED_BLUE_AND_LDS: path.join(CONFIG_SAMPLES_DIR, 'science', 'utility-science', 'utility-science-belted-combined-blue-and-lds.json'),
    PROCESSING_UNITS: path.join(CONFIG_SAMPLES_DIR, 'intermediates', 'processing-units', 'processing-units.json'),
    BAD_ACCUMULATOR_CONFIG: path.join(CONFIG_SAMPLES_DIR, 'intermediates', 'accumulator', 'accumulator-bad-config.json'),
    ACCUMULATOR_640: path.join(CONFIG_SAMPLES_DIR, 'intermediates', 'accumulator', 'accumulator-640.json'),
    AUTOMATION_SCIENCE: path.join(CONFIG_SAMPLES_DIR, 'science', 'automation-science', 'automation-science.json'),
    /** Two foundries casting gears and copper onto one belt, which feeds an assembler making the packs */
    AUTOMATION_SCIENCE_BELTED_BUFFER: path.join(CONFIG_SAMPLES_DIR, 'science', 'automation-science', 'automation-science-belted-buffer.json'),
    /** Utility science with low density structure inserted directly, the chain's inserters always on (its clocked twin and scaffold were replaced by REAL_THAELN_CELL09) */
    UTILITY_SCIENCE_DIRECT_INSERT_LDS_CHAIN_ALWAYS_ON: path.join(CONFIG_SAMPLES_DIR, 'science', 'utility-science', 'utility-science-direct-insert-lds-chain-always-on.json'),
    PRODUCTION_SCIENCE_JSON: path.join(CONFIG_SAMPLES_DIR, 'science', 'production-science', 'production-science.json'),
    PROCESSING_UNITS_BELT_EXPORT: path.join(CONFIG_SAMPLES_DIR, 'intermediates', 'processing-units', 'processing-units-belt-export.json'),
    FLYING_ROBOT_FRAME: path.join(CONFIG_SAMPLES_DIR, 'intermediates', 'flying-robot-frame', 'flying-robot-frame.json'),
    LOGISTIC_SCIENCE_DI: path.join(CONFIG_SAMPLES_DIR, 'science', 'logistic-science', 'logistic-science-direct-insert.json'),
    GLEBA_ROCKET_FUEL: path.join(CONFIG_SAMPLES_DIR, 'gleba', 'rocket-fuel', 'rocket-fuel-jelly-stack-16.json'),
    GLEBA_ROCKET_FUEL_JELLY_STACK_15: path.join(CONFIG_SAMPLES_DIR, 'gleba', 'rocket-fuel', 'rocket-fuel-jelly-stack-15.json'),
    JELLYNUT_PROCESSING_ROCKET_FUEL: path.join(CONFIG_SAMPLES_DIR, 'gleba', 'jellynut-processing', 'jellynut-processing-rocket-fuel.json'),
    AGRICULTURAL_SCIENCE: path.join(CONFIG_SAMPLES_DIR, 'science', 'agriculture-science', 'agriculture-science.json'),
    IRON_BACTERIA_CULTIVATION: path.join(CONFIG_SAMPLES_DIR, 'gleba', 'iron-bacteria-cultivation', 'iron-bacteria-cultivation.json'),
    BIOCHAMBER_FUEL: path.join(CONFIG_SAMPLES_DIR, 'gleba', 'biochamber-fuel', 'nutrients-from-yumako-mash-fuel-bonus.json'),
    JELLYNUT_PROCESSING_ROCKET_FUEL_BIOCHAMBERS: path.join(CONFIG_SAMPLES_DIR, 'gleba', 'jellynut-processing', 'jellynut-processing-rocket-fuel-biochambers.json'),
    /** Real cells of bases built in the game, with their scaffold and the rate measured in the base (milestone M1) */
    REAL_STUPIDFATHOBBIT_CELL02: path.join(CONFIG_SAMPLES_DIR, 'real', 'stupidfathobbit', 'cell02', 'stupidfathobbit-cell02.json'),
    REAL_COMPOSITE04_CELL07: path.join(CONFIG_SAMPLES_DIR, 'real', 'composite04', 'cell07', 'composite04-cell07.json'),
    REAL_THAELN_CELL09: path.join(CONFIG_SAMPLES_DIR, 'real', 'thaeln', 'cell09', 'thaeln-cell09.json'),
    REAL_STUPIDFATHOBBIT_CELL06: path.join(CONFIG_SAMPLES_DIR, 'real', 'stupidfathobbit', 'cell06', 'stupidfathobbit-cell06.json'),
    REAL_ATLAN_CELL29: path.join(CONFIG_SAMPLES_DIR, 'real', 'atlan', 'cell29', 'atlan-cell29.json'),
    /** The lithium plate build, 80 a second: two cryogenic plants fill a rocket silo used as a chest, which six furnaces empty */
    REAL_OWNER_LITHIUM_SILO: path.join(CONFIG_SAMPLES_DIR, 'real', 'owner', 'lithium-silo', 'lithium-silo.json'),
    /** The iron plate build, 80 a second: a big mining drill drops ore into a car, which two furnaces empty */
    REAL_OWNER_CAR: path.join(CONFIG_SAMPLES_DIR, 'real', 'owner', 'car', 'car.json'),
    /** The grenade build, 240 a second over 7 copies: four assemblers, a foundry and four drills a copy, the grenades on a belt of two full lanes */
    REAL_OWNER_GRENADE: path.join(CONFIG_SAMPLES_DIR, 'real', 'owner', 'grenade', 'grenade.json'),
    /** A productivity module build, 80 a second over 6 copies: a chain of nine machines (plastic, cables, circuits, advanced circuits and the modules) with chests between them, a coal belt and an output belt */
    REAL_OWNER_PRODUCTIVITY_CHAIN: path.join(CONFIG_SAMPLES_DIR, 'real', 'owner', 'productivity-chain', 'productivity-chain.json'),
    /**
     * A recycler voiding iron ore at exact speed (16.875, 540 crafts a second), 400 ore a second destroyed: four inserters
     * bring it in, the recycler places what it gives back into a car, two inserters bring that back (the ore voider
     * benchmark's save F)
     */
    REAL_OWNER_ORE_VOIDER_EXACT_SPEED: path.join(CONFIG_SAMPLES_DIR, 'real', 'owner', 'ore-voider', 'ore-voider-exact-speed.json'),
    /** The same cell with six beacons on the recycler (26.634, 852.3 crafts a second), 400 ore a second destroyed (save B) */
    REAL_OWNER_ORE_VOIDER_OVERBEACONED: path.join(CONFIG_SAMPLES_DIR, 'real', 'owner', 'ore-voider', 'ore-voider-overbeaconed.json'),
    /** The steel build, 26 a second: one cargo wagon as a hub between a mining drill and two furnaces */
    STEEL_CARGO_WAGON: path.join(CONFIG_SAMPLES_DIR, 'smelting', 'steel-wagon', 'steel-wagon.json'),
} as const;

/** A sample kept to be refused: why it is kept, and the error generating a clock from it must fail with */
export interface ExpectedRefusal {
    /** Why the sample exists */
    readonly reason: string;
    /** Part of the message of the error that generating a clock from it throws */
    readonly error: string;
}

/**
 * The samples of `ConfigPaths` that exist to be refused, not to generate a clock from, by key. Generating each must
 * fail with its error (`expected-refusals.test.ts`); code that walks every sample leaves these out.
 */
export const ExpectedRefusals = {
    BAD_ACCUMULATOR_CONFIG: {
        reason: "The coverage check's deliberate fixture (PR #53): a machine with no inserters",
        error: 'Missing inserter coverage',
    },
} as const satisfies Partial<Record<keyof typeof ConfigPaths, ExpectedRefusal>>;

/** Whether the sample of a `ConfigPaths` key is one of the expected refusals */
export function isExpectedRefusal(key: string): key is keyof typeof ExpectedRefusals {
    return key in ExpectedRefusals;
}
