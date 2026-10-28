import { Duration } from "../../../data-types";
import { FactorioDataService } from "../../../data";
import { BeltSpeed } from "../../belt/belt";
import { DEFAULT_INSERTER_QUALITY, InserterType } from "./inserter-type";

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

/**
 * Refuses the inserters the model does not run, with the reason: one that burns fuel (its `energy_source` is a burner in
 * the game data, the burner inserter's), whose fuel the model does not carry; and one the data does not hold
 */
function assertSupportedInserter(prototype: string): void {
    if (FactorioDataService.findInserterOrThrow(prototype).energy_source.type === "burner") {
        throw new Error("The burner inserter is not supported: the burner inserter needs fuel");
    }
}

/**
 * The inserter prototype and quality the config names, checked against the game data: an unknown prototype or quality
 * and a burner inserter are refused with the reason.
 */
export function assertSupportedInserterKind(prototype: string, quality: string): void {
    assertSupportedInserter(prototype);
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

/** An inserter kind whose belt pickup timing was measured in the game, and the hand and belt stack it was measured with */
export interface BeltPickupCalibration {
    readonly prototype: string;
    readonly quality: string;
    /** The hand every belt pickup was measured with (docs/belt-pickup/experiments.md) */
    readonly hand_size: number;
    /** The belt stack every belt pickup was measured on */
    readonly belt_stack_size: number;
}

/**
 * The inserter kinds whose belt pickup timing (the arm model) is calibrated: one evidence row, the legendary stack
 * inserter with 16-item hands on 4-item belt stacks (decision D9, follow-up F7). A kind is added here only once it is
 * measured on belts. Everything that asks reads this row: the traits (timing.belt_pickup_calibrated), the arm gate
 * (simulation/components/belt-hand-pickup.ts), the scope check (config/inserter-scope.ts) and the warning for pickups
 * outside the calibration (config/pickup-calibration.ts).
 */
const BELT_PICKUP_CALIBRATED: readonly BeltPickupCalibration[] = [
    { prototype: InserterType.STACK_INSERTER, quality: "legendary", hand_size: 16, belt_stack_size: 4 },
];

/**
 * The calibration of an inserter's belt pickup (BELT_PICKUP_CALIBRATED), null for a kind not measured on belts; a kind
 * the config does not name is the default one (the legendary stack inserter)
 */
export function beltPickupCalibrationOf(kind: { prototype?: string; quality?: string }): BeltPickupCalibration | null {
    const prototype = kind.prototype ?? InserterType.STACK_INSERTER;
    const quality = kind.quality ?? DEFAULT_INSERTER_QUALITY;
    return BELT_PICKUP_CALIBRATED.find(row => row.prototype === prototype && row.quality === quality) ?? null;
}

/** Whether the belt pickup arm model is calibrated for an inserter of this prototype and quality (BELT_PICKUP_CALIBRATED) */
export function beltPickupCalibrated(prototype: string, quality: string): boolean {
    return beltPickupCalibrationOf({ prototype, quality }) !== null;
}

/**
 * The belt speeds the right-bend upstream pickup (pickup_layout "bend-right-upstream") is calibrated on: one evidence
 * row beside BELT_PICKUP_CALIBRATED, turbo belts, the only belt its curved lane lengths were measured on
 * (docs/belt-pickup/capture.md). A calibration gate, not a branch on the belt's kind: a speed is added here only once the
 * bend is measured on it.
 */
const BEND_RIGHT_UPSTREAM_CALIBRATED_BELT_SPEEDS: readonly number[] = [BeltSpeed.TURBO_TRANSPORT_BELT];

/** Whether the right-bend upstream pickup is calibrated on a belt of this speed (BEND_RIGHT_UPSTREAM_CALIBRATED_BELT_SPEEDS) */
export function bendRightUpstreamCalibrated(belt_speed: number): boolean {
    return BEND_RIGHT_UPSTREAM_CALIBRATED_BELT_SPEEDS.some(speed => speed === belt_speed);
}

/** The hand a config gives an inserter: its `stack_size` when it sets one, else the full research hand of its prototype */
export function configuredHandSize(inserter: { prototype?: string, stack_size?: number }): number {
    return inserter.stack_size ?? fullResearchHandSize(inserter.prototype ?? InserterType.STACK_INSERTER);
}
