import type { Config, RuleSet } from 'clock-generator/browser';
import { ChestType } from 'clock-generator/light';
import { withDefaultPickupType } from '../pickupGeometry';
import { isContainerChest } from './formData';
import { formSlotFilters } from '../containerSlotFilters';
import type {
    BeltLaneFormData,
    ChestFormData,
    ConfigFormData,
    ContainerChestFormData,
    EnableControlOverride,
    SlotFilterFormData,
    LatchConfig,
} from './formData';

// Helper to convert imported enable rule to form data
function mapEnableControlOverride(ec: {
    mode: string;
    ranges?: { start: number; end: number }[];
    period_duration_ticks?: number;
    rule_set?: RuleSet;
    latch?: LatchConfig;
}): EnableControlOverride {
    switch (ec.mode) {
        case 'AUTO':
            return { mode: 'AUTO' };
        case 'ALWAYS':
            return { mode: 'ALWAYS' };
        case 'NEVER':
            return { mode: 'NEVER' };
        case 'CLOCKED':
            return {
                mode: 'CLOCKED',
                ranges: ec.ranges?.map(r => ({ start: r.start, end: r.end })) ?? [],
                period_duration_ticks: ec.period_duration_ticks,
            };
        case 'CONDITIONAL':
            return {
                mode: 'CONDITIONAL',
                rule_set: ec.rule_set ?? { operator: 'AND', rules: [] },
                latch: ec.latch,
            };
        default:
            return { mode: 'AUTO' };
    }
}

/** The form state of an imported config */
export function configToFormData(imported: Config): ConfigFormData {
    return {
        target_output: imported.target_output,
        machines: imported.machines.map((m) => ({
            id: m.id,
            _uuid: crypto.randomUUID(),
            recipe: m.recipe,
            productivity: m.productivity,
            crafting_speed: m.crafting_speed,
            type: m.type,
            energy_consumption_bonus: m.energy_consumption_bonus,
            ...(m.fuel !== undefined && { fuel: m.fuel }),
        })),
        inserters: imported.inserters.map((ins, index) => ({
            id: ins.id ?? (index + 1),
            _uuid: crypto.randomUUID(),
            source: ins.source,
            sink: ins.sink,
            prototype: ins.prototype,
            quality: ins.quality,
            stack_size: ins.stack_size,
            filters: ins.filters,
            ...(ins.filter_mode !== undefined && { filter_mode: ins.filter_mode }),
            overrides: ins.overrides ? {
                animation: ins.overrides.animation,
                enable_control: ins.overrides.enable_control
                    ? mapEnableControlOverride(ins.overrides.enable_control)
                    : undefined,
            } : undefined,
        })),
        belts: imported.belts.map((b) => ({
            id: b.id,
            _uuid: crypto.randomUUID(),
            type: b.type,
            ...(b.strategy !== undefined && { strategy: b.strategy }),
            lanes: b.lanes as [BeltLaneFormData] | [BeltLaneFormData, BeltLaneFormData],
        })),
        chests: (imported.chests ?? []).map((raw): ChestFormData => {
            // a car, a tank, a cargo wagon or a rocket silo is kept as it is: the form does not edit it yet
            if (raw.type !== undefined && raw.type !== ChestType.BUFFER_CHEST && raw.type !== ChestType.INFINITY_CHEST) {
                return { ...raw, ...('slot_filters' in raw && raw.slot_filters && { slot_filters: formSlotFilters(raw.slot_filters) }),
                    _uuid: crypto.randomUUID() } as ChestFormData;
            }
            const c = raw as { type?: string; id: number; storage_size?: number; remove_unfiltered_items?: boolean; item_filter: string | { item_name: string; request_count: number }[] };
            // Handle infinity chest
            if (c.type === ChestType.INFINITY_CHEST) {
                return {
                    type: ChestType.INFINITY_CHEST,
                    id: c.id,
                    _uuid: crypto.randomUUID(),
                    ...(c.remove_unfiltered_items !== undefined && { remove_unfiltered_items: c.remove_unfiltered_items }),
                    item_filter: (c.item_filter as { item_name: string; request_count: number }[]).map(f => ({
                        item_name: f.item_name,
                        request_count: f.request_count,
                    })),
                };
            }
            // Default to buffer chest (for backwards compatibility)
            return {
                type: ChestType.BUFFER_CHEST,
                id: c.id,
                _uuid: crypto.randomUUID(),
                storage_size: c.storage_size ?? 1,
                item_filter: c.item_filter as string,
            };
        }),
        drills: imported.drills
            ? {
                configs: imported.drills.configs.map((d) => ({
                    id: d.id,
                    _uuid: crypto.randomUUID(),
                    type: d.type,
                    mined_item_name: d.mined_item_name,
                    speed_bonus: d.speed_bonus,
                    productivity: d.productivity,
                    target: d.target,
                    overrides: d.overrides?.enable_control ? {
                        enable_control: mapEnableControlOverride(d.overrides.enable_control),
                    } : undefined,
                })),
            }
            : undefined,
        overrides: imported.overrides,
    };
}

/** Converts a single form-data entity to its config equivalent, stripping UI-only fields. */
function toConfig<T extends { _uuid: string }>({ _uuid: _, ...rest }: T) { void _; return rest; }

/**
 * A car, a tank, a cargo wagon or a rocket silo as the config takes it: its rows of slot filters and contents without an
 * item yet are left out, a blocked slot is `blocked: true` without the marker painted on it, and the fields left unset
 * are left out
 */
function containerConfig(chest: ContainerChestFormData): ContainerChestFormData {
    const named = <T extends { item: string }>(rows: T[] | undefined) => rows?.filter(row => row.item.trim() !== '');
    const slot_filters = 'slot_filters' in chest ? chest.slot_filters?.flatMap((row): SlotFilterFormData[] => row.blocked
        ? [{ slot: row.slot, blocked: true }] : row.item.trim() !== '' ? [row] : []) : undefined;
    const rows = { ...('slot_filters' in chest && { slot_filters }), contents: named<{ item: string }>(chest.contents) };
    return Object.fromEntries(Object.entries({ ...chest, ...rows }).filter(([, value]) => value !== undefined)) as unknown as ContainerChestFormData;
}

/** The config of the form state, for export, validation and generation */
export function formDataToConfig(config: ConfigFormData): Config {
    // Strip the UI-only fields (every entity's _uuid, an inserter's _forced_always) before handing the config to any
    // external consumer.
    return {
        ...config,
        machines: config.machines.map(toConfig),
        inserters: config.inserters.map(({ _forced_always: _f, ...ins }) => {
            void _f;
            return toConfig({ ...ins, source: withDefaultPickupType(ins.source) });
        }),
        belts: config.belts.map(toConfig),
        chests: config.chests.map(({ _chest_settings: memory, ...chest }) => {
            void memory;
            if (chest.type === ChestType.INFINITY_CHEST) {
                return toConfig({ ...chest, item_filter: chest.item_filter.filter(filter => filter.item_name.trim() !== '') });
            }
            if (isContainerChest(chest)) return toConfig(containerConfig(chest));
            return toConfig(chest);
        }),
        ...(config.drills && {
            drills: { ...config.drills, configs: config.drills.configs.map(toConfig) },
        }),
    } as Config;
}
