import type {
    Config,
    Condition,
    EnableControlOverrideConfig,
    EnableControlRange,
    RuleSet,
    ValueReference,
} from 'clock-generator/browser';
import { ChestType, type BLOCKED_SLOT_MARKERS } from 'clock-generator/light';

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
    fuel?: Config['machines'][number]['fuel'];
}

// Enable rule types come from the engine's config schema
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
    source: { type: 'machine' | 'belt' | 'chest'; id: number;
        near_lane?: Extract<Config['inserters'][number]['source'], { type: 'belt' }>['near_lane'];
        pickup_capture?: Extract<Config['inserters'][number]['source'], { type: 'belt' }>['pickup_capture'];
        pickup_length?: Extract<Config['inserters'][number]['source'], { type: 'belt' }>['pickup_length'];
        pickup_layout?: Extract<Config['inserters'][number]['source'], { type: 'belt' }>['pickup_layout'];
        drop?: Extract<Config['inserters'][number]['source'], { type: 'belt' }>['drop'] };
    sink: { type: 'machine' | 'belt' | 'chest'; id: number;
        drop?: Extract<Config['inserters'][number]['sink'], { type: 'belt' }>['drop'] };
    prototype?: string;
    quality?: Config['inserters'][number]['quality'];
    /** Omitted means the prototype's fully researched capacity (Automatic). */
    stack_size?: number;
    filters?: string[];
    /** How the game reads `filters`; a blacklist with filters is refused by the engine, so it is kept as captured */
    filter_mode?: Config['inserters'][number]['filter_mode'];
    overrides?: InserterOverrides;
    /** UI-only, never part of the exported config: set when Exclude from LCM forced this inserter's rule to ALWAYS
     *  (its items are all excluded), so that including one of them again may take that ALWAYS away. Replacing the
     *  rule clears it. */
    _forced_always?: true;
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

/** A car's, a tank's, a cargo wagon's or a rocket silo's settings, kept while the chest is switched to another type */
export interface ContainerSettingsMemory {
    slot_filters?: SlotFilterFormData[];
    slot_contents?: SlotContentFormData[];
    quality?: QualityName;
    recipe_quality?: QualityName;
    crafting_speed?: number;
    productivity?: number;
    silo_contents?: ItemCountFormData[];
}

/** Form-only settings retained while switching chest types; never sent to the backend. */
interface ChestSettingsMemory {
    _chest_settings?: { infinity_filters?: InfinityFilterFormData[]; remove_unfiltered_items?: boolean; buffer_filter?: string; storage_size?: number;
        container?: ContainerSettingsMemory };
}

// Buffer chest form data
export interface BufferChestFormData extends ChestSettingsMemory {
    type: typeof ChestType.BUFFER_CHEST;
    id: number;
    /** Internal UUID — see MachineFormData._uuid. */
    _uuid: string;
    storage_size: number;
    item_filter: string;
}

// Infinity chest form data
export interface InfinityChestFormData extends ChestSettingsMemory {
    type: typeof ChestType.INFINITY_CHEST;
    id: number;
    /** Internal UUID — see MachineFormData._uuid. */
    _uuid: string;
    item_filter: InfinityFilterFormData[];
    remove_unfiltered_items?: boolean;
}

/**
 * A car, a tank, a cargo wagon or a rocket silo, in the config's own shape: the form edits its fields and saves them as
 * they are, leaving out only rows without an item
 */
type ChestConfig = NonNullable<Config['chests']>[number];
type ContainerChestConfig = Exclude<ChestConfig, { type: typeof ChestType.BUFFER_CHEST } | { type: typeof ChestType.INFINITY_CHEST }>;
type ConfigSlotFilter = NonNullable<Extract<ContainerChestConfig, { slot_filters?: unknown }>['slot_filters']>[number];
export type BlockedSlotMarker = typeof BLOCKED_SLOT_MARKERS[number];
/** A slot filter as the form keeps it: a blocked slot remembers the marker painted on it, which the config leaves out */
export type SlotFilterFormData = Exclude<ConfigSlotFilter, { blocked: true }> | (Extract<ConfigSlotFilter, { blocked: true }> & { _marker?: BlockedSlotMarker });
type WithFormSlotFilters<T> = T extends { slot_filters?: unknown } ? Omit<T, 'slot_filters'> & { slot_filters?: SlotFilterFormData[] } : T;
export type ContainerChestFormData = WithFormSlotFilters<ContainerChestConfig> & ChestSettingsMemory & { _uuid: string };
export type SlotContainerFormData = Exclude<ContainerChestFormData, { type: typeof ChestType.ROCKET_SILO }>;
export type RocketSiloFormData = Extract<ContainerChestFormData, { type: typeof ChestType.ROCKET_SILO }>;
export type SlotContentFormData = NonNullable<SlotContainerFormData['contents']>[number];
export type ItemCountFormData = NonNullable<RocketSiloFormData['contents']>[number];
export type QualityName = NonNullable<RocketSiloFormData['recipe_quality']>;

/** The qualities of the game, lowest first, with the names the player sees */
export const QUALITIES: readonly { value: QualityName; label: string }[] = [
    { value: 'normal', label: 'Normal' },
    { value: 'uncommon', label: 'Uncommon' },
    { value: 'rare', label: 'Rare' },
    { value: 'epic', label: 'Epic' },
    { value: 'legendary', label: 'Legendary' },
];

/** Every chest type, in the order the form offers them, with the name the player sees */
export const CHEST_TYPE_LABELS: Record<ChestType, string> = {
    [ChestType.BUFFER_CHEST]: 'Buffer chest',
    [ChestType.INFINITY_CHEST]: 'Infinity chest',
    [ChestType.CAR]: 'Car',
    [ChestType.TANK]: 'Tank',
    [ChestType.CARGO_WAGON]: 'Cargo wagon',
    [ChestType.ROCKET_SILO]: 'Rocket silo',
};
export const CHEST_TYPES = Object.keys(CHEST_TYPE_LABELS) as ChestType[];
/** The types that are not plain chests: a car, a tank, a cargo wagon and a rocket silo */
export const CONTAINER_CHEST_TYPES = CHEST_TYPES.filter(type => type !== ChestType.BUFFER_CHEST && type !== ChestType.INFINITY_CHEST);

/** The icon of a chest type: a buffer chest is drawn as a steel chest, the others as themselves */
export function chestTypeIcon(type: ChestType | undefined): string {
    return type === undefined || type === ChestType.BUFFER_CHEST ? 'steel-chest' : type;
}

// Discriminated union for chest types
export type ChestFormData = BufferChestFormData | InfinityChestFormData | ContainerChestFormData;

// Type guards - handle legacy data without type field (default to buffer chest)
export function isBufferChest(chest: ChestFormData): chest is BufferChestFormData {
    return chest.type === ChestType.BUFFER_CHEST || !('type' in chest) || chest.type === undefined;
}

export function isInfinityChest(chest: ChestFormData): chest is InfinityChestFormData {
    return chest.type === ChestType.INFINITY_CHEST;
}

export function isContainerChest(chest: ChestFormData): chest is ContainerChestFormData {
    return !isBufferChest(chest) && !isInfinityChest(chest);
}

export function isRocketSilo(chest: ChestFormData): chest is RocketSiloFormData {
    return chest.type === ChestType.ROCKET_SILO;
}

/** The items a car, a tank, a cargo wagon or a rocket silo names: what it starts with and what its slots are filtered to */
export function containerItems(chest: ContainerChestFormData | Exclude<ChestConfig, { type: typeof ChestType.BUFFER_CHEST } | { type: typeof ChestType.INFINITY_CHEST }>): string[] {
    const filtered = 'slot_filters' in chest ? (chest.slot_filters ?? []).flatMap(filter => filter.blocked ? [] : [filter.item]) : [];
    return Array.from(new Set([...(chest.contents ?? []).map(content => content.item), ...filtered]));
}

/** The items a chest of a config names: a buffer chest's filter, an infinity chest's supplies, a container's items */
export function chestConfigItems(chest: ChestConfig): string[] {
    if (chest.type === ChestType.BUFFER_CHEST) return [chest.item_filter];
    if (chest.type === ChestType.INFINITY_CHEST) return chest.item_filter.map(filter => filter.item_name);
    return containerItems(chest);
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
    overrides?: Config['overrides'];
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
