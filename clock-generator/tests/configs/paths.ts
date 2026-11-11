import * as path from 'path';

/**
 * Configs the unit tests load that are not samples (`resources/config-samples/`): the blast, the sweeps and the sample
 * snapshots do not take them. Keyed by the name each had as a sample, so a test reads as it did.
 */
export const TestConfigPaths = {
    /** The original electromagnetic science scaffold of #100 with its buffer chests as infinity chests that remove all: the terminal-rate sink detection */
    ELECTROMAGNETIC_SCIENCE_240_RECYCLER_BELT_FED_NO_BUFFERS: path.join(__dirname, 'electromagnetic-science-240-recycler-belt-fed-no-buffers.json'),
    /** The coverage check's deliberate fixture (PR #53): an accumulator machine with no inserters, which fails with "Missing inserter coverage" */
    BAD_ACCUMULATOR_CONFIG: path.join(__dirname, 'accumulator-bad-config.json'),
    /** A biochamber making nutrients from yumako mash at utilization exactly 1 (0.5 of 0.5 crafts a second), with the fuel inserters and the burn bonus: the utilization, fuel and burner-inventory cases */
    BIOCHAMBER_FUEL: path.join(__dirname, 'nutrients-from-yumako-mash-fuel-bonus.json'),
    /** One copy of the agricultural science sample with the nutrients, its biochambers' fuel, on the lane nearest to every inserter that takes them off a belt with bioflux: the room for the hand a hand of fuel delays */
    AGRICULTURAL_SCIENCE_50_FUEL_ON_NEAR_LANE: path.join(__dirname, 'agricultural-science-50-fuel-on-near-lane.json'),
    /** The agricultural science sample's config before it stated abucnasty's build of five copies: inserter 11 has the bioflux on its near lane, the egg loop's windows show on its 5-swing clock */
    AGRICULTURAL_SCIENCE_250_BIOFLUX_ON_NEAR_LANE: path.join(__dirname, 'agricultural-science-250-bioflux-on-near-lane.json'),
    /** The military science sample's config before it stated abucnasty's build of five mirrored pairs, with a coal lane of its own for each copy: the shared windows of its takers keep the rate where the separate ones do not */
    MILITARY_SCIENCE_120_COAL_LANE_PER_COPY: path.join(__dirname, 'military-science-120-coal-lane-per-copy.json'),
} as const;
