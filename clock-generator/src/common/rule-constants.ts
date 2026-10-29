// Constants of the game's rules and the engine's checks that the entities' traits read as well as the simulator: kept here,
// with no engine imports, so that the traits do not depend on the crafting modules that use them.

/**
 * Ticks between the clock reaching a value and an inserter acting on its decider (combinator output, then the
 * inserter reading it). An inserter acts in every tick of its window this much later, the first one included.
 */
export const CIRCUIT_LATENCY_TICKS = 2;

/**
 * A build whose items spoil is tried only with losses shorter than this share of the shortest spoil time of its items
 * (see lossLimitOf).
 */
export const SPOIL_LIMIT_SHARE = 3 / 4;
