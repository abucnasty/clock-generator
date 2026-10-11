import { MapExtended } from "../data-types";
import { EntityType } from "../entities";
import { DrillStatus, InserterStatus, MachineStatus } from "./index";

/**
 * Simplified status categories for high-level visualization.
 * Maps detailed statuses to broader categories.
 */
export const StatusCategory = {
    /** Entity is actively performing its primary function */
    ACTIVE: 'ACTIVE',
    /** Entity is waiting for something (e.g., ingredients) */
    WAITING: 'WAITING',
    /** Entity is blocked and cannot proceed (e.g., output full) */
    BLOCKED: 'BLOCKED',
    /** Entity is disabled by control logic (e.g., clock signal) */
    DISABLED: 'DISABLED',
    /** Entity is idle with nothing to do */
    IDLE: 'IDLE',
} as const;

export type StatusCategory = typeof StatusCategory[keyof typeof StatusCategory];

const INSERTER_STATUS_MAP: MapExtended<InserterStatus, StatusCategory> = new MapExtended([
    [InserterStatus.PICKUP, StatusCategory.ACTIVE],
    [InserterStatus.DROP_OFF, StatusCategory.ACTIVE],
    [InserterStatus.SWING, StatusCategory.ACTIVE],
    [InserterStatus.IDLE, StatusCategory.IDLE],
    [InserterStatus.DISABLED, StatusCategory.DISABLED],
    [InserterStatus.TARGET_FULL, StatusCategory.BLOCKED],
    [InserterStatus.WAITING_FOR_SINK, StatusCategory.BLOCKED],
])

const MACHINE_STATUS_MAP: MapExtended<MachineStatus, StatusCategory> = new MapExtended([
    [MachineStatus.WORKING, StatusCategory.ACTIVE],
    [MachineStatus.INGREDIENT_SHORTAGE, StatusCategory.WAITING],
    [MachineStatus.OUTPUT_FULL, StatusCategory.BLOCKED],
    [MachineStatus.NO_FUEL, StatusCategory.WAITING],
]);

const DRILL_STATUS_MAP: MapExtended<DrillStatus, StatusCategory> = new MapExtended([
    [DrillStatus.WORKING, StatusCategory.ACTIVE],
    [DrillStatus.DISABLED, StatusCategory.DISABLED],
]);

/**
 * Map any entity status string to a StatusCategory based on entity type
 */
export function statusToCategory(
    entityType: EntityType,
    status: string
): StatusCategory {
    switch (entityType) {
        case EntityType.INSERTER:
            return INSERTER_STATUS_MAP.getOrThrow(status as InserterStatus);
        case EntityType.MACHINE:
            return MACHINE_STATUS_MAP.getOrThrow(status as MachineStatus);
        case EntityType.DRILL:
            return DRILL_STATUS_MAP.getOrThrow(status as DrillStatus);
        default:
            throw new Error(`Unknown entity type: ${entityType}`);
    }
}

/**
 * Get all status categories
 */
export function getAllStatusCategories(): StatusCategory[] {
    return Object.values(StatusCategory);
}
