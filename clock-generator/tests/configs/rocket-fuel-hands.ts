import type { Config } from '../../src/config/schema';

/**
 * A rocket fuel sample (ROCKET_FUEL_60: three biochambers, the jelly inserters 6 to 9 from machine 2 into machines 1 and 3) with
 * those four inserters at a hand of 15, where the sample has 16: the build that was a sample of its own before 0.27.1
 */
export const withJellyHandsOf15 = (config: Config): Config => ({
    ...config,
    inserters: config.inserters.map(inserter => [6, 7, 8, 9].includes(inserter.id!) ? { ...inserter, stack_size: 15 } : inserter),
});
