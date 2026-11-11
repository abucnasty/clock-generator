import { BeltType } from "../../common/entity-types";
import type { BeltConfig } from "../../config/schema";
import Fraction, { fraction } from "../../data-types/fraction";

/**
 * The speeds of the game's belts and the capacity of a lane, without the game data, so that a page can read a lane's
 * capacity on its main thread (the light entry). They are the one source of a belt's speed for the engine; a test
 * (belt-speed.test.ts) fails when they and the game data disagree on any belt the data holds.
 */

/**
 * The engine's belt speeds (items a second on both lanes) of the game's four belts, for the code that compares a speed
 * with one of them or counts in the transport belt's (lane speeds, tiles a second). A belt's own speed comes from its
 * prototype (beltSpeedOf).
 */
export const BeltSpeed = {
    TRANSPORT_BELT: 15,
    FAST_TRANSPORT_BELT: 30,
    EXPRESS_TRANSPORT_BELT: 45,
    TURBO_TRANSPORT_BELT: 60
} as const;

export type BeltSpeed = typeof BeltSpeed[keyof typeof BeltSpeed];

/** The engine's belt speed of each belt prototype of the game */
const SPEED_OF_PROTOTYPE: ReadonlyMap<string, BeltSpeed> = new Map<BeltType, BeltSpeed>([
    [BeltType.TRANSPORT_BELT, BeltSpeed.TRANSPORT_BELT],
    [BeltType.FAST_TRANSPORT_BELT, BeltSpeed.FAST_TRANSPORT_BELT],
    [BeltType.EXPRESS_TRANSPORT_BELT, BeltSpeed.EXPRESS_TRANSPORT_BELT],
    [BeltType.TURBO_TRANSPORT_BELT, BeltSpeed.TURBO_TRANSPORT_BELT],
]);

/** The belt prototypes the engine has a speed for, slowest first */
export const BELT_PROTOTYPES: readonly string[] = [...SPEED_OF_PROTOTYPE.keys()];

/** The engine's belt speed of a speed in tiles a tick: 60 ticks a second, 8 items a tile */
const BELT_SPEED_PER_TILE_A_TICK = 480;

/** The engine's speed of a belt prototype, or undefined for a prototype that is not a belt of the game */
export function beltSpeedOfPrototype(prototype: string): BeltSpeed | undefined {
    return SPEED_OF_PROTOTYPE.get(prototype);
}

/** The engine's speed of a belt prototype; a prototype that is not a belt of the game is refused */
export function beltSpeedOf(prototype: string): BeltSpeed {
    const speed = beltSpeedOfPrototype(prototype);
    if (speed === undefined) {
        throw new Error(`${prototype} is not a belt of the game`);
    }
    return speed;
}

/** A belt speed in tiles a tick, as the game data gives a belt prototype's `speed` (turbo: 60, 0.125) */
export function tilesPerTickOf(belt_speed: BeltSpeed): number {
    return belt_speed / BELT_SPEED_PER_TILE_A_TICK;
}

/** Items a second a lane carries: half the belt's speed times the lane's stack size (turbo, stack 4: 120) */
export function laneItemsPerSecond(belt_speed: number, stack_size: number): Fraction {
    return fraction(belt_speed).divide(2).multiply(stack_size);
}

/**
 * The stack size of a lane of a belt of the config, 1 or 2: a belt that lists one lane has the second at the same stack
 * size, for the drops that land on it
 */
export function laneStackFor(config: BeltConfig, lane: number): number {
    return config.lanes[Math.min(lane, config.lanes.length) - 1].stack_size;
}
