// The variants of the blast (`BLAST_GROUPS=variants`, job keys `variants-<name>`; #600): a sample with the options a test or a game
// recording sets on it, built here in code (the samples carry no overrides, so a build with belts backed up, or with an ingredient
// left out of the window cycle, is a sample plus the option). Each is one job of the record, so that its result is pinned there and
// the property module runs on it; the test or the recording that qualifies it is named beside it. A variant is a job only
// because a game recording is tied to its clock, a test pins it or a per-job check reads it; the speed-80 agricultural ranking config is a plain test.
//
// Loaded by blast.blastrun.ts by path where this file exists (a worktree from before it has no variant jobs).
import type { Config } from '../../../src/config/schema';
import { ConfigPaths } from '../../../src/config/config-paths';
import { loadConfigFromFile } from '../../../src/config/loader';
import { productionScienceSharedPickup } from '../../../src/crafting/generate-blueprint-test-helpers';
import { steelHub } from '../../../src/crafting/container-output.fixture';
import { withJellyHandsOf15 } from '../../configs/rocket-fuel-hands';
import { steelWagonCases, steelWagonConfig } from './steel-plate-26-wagon-chest-clock-fixtures';

export interface VariantJob {
    /** The job's name (its key is `variants-<name>`): the sample, then what is set on it */
    name: string;
    /** The test or the game recording this job is for */
    qualifies: string;
    config: () => Promise<Config>;
}

const backedUp = (config: Config): Config => ({ ...config, overrides: { ...config.overrides, backed_up_belts: true } });
const sample = (path: string, change: (config: Config) => Config) => async () => change(await loadConfigFromFile(path));

export function variantJobs(): VariantJob[] {
    return [
        // the game recordings tied to a clock of a build that is not the sample as it is
        { name: 'INSERTER_CRAFTING_240_SHARED_SIGNAL_CLOCK_BACKED_UP', config: sample(ConfigPaths.INSERTER_CRAFTING_240_SHARED_SIGNAL_CLOCK, backedUp),
            qualifies: 'game recording generated-backed-up-one-copy (inserter-crafting-240-shared-signal-clock-controls.json)' },
        { name: 'PROCESSING_UNIT_80_CIRCUIT_EXPORT_BACKED_UP', config: sample(ConfigPaths.PROCESSING_UNIT_80_CIRCUIT_EXPORT, backedUp),
            qualifies: 'game recording generated-backed-up (processing-unit-80-circuit-export-clock-controls.json); processing-unit-80-circuit-export-backed' },
        { name: 'STEEL_PLATE_26_WAGON_CHEST_IRON_ORE_OUT_OF_PERIOD',
            config: () => steelWagonConfig(steelWagonCases().find(it => it.ignored_lcm_ingredients !== undefined)!),
            qualifies: 'game recording steel-wagon-iron-ore-out-of-period (steel-plate-26-wagon-chest-clock-controls.json)' },
        { name: 'AGRICULTURAL_SCIENCE_250_BACKED_UP', config: sample(ConfigPaths.AGRICULTURAL_SCIENCE_250, backedUp),
            qualifies: 'scaffold recordings "agricultural science (belts are backed up)"; per-job checks (job-checks/variants.ts)' },
        // tests
        { name: 'ADVANCED_CIRCUIT_240_BACKED_UP', config: sample(ConfigPaths.ADVANCED_CIRCUIT_240, backedUp),
            qualifies: 'small-batches-fallback.generation.test.ts' },
        { name: 'CHEMICAL_SCIENCE_240_SHARED_FOUNDRY_BACKED_UP', config: sample(ConfigPaths.CHEMICAL_SCIENCE_240_SHARED_FOUNDRY, backedUp),
            qualifies: 'decider-order.generation.test.ts' },
        { name: 'ROCKET_FUEL_60_JELLY_HANDS_15_BACKED_UP', config: sample(ConfigPaths.ROCKET_FUEL_60, config => backedUp(withJellyHandsOf15(config))),
            qualifies: 'decider-order.generation.test.ts (fuel clocks of their own). The decider-order test also ran ACCUMULATOR_640 and IRON_BACTERIA_380_CULTIVATION with belts backed up: their samples already are, so their config jobs hold the same clocks' },
        { name: 'AUTOMATION_SCIENCE_240_ONE_OUTPUT_SWING',
            config: sample(ConfigPaths.AUTOMATION_SCIENCE_240, config => ({ ...config, overrides: { ...config.overrides, terminal_swing_count: 1 } })),
            qualifies: 'per-job checks (job-checks/variants.ts): the sample no longer forces one output swing a cycle; no clock made without a search is stable with it' },
        { name: 'LOGISTIC_SCIENCE_240_DIRECT_INSERT_TWO_OUTPUT_SWINGS',
            config: sample(ConfigPaths.LOGISTIC_SCIENCE_240_DIRECT_INSERT, config => ({ ...config, overrides: { ...config.overrides, terminal_swing_count: 2 } })),
            qualifies: 'per-job checks (job-checks/variants.ts): forced output swing count' },
        { name: 'PRODUCTION_SCIENCE_120_TWO_BELTS_SHARED_PICKUP', config: sample(ConfigPaths.PRODUCTION_SCIENCE_120_TWO_BELTS, productionScienceSharedPickup),
            qualifies: 'per-job checks (job-checks/variants.ts): one pickup for the two input items, the fractional swings alternative' },
        { name: 'STEEL_HUB_26_CONTAINER_OUTPUT', config: async () => steelHub(),
            qualifies: 'container-output.generation.test.ts (a product that leaves through a container)' },
    ];
}
