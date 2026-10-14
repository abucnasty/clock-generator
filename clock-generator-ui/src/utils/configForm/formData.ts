import type {
    Condition,
    EnableControlOverrideConfig,
    EnableControlRange,
    RuleSet,
    ValueReference,
} from 'clock-generator/browser';
import { ChestType } from 'clock-generator/browser';

export interface MachineFormData {
    id: number;
    /** Internal UUID used to track this entity in the UI (e.g. for drag-and-drop).
     *  Not related to the numeric `id` that ends up in exported configs. */
    _uuid: string;
    recipe: string;
    productivity: number;
    crafting_speed: number;
    type?: 'machine' | 'furnace' | 'biochamber';
    /** Energy consumption effect in percent; only used by biochambers. */
    energy_consumption_bonus?: number;
}

// Enable control override types come from the engine's config schema
export type { Condition, EnableControlRange, RuleSet, ValueReference };
export type EnableControlOverride = EnableControlOverrideConfig;
export type LatchConfig = NonNullable<Extract<EnableControlOverride, { mode: 'CONDITIONAL' }>['latch']>;

export interface InserterOverrides {
    animation?: {
        pickup_duration_ticks?: number;
    };
    enable_control?: EnableControlOverride;
}

export interface InserterFormData {
    id: number;
    /** Internal UUID — see MachineFormData._uuid. */
    _uuid: string;
    /** `near_lane`: of a belt, the lane nearest to the inserter (1 or 2, by its place in the belt's lanes), which it takes from first */
    source: { type: 'machine' | 'belt' | 'chest'; id: number; near_lane?: 1 | 2 };
    sink: { type: 'machine' | 'belt' | 'chest'; id: number };
    stack_size: number;
    filters?: string[];
    overrides?: InserterOverrides;
}

export interface BeltLaneFormData {
    ingredient: string;
    stack_size: number;
    /** Export belts only: items per second taken off this lane by consumers outside the config */
    consumption_per_second?: number;
}

export type BeltStrategyFormValue = 'normal' | 'export';

export interface BeltFormData {
    id: number;
    /** Internal UUID — see MachineFormData._uuid. */
    _uuid: string;
    type: 'transport-belt' | 'fast-transport-belt' | 'express-transport-belt' | 'turbo-transport-belt';
    strategy?: BeltStrategyFormValue;
    lanes: [BeltLaneFormData] | [BeltLaneFormData, BeltLaneFormData];
}

export const BELT_FORM_DEFAULT_TYPE = 'turbo-transport-belt';
export const BELT_FORM_DEFAULT_STACK_SIZE = 4;

export const BELT_STRATEGIES: { value: BeltStrategyFormValue; label: string; description: string }[] = [
    { value: 'normal', label: 'Normal', description: 'Endless: always has items to pick up and room to drop onto.' },
    { value: 'export', label: 'Export', description: 'Normal, plus a consumption rate per lane for machines outside this config. Inserters filling the lane are clocked for that rate.' },
];

export const LANE_CONSUMPTION_TOOLTIP =
    'Items per second taken off this lane by machines outside this config. Inserters filling the lane are planned for this rate.';

/** Switching a belt to normal drops the lane consumption rates only export belts have */
export function beltStrategyUpdate(belt: BeltFormData, strategy: BeltStrategyFormValue): Partial<BeltFormData> {
    if (strategy === 'export') {
        return { strategy };
    }
    const lanes = belt.lanes.map((lane) => ({ ingredient: lane.ingredient, stack_size: lane.stack_size })) as BeltFormData['lanes'];
    return { strategy: undefined, lanes };
}

export interface DrillOverrides {
    enable_control?: EnableControlOverride;
}

export interface DrillFormData {
    id: number;
    /** Internal UUID — see MachineFormData._uuid. */
    _uuid: string;
    type: 'electric-mining-drill' | 'burner-mining-drill' | 'big-mining-drill';
    mined_item_name: string;
    speed_bonus: number;
    target: { type: 'machine'; id: number };
    overrides?: DrillOverrides;
}

// Infinity chest filter for item_name + request_count pairs
export interface InfinityFilterFormData {
    item_name: string;
    request_count: number;
}

// Buffer chest form data
export interface BufferChestFormData {
    type: typeof ChestType.BUFFER_CHEST;
    id: number;
    /** Internal UUID — see MachineFormData._uuid. */
    _uuid: string;
    storage_size: number;
    item_filter: string;
}

// Infinity chest form data
export interface InfinityChestFormData {
    type: typeof ChestType.INFINITY_CHEST;
    id: number;
    /** Internal UUID — see MachineFormData._uuid. */
    _uuid: string;
    item_filter: InfinityFilterFormData[];
}

// Discriminated union for chest types
export type ChestFormData = BufferChestFormData | InfinityChestFormData;

// Type guards - handle legacy data without type field (default to buffer chest)
export function isBufferChest(chest: ChestFormData): chest is BufferChestFormData {
    return chest.type === ChestType.BUFFER_CHEST || !('type' in chest) || chest.type === undefined;
}

export function isInfinityChest(chest: ChestFormData): chest is InfinityChestFormData {
    return chest.type === ChestType.INFINITY_CHEST;
}

/** The kinds of entity of the form, which number their entities each on their own */
export type EntityKind = 'machines' | 'inserters' | 'belts' | 'chests' | 'drills';

export interface ConfigFormData {
    target_output: {
        recipe: string;
        items_per_second: number;
        /** Number of duplicate setups being modeled (multiplier for ratio calculations) */
        copies: number;
    };
    machines: MachineFormData[];
    inserters: InserterFormData[];
    belts: BeltFormData[];
    chests: ChestFormData[];
    drills?: {
        mining_productivity_level: number;
        configs: DrillFormData[];
    };
    overrides?: {
        lcm?: number;
        terminal_swing_count?: number;
        use_fractional_swings?: boolean;
        non_moving_belts?: boolean;
        search_for_fewer_wake_ups?: boolean;
        ignored_lcm_ingredients?: string[];
    };
    /** UI-only: of each kind, an id past those of the entities removed from it, so that a new entity does not get one
     *  of them, which references to the removed entity may still hold. Missing in forms saved before it. */
    next_ids?: Partial<Record<EntityKind, number>>;
}

export const createDefaultConfig = (): ConfigFormData => ({
    target_output: {
        recipe: '',
        items_per_second: 1,
        copies: 1,
    },
    machines: [
        {
            id: 1,
            _uuid: crypto.randomUUID(),
            recipe: '',
            productivity: 0,
            crafting_speed: 1,
        },
    ],
    inserters: [],
    belts: [],
    chests: [],
});
