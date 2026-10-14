import type { Config, RuleSet } from 'clock-generator/browser';
import { ChestType } from 'clock-generator/light';
import type {
    BeltLaneFormData,
    ChestFormData,
    ConfigFormData,
    EnableControlOverride,
    LatchConfig,
} from './formData';

// Helper to convert imported enable control override to form data
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
        })),
        inserters: imported.inserters.map((ins, index) => ({
            id: ins.id ?? (index + 1),
            _uuid: crypto.randomUUID(),
            source: ins.source,
            sink: ins.sink,
            stack_size: ins.stack_size,
            filters: ins.filters,
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
            ...(b.strategy === 'export' && { strategy: b.strategy }),
            lanes: b.lanes as [BeltLaneFormData] | [BeltLaneFormData, BeltLaneFormData],
        })),
        chests: (imported.chests ?? []).map((c: { type?: string; id: number; storage_size?: number; item_filter: string | { item_name: string; request_count: number }[] }): ChestFormData => {
            // Handle infinity chest
            if (c.type === ChestType.INFINITY_CHEST) {
                return {
                    type: ChestType.INFINITY_CHEST,
                    id: c.id,
                    _uuid: crypto.randomUUID(),
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
                mining_productivity_level: imported.drills.mining_productivity_level,
                configs: imported.drills.configs.map((d) => ({
                    id: d.id,
                    _uuid: crypto.randomUUID(),
                    type: d.type,
                    mined_item_name: d.mined_item_name,
                    speed_bonus: d.speed_bonus,
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

/** The config of the form state, for export, validation and generation */
export function formDataToConfig(config: ConfigFormData): Config {
    // Strip the UI-only fields (every entity's _uuid, an inserter's _forced_always) before handing the config to any
    // external consumer.
    return {
        ...config,
        machines: config.machines.map(toConfig),
        inserters: config.inserters.map(({ _forced_always: _f, ...ins }) => { void _f; return toConfig(ins); }),
        belts: config.belts.map(toConfig),
        chests: config.chests.map(toConfig),
        ...(config.drills && {
            drills: { ...config.drills, configs: config.drills.configs.map(toConfig) },
        }),
    } as Config;
}
