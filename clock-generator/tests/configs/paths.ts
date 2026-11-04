import * as path from 'path';

/**
 * Configs the unit tests load that are not samples (`resources/config-samples/`): the blast, the sweeps and the sample
 * snapshots do not take them. Keyed by the name each had as a sample, so a test reads as it did.
 */
export const TestConfigPaths = {
    /** The original electromagnetic science scaffold of #100 with its buffer chests as infinity chests that remove all: the terminal-rate sink detection */
    REAL_OWNER_PINK_SCIENCE_ORIGINAL_NO_BUFFERS: path.join(__dirname, 'pink-science-original-no-buffers.json'),
} as const;
