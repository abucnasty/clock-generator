import { Duration } from "../../../data-types";
import { FactorioDataService } from "../../../data";
import { InserterType } from "./inserter-type";

export interface InserterSpec {
    belt: {
        pickup: Duration;
        drop: Duration;
    },
    machine: {
        pickup: Duration;
        drop: Duration;
    },
    rotation: Duration;
}

/**
 * The legendary stack inserter, which the timings were first calibrated on. `inserterSpecFor` reproduces it from the game
 * data (inserter-spec.test.ts checks that it does), so this constant is a reference, not a table to add to.
 */
export const LEGENDARY_STACK_INSERTER_SPEC: InserterSpec = {
    belt: {
        pickup: Duration.ofTicks(4),
        drop: Duration.ofTicks(4),
    },
    machine: {
        pickup: Duration.ofTicks(1),
        drop: Duration.ofTicks(1),
    },
    rotation: Duration.ofTicks(3),
};

export const INSERTER_SPECS = {
    [InserterType.STACK_INSERTER]: {
        legendary: LEGENDARY_STACK_INSERTER_SPEC,
    }
} as const;

/** The quality levels of the game data count in steps of 30% of the rotation speed (0 for normal, 5 for legendary) */
const ROTATION_SPEED_BONUS_PER_QUALITY_LEVEL = 0.3;

/** Half a revolution takes 0.5 / ω ticks; this keeps float noise (a speed of 0.1 giving 5.000000000000001) from adding one */
const FLOAT_NOISE = 1e-9;

/** The ticks the arm spends picking up from, or dropping into, a machine or a chest */
const MACHINE_PICKUP_OR_DROP_TICKS = 1;

/**
 * Belt pickup and belt drop were calibrated on the legendary stack inserter only and are kept for every prototype and
 * quality; they have not been checked for any other. The drop onto a belt is the dynamic Belt.dropDuration anyway when
 * the inserter is given the belt it drops on (animation.ts), and these 4 ticks are what remains when it is not.
 */
const BELT_PICKUP_TICKS = 4;
const BELT_DROP_TICKS = 4;

/** Refuses the inserters the model does not run, with the reason */
function assertSupportedInserter(prototype: string): void {
    if (prototype === "burner-inserter") {
        throw new Error("The burner inserter is not supported: the burner inserter needs fuel");
    }
}

/**
 * The inserter prototype and quality the config names, checked against the game data: an unknown prototype or quality
 * and a burner inserter are refused with the reason.
 */
export function assertSupportedInserterKind(prototype: string, quality: string): void {
    assertSupportedInserter(prototype);
    FactorioDataService.findInserterOrThrow(prototype);
    FactorioDataService.findQualityOrThrow(quality);
}

/**
 * Ticks the arm turns each way between the pickup and the drop. Measured in the game on all 25 pairs of the five
 * prototypes and five qualities, chest to chest (2026-10-15, clock-generator/.scratch/geppetto/inserter-timing/chest.txt):
 * with the rotation speed ω of the prototype times 1 + 0.3 × the quality's level, a turn takes ceil(0.5 / ω) − 2 ticks.
 */
export function rotationTicks(prototype: string, quality: string): number {
    assertSupportedInserterKind(prototype, quality);
    const base = FactorioDataService.findInserterOrThrow(prototype).rotation_speed;
    const level = FactorioDataService.findQualityOrThrow(quality).level;
    const rotation_speed = base * (1 + ROTATION_SPEED_BONUS_PER_QUALITY_LEVEL * level);
    return Math.ceil(0.5 / rotation_speed - FLOAT_NOISE) - 2;
}

/** The timings of an inserter of that prototype and quality; see rotationTicks and the constants above for where they stand */
export function inserterSpecFor(prototype: string, quality: string): InserterSpec {
    return {
        belt: {
            pickup: Duration.ofTicks(BELT_PICKUP_TICKS),
            drop: Duration.ofTicks(BELT_DROP_TICKS),
        },
        machine: {
            pickup: Duration.ofTicks(MACHINE_PICKUP_OR_DROP_TICKS),
            drop: Duration.ofTicks(MACHINE_PICKUP_OR_DROP_TICKS),
        },
        rotation: Duration.ofTicks(rotationTicks(prototype, quality)),
    };
}

/**
 * Items in the hand of an inserter of that prototype with all the research done: 1, plus what the prototype adds, plus
 * the research total of its kind. The bulk inserters (prototype `bulk`: the bulk and the stack inserter) take the sum of
 * the bulk inserter capacity bonuses, the others the sum of the inserter stack size bonuses. 16 for the stack inserter,
 * 12 for the bulk inserter and 4 for the rest, as measured in the game. The quality does not change the hand.
 */
export function fullResearchHandSize(prototype: string): number {
    assertSupportedInserter(prototype);
    const inserter = FactorioDataService.findInserterOrThrow(prototype);
    const research = FactorioDataService.inserterResearch();
    const bonus = inserter.bulk ? research.bulk_inserter_capacity_bonus : research.inserter_stack_size_bonus;
    return 1 + (inserter.stack_size_bonus ?? 0) + bonus;
}

/**
 * Whether an inserter of the prototype is a bulk one (prototype `bulk`: the bulk and the stack inserter), by the game data.
 * At a machine that places its results itself, a bulk inserter waits for a full hand and any other swings what it holds
 * (recorded on a recycler on scrap, 2.1.21: a stack inserter waited at it with a part hand of holmium ore for 10.5 minutes,
 * a long-handed inserter swung each low density structure on its own).
 */
export function isBulkInserter(prototype: string): boolean {
    return FactorioDataService.findInserterOrThrow(prototype).bulk === true;
}

/** The hand a config gives an inserter: its `stack_size` when it sets one, else the full research hand of its prototype */
export function configuredHandSize(inserter: { prototype?: string, stack_size?: number }): number {
    return inserter.stack_size ?? fullResearchHandSize(inserter.prototype ?? InserterType.STACK_INSERTER);
}
