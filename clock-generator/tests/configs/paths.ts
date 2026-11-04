import * as path from 'path';

/**
 * Configs the unit tests load that are not samples (`resources/config-samples/`): the blast, the sweeps and the sample
 * snapshots do not take them. Keyed by the name each had as a sample, so a test reads as it did.
 */
export const TestConfigPaths = {
    /** The original electromagnetic science scaffold of #100 with its buffer chests as infinity chests that remove all: the terminal-rate sink detection */
    REAL_OWNER_PINK_SCIENCE_ORIGINAL_NO_BUFFERS: path.join(__dirname, 'pink-science-original-no-buffers.json'),
    /** The coverage check's deliberate fixture (PR #53): an accumulator machine with no inserters, which fails with "Missing inserter coverage" */
    BAD_ACCUMULATOR_CONFIG: path.join(__dirname, 'accumulator-bad-config.json'),
    /** A biochamber making nutrients from yumako mash at duty exactly 1 (0.5 of 0.5 crafts a second), with the fuel inserters and the burn bonus: the duty, fuel and burner-inventory cases */
    BIOCHAMBER_FUEL: path.join(__dirname, 'nutrients-from-yumako-mash-fuel-bonus.json'),
} as const;
