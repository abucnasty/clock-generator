import { useCallback, useEffect, useState } from 'react';
import type { Config, InserterCoverageIssue, InserterFixOption } from 'clock-generator/browser';
import { ChestType } from 'clock-generator/browser';

const STORAGE_KEY = 'clock-generator-config';

export interface MachineFormData {
    id: number;
    recipe: string;
    productivity: number;
    crafting_speed: number;
    type?: 'machine' | 'furnace';
}

// Enable control override types
export type EnableControlMode = 'AUTO' | 'ALWAYS' | 'NEVER' | 'CLOCKED' | 'CONDITIONAL';

export interface EnableControlRange {
    start: number;
    end: number;
}

export type EntityReference = 'SOURCE' | 'SINK';
export type ComparisonOperator = '>' | '<' | '>=' | '<=' | '==' | '!=';
export type RuleOperator = 'AND' | 'OR';

export type ValueReference =
    | { type: 'CONSTANT'; value: number }
    | { type: 'INVENTORY_ITEM'; entity: EntityReference; item_name: string }
    | { type: 'AUTOMATED_INSERTION_LIMIT'; entity: EntityReference; item_name: string }
    | { type: 'OUTPUT_BLOCK'; entity: EntityReference }
    | { type: 'CRAFTING_PROGRESS'; entity: EntityReference }
    | { type: 'BONUS_PROGRESS'; entity: EntityReference }
    | { type: 'HAND_QUANTITY'; item_name?: string }
    | { type: 'MACHINE_STATUS'; entity: EntityReference; status: 'INGREDIENT_SHORTAGE' | 'WORKING' | 'OUTPUT_FULL' }
    | { type: 'INSERTER_STACK_SIZE' };

export interface Condition {
    left: ValueReference;
    operator: ComparisonOperator;
    right: ValueReference;
}

export interface RuleSet {
    operator: RuleOperator;
    rules: (Condition | RuleSet)[];
}

export interface LatchConfig {
    release: RuleSet;
}

export type EnableControlOverride =
    | { mode: 'AUTO' }
    | { mode: 'ALWAYS' }
    | { mode: 'NEVER' }
    | { mode: 'CLOCKED'; ranges: EnableControlRange[]; period_duration_ticks?: number }
    | { mode: 'CONDITIONAL'; rule_set: RuleSet; latch?: LatchConfig };

export interface InserterOverrides {
    animation?: {
        pickup_duration_ticks?: number;
    };
    enable_control?: EnableControlOverride;
}

export interface InserterFormData {
    source: { type: 'machine' | 'belt' | 'chest'; id: number };
    sink: { type: 'machine' | 'belt' | 'chest'; id: number };
    stack_size: number;
    filters?: string[];
    overrides?: InserterOverrides;
}

export interface BeltLaneFormData {
    ingredient: string;
    stack_size: number;
}

export interface BeltFormData {
    id: number;
    type: 'transport-belt' | 'fast-transport-belt' | 'express-transport-belt' | 'turbo-transport-belt';
    lanes: [BeltLaneFormData] | [BeltLaneFormData, BeltLaneFormData];
}

export const BELT_FORM_DEFAULT_TYPE = 'turbo-transport-belt';
export const BELT_FORM_DEFAULT_STACK_SIZE = 4;

export interface DrillOverrides {
    enable_control?: EnableControlOverride;
}

export interface DrillFormData {
    id: number;
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
    storage_size: number;
    item_filter: string;
}

// Infinity chest form data
export interface InfinityChestFormData {
    type: typeof ChestType.INFINITY_CHEST;
    id: number;
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
        disable_swing_backoff?: boolean;
    };
}

const createDefaultConfig = (): ConfigFormData => ({
    target_output: {
        recipe: '',
        items_per_second: 1,
        copies: 1,
    },
    machines: [
        {
            id: 1,
            recipe: '',
            productivity: 0,
            crafting_speed: 1,
        },
    ],
    inserters: [],
    belts: [],
    chests: [],
});

/** Migrate legacy chest data to include type field */
function migrateChests(chests: unknown[]): ChestFormData[] {
    return chests.map((chest: unknown) => {
        const c = chest as { type?: string; id: number; storage_size?: number; item_filter?: string | InfinityFilterFormData[] };
        // If already has a valid type, return as-is
        if (c.type === ChestType.INFINITY_CHEST) {
            return c as InfinityChestFormData;
        }
        // Default to buffer chest (handles legacy data without type)
        return {
            type: ChestType.BUFFER_CHEST,
            id: c.id,
            storage_size: c.storage_size ?? 1,
            item_filter: (typeof c.item_filter === 'string' ? c.item_filter : '') as string,
        };
    });
}

/** Load config from localStorage, returns default if not found or invalid */
function loadConfigFromStorage(): ConfigFormData {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            const parsed = JSON.parse(stored);
            // Basic validation - check if it has the required fields
            if (parsed && parsed.target_output && parsed.machines && parsed.chests) {
                // Migrate legacy chests
                parsed.chests = migrateChests(parsed.chests);
                return parsed as ConfigFormData;
            }
        }
    } catch (e) {
        console.warn('Failed to load config from localStorage:', e);
    }
    return createDefaultConfig();
}

/** Save config to localStorage */
function saveConfigToStorage(config: ConfigFormData): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch (e) {
        console.warn('Failed to save config to localStorage:', e);
    }
}

export interface UseConfigFormResult {
    config: ConfigFormData;
    setConfig: React.Dispatch<React.SetStateAction<ConfigFormData>>;
    
    // Target output
    updateTargetOutput: (field: keyof ConfigFormData['target_output'], value: string | number) => void;
    
    // Machines
    addMachine: () => void;
    updateMachine: (index: number, field: keyof MachineFormData, value: string | number) => void;
    removeMachine: (index: number) => void;
    mergeMachines: (machines: MachineFormData[]) => void;
    replaceMachines: (machines: MachineFormData[]) => void;
    
    // Inserters
    addInserter: () => void;
    updateInserter: (index: number, updates: Partial<InserterFormData>) => void;
    removeInserter: (index: number) => void;
    replaceInserters: (inserters: InserterFormData[]) => void;
    
    // Belts
    addBelt: () => void;
    updateBelt: (index: number, updates: Partial<BeltFormData>) => void;
    removeBelt: (index: number) => void;
    replaceBelts: (belts: BeltFormData[]) => void;
    
    // Chests
    addChest: (chestType?: ChestType) => void;
    updateChest: (index: number, updates: Partial<ChestFormData>) => void;
    switchChestType: (index: number, newType: ChestType) => void;
    removeChest: (index: number) => void;
    replaceChests: (chests: ChestFormData[]) => void;
    
    // Drills
    enableDrills: () => void;
    disableDrills: () => void;
    updateDrillsConfig: (field: 'mining_productivity_level', value: number) => void;
    addDrill: () => void;
    updateDrill: (index: number, updates: Partial<DrillFormData>) => void;
    removeDrill: (index: number) => void;
    mergeDrills: (drills: DrillFormData[]) => void;
    replaceDrills: (drills: DrillFormData[]) => void;
    
    // Overrides
    updateOverrides: (field: keyof NonNullable<ConfigFormData['overrides']>, value: number | boolean | undefined) => void;
    
    // Import/Export
    importConfig: (config: Config) => void;
    exportConfig: () => Config;
    resetConfig: () => void;

    // Inserter fix auto-fill
    applyInserterFix: (issue: InserterCoverageIssue, fix: InserterFixOption) => void;
}

export function useConfigForm(): UseConfigFormResult {
    const [config, setConfig] = useState<ConfigFormData>(loadConfigFromStorage);

    // Save config to localStorage whenever it changes
    useEffect(() => {
        saveConfigToStorage(config);
    }, [config]);

    // Target output
    const updateTargetOutput = useCallback((
        field: keyof ConfigFormData['target_output'],
        value: string | number
    ) => {
        setConfig((prev) => ({
            ...prev,
            target_output: {
                ...prev.target_output,
                [field]: value,
            },
        }));
    }, []);

    // Machines
    const addMachine = useCallback(() => {
        setConfig((prev) => {
            const maxId = Math.max(0, ...prev.machines.map((m) => m.id));
            return {
                ...prev,
                machines: [
                    ...prev.machines,
                    {
                        id: maxId + 1,
                        recipe: '',
                        productivity: 0,
                        crafting_speed: 1,
                    },
                ],
            };
        });
    }, []);

    const updateMachine = useCallback((
        index: number,
        field: keyof MachineFormData,
        value: string | number
    ) => {
        setConfig((prev) => ({
            ...prev,
            machines: prev.machines.map((m, i) =>
                i === index ? { ...m, [field]: value } : m
            ),
        }));
    }, []);

    const removeMachine = useCallback((index: number) => {
        setConfig((prev) => ({
            ...prev,
            machines: prev.machines.filter((_, i) => i !== index),
        }));
    }, []);

    const mergeMachines = useCallback((newMachines: MachineFormData[]) => {
        setConfig((prev) => {
            // Reassign IDs to avoid conflicts
            const maxId = Math.max(0, ...prev.machines.map((m) => m.id));
            const machinesWithNewIds = newMachines.map((m, i) => ({
                ...m,
                id: maxId + i + 1,
            }));
            return {
                ...prev,
                machines: [...prev.machines, ...machinesWithNewIds],
            };
        });
    }, []);

    const replaceMachines = useCallback((newMachines: MachineFormData[]) => {
        setConfig((prev) => ({
            ...prev,
            machines: newMachines,
        }));
    }, []);

    // Inserters
    const addInserter = useCallback(() => {
        setConfig((prev) => ({
            ...prev,
            inserters: [
                ...prev.inserters,
                {
                    source: { type: 'machine', id: 1 },
                    sink: { type: 'belt', id: 1 },
                    stack_size: 16,
                },
            ],
        }));
    }, []);

    const updateInserter = useCallback((index: number, updates: Partial<InserterFormData>) => {
        setConfig((prev) => ({
            ...prev,
            inserters: prev.inserters.map((ins, i) =>
                i === index ? { ...ins, ...updates } : ins
            ),
        }));
    }, []);

    const removeInserter = useCallback((index: number) => {
        setConfig((prev) => ({
            ...prev,
            inserters: prev.inserters.filter((_, i) => i !== index),
        }));
    }, []);

    const replaceInserters = useCallback((newInserters: InserterFormData[]) => {
        setConfig((prev) => ({
            ...prev,
            inserters: newInserters,
        }));
    }, []);

    // Belts
    const addBelt = useCallback(() => {
        setConfig((prev) => {
            const maxId = Math.max(0, ...prev.belts.map((b) => b.id));
            return {
                ...prev,
                belts: [
                    ...prev.belts,
                    {
                        id: maxId + 1,
                        type: BELT_FORM_DEFAULT_TYPE,
                        lanes: [{ ingredient: '', stack_size: BELT_FORM_DEFAULT_STACK_SIZE }] as [BeltLaneFormData],
                    },
                ],
            };
        });
    }, []);

    const updateBelt = useCallback((index: number, updates: Partial<BeltFormData>) => {
        setConfig((prev) => ({
            ...prev,
            belts: prev.belts.map((b, i) =>
                i === index ? { ...b, ...updates } : b
            ),
        }));
    }, []);

    const removeBelt = useCallback((index: number) => {
        setConfig((prev) => ({
            ...prev,
            belts: prev.belts.filter((_, i) => i !== index),
        }));
    }, []);

    const replaceBelts = useCallback((newBelts: BeltFormData[]) => {
        setConfig((prev) => ({
            ...prev,
            belts: newBelts,
        }));
    }, []);

    // Chests
    const addChest = useCallback((chestType: ChestType = ChestType.BUFFER_CHEST) => {
        setConfig((prev) => {
            const maxId = Math.max(0, ...prev.chests.map((c) => c.id));
            const newChest: ChestFormData = chestType === ChestType.BUFFER_CHEST
                ? {
                    type: ChestType.BUFFER_CHEST,
                    id: maxId + 1,
                    storage_size: 1,
                    item_filter: '',
                }
                : {
                    type: ChestType.INFINITY_CHEST,
                    id: maxId + 1,
                    item_filter: [{ item_name: '', request_count: 1 }],
                };
            return {
                ...prev,
                chests: [...prev.chests, newChest],
            };
        });
    }, []);

    const updateChest = useCallback((index: number, updates: Partial<ChestFormData>) => {
        setConfig((prev) => ({
            ...prev,
            chests: prev.chests.map((c, i) =>
                i === index ? { ...c, ...updates } as ChestFormData : c
            ),
        }));
    }, []);

    const switchChestType = useCallback((index: number, newType: ChestType) => {
        setConfig((prev) => ({
            ...prev,
            chests: prev.chests.map((c, i) => {
                if (i !== index) return c;
                // Preserve the ID when switching types
                if (newType === ChestType.BUFFER_CHEST) {
                    return {
                        type: ChestType.BUFFER_CHEST,
                        id: c.id,
                        storage_size: 1,
                        item_filter: '',
                    } as BufferChestFormData;
                } else {
                    return {
                        type: ChestType.INFINITY_CHEST,
                        id: c.id,
                        item_filter: [{ item_name: '', request_count: 1 }],
                    } as InfinityChestFormData;
                }
            }),
        }));
    }, []);

    const removeChest = useCallback((index: number) => {
        setConfig((prev) => ({
            ...prev,
            chests: prev.chests.filter((_, i) => i !== index),
        }));
    }, []);

    const replaceChests = useCallback((newChests: ChestFormData[]) => {
        setConfig((prev) => ({
            ...prev,
            chests: newChests,
        }));
    }, []);

    // Drills
    const enableDrills = useCallback(() => {
        setConfig((prev) => ({
            ...prev,
            drills: {
                mining_productivity_level: 0,
                configs: [],
            },
        }));
    }, []);

    const disableDrills = useCallback(() => {
        setConfig((prev) => {
            const { drills: _drills, ...rest } = prev;
            void _drills;
            return rest as ConfigFormData;
        });
    }, []);

    const updateDrillsConfig = useCallback((field: 'mining_productivity_level', value: number) => {
        setConfig((prev) => {
            if (!prev.drills) return prev;
            return {
                ...prev,
                drills: {
                    ...prev.drills,
                    [field]: value,
                },
            };
        });
    }, []);

    const addDrill = useCallback(() => {
        setConfig((prev) => {
            if (!prev.drills) return prev;
            const maxId = Math.max(0, ...prev.drills.configs.map((d) => d.id));
            return {
                ...prev,
                drills: {
                    ...prev.drills,
                    configs: [
                        ...prev.drills.configs,
                        {
                            id: maxId + 1,
                            type: 'electric-mining-drill' as const,
                            mined_item_name: '',
                            speed_bonus: 0,
                            target: { type: 'machine' as const, id: 1 },
                        },
                    ],
                },
            };
        });
    }, []);

    const updateDrill = useCallback((index: number, updates: Partial<DrillFormData>) => {
        setConfig((prev) => {
            if (!prev.drills) return prev;
            return {
                ...prev,
                drills: {
                    ...prev.drills,
                    configs: prev.drills.configs.map((d, i) =>
                        i === index ? { ...d, ...updates } : d
                    ),
                },
            };
        });
    }, []);

    const removeDrill = useCallback((index: number) => {
        setConfig((prev) => {
            if (!prev.drills) return prev;
            return {
                ...prev,
                drills: {
                    ...prev.drills,
                    configs: prev.drills.configs.filter((_, i) => i !== index),
                },
            };
        });
    }, []);

    const mergeDrills = useCallback((newDrills: DrillFormData[]) => {
        setConfig((prev) => {
            // If drills aren't enabled, enable them first
            const currentDrills = prev.drills ?? {
                mining_productivity_level: 0,
                configs: [],
            };
            
            // Reassign IDs to avoid conflicts
            const maxId = Math.max(0, ...currentDrills.configs.map((d) => d.id));
            const drillsWithNewIds = newDrills.map((d, i) => ({
                ...d,
                id: maxId + i + 1,
            }));
            
            return {
                ...prev,
                drills: {
                    ...currentDrills,
                    configs: [...currentDrills.configs, ...drillsWithNewIds],
                },
            };
        });
    }, []);

    const replaceDrills = useCallback((newDrills: DrillFormData[]) => {
        setConfig((prev) => {
            // If drills aren't enabled, enable them first
            const currentDrills = prev.drills ?? {
                mining_productivity_level: 0,
                configs: [],
            };
            
            return {
                ...prev,
                drills: {
                    ...currentDrills,
                    configs: newDrills,
                },
            };
        });
    }, []);

    // Overrides
    const updateOverrides = useCallback((
        field: keyof NonNullable<ConfigFormData['overrides']>,
        value: number | boolean | undefined
    ) => {
        setConfig((prev) => {
            const newOverrides = {
                ...prev.overrides,
                [field]: value,
            };
            // Remove null/undefined values
            Object.keys(newOverrides).forEach((key) => {
                const val = newOverrides[key as keyof typeof newOverrides];
                if (val === undefined || val === null) {
                    delete newOverrides[key as keyof typeof newOverrides];
                }
            });
            // If no overrides left, remove the object
            if (Object.keys(newOverrides).length === 0) {
                const { overrides: _overrides, ...rest } = prev;
                void _overrides;
                return rest as ConfigFormData;
            }
            return {
                ...prev,
                overrides: newOverrides,
            };
        });
    }, []);

    // Helper to convert imported enable control override to form data
    const mapEnableControlOverride = (ec: { 
        mode: string; 
        ranges?: { start: number; end: number }[]; 
        period_duration_ticks?: number;
        rule_set?: RuleSet;
        latch?: LatchConfig;
    }): EnableControlOverride => {
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
    };

    // Import/Export
    const importConfig = useCallback((imported: Config) => {
        const formData: ConfigFormData = {
            target_output: imported.target_output,
            machines: imported.machines.map((m) => ({
                id: m.id,
                recipe: m.recipe,
                productivity: m.productivity,
                crafting_speed: m.crafting_speed,
                type: m.type,
            })),
            inserters: imported.inserters.map((ins) => ({
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
                type: b.type,
                lanes: b.lanes as [BeltLaneFormData] | [BeltLaneFormData, BeltLaneFormData],
            })),
            chests: (imported.chests ?? []).map((c: { type?: string; id: number; storage_size?: number; item_filter: string | { item_name: string; request_count: number }[] }): ChestFormData => {
                // Handle infinity chest
                if (c.type === ChestType.INFINITY_CHEST) {
                    return {
                        type: ChestType.INFINITY_CHEST,
                        id: c.id,
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
                    storage_size: c.storage_size ?? 1,
                    item_filter: c.item_filter as string,
                };
            }),
            drills: imported.drills
                ? {
                    mining_productivity_level: imported.drills.mining_productivity_level,
                    configs: imported.drills.configs.map((d) => ({
                        id: d.id,
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
        setConfig(formData);
    }, []);

    const exportConfig = useCallback((): Config => {
        return config as Config;
    }, [config]);

    const resetConfig = useCallback(() => {
        localStorage.removeItem(STORAGE_KEY);
        setConfig(createDefaultConfig());
    }, []);

    const applyInserterFix = useCallback((
        issue: InserterCoverageIssue,
        fix: InserterFixOption,
    ) => {
        setConfig((prev) => {
            // ── helpers ──────────────────────────────────────────────────────
            const inferBeltType = (): BeltFormData['type'] => {
                if (prev.belts.length === 0) return BELT_FORM_DEFAULT_TYPE;
                const counts = new Map<string, number>();
                for (const belt of prev.belts) {
                    counts.set(belt.type, (counts.get(belt.type) ?? 0) + 1);
                }
                let best: BeltFormData['type'] = BELT_FORM_DEFAULT_TYPE;
                let max = 0;
                for (const [type, count] of counts) {
                    if (count > max) { max = count; best = type as BeltFormData['type']; }
                }
                return best;
            };

            const inferStackSize = (): number => {
                if (prev.inserters.length === 0) return BELT_FORM_DEFAULT_STACK_SIZE;
                const counts = new Map<number, number>();
                for (const ins of prev.inserters) {
                    counts.set(ins.stack_size, (counts.get(ins.stack_size) ?? 0) + 1);
                }
                let best = BELT_FORM_DEFAULT_STACK_SIZE;
                let max = 0;
                for (const [size, count] of counts) {
                    if (count > max) { max = count; best = size; }
                }
                return best;
            };

            const nextBeltId = () => Math.max(0, ...prev.belts.map((b) => b.id)) + 1;
            const nextChestId = () => Math.max(0, ...prev.chests.map((c) => c.id)) + 1;

            // ── machine → machine inserter (highest priority, no new belt/chest) ─
            if (fix.type === 'machine_to_machine') {
                const stackSize = inferStackSize();
                const newInserter: InserterFormData = {
                    source: { type: 'machine', id: fix.source_machine_id },
                    sink: { type: 'machine', id: issue.machine_id },
                    stack_size: stackSize,
                };
                return {
                    ...prev,
                    inserters: [...prev.inserters, newInserter],
                };
            }

            // ── add lane to existing belt (input only, no new inserter needed) ─
            if (fix.type === 'add_lane_to_existing_belt') {
                const beltIdx = prev.belts.findIndex((b) => b.id === fix.belt_id);
                if (beltIdx === -1 || prev.belts[beltIdx].lanes.length >= 2) return prev;
                const belt = prev.belts[beltIdx];
                const laneStackSize = belt.lanes[0]?.stack_size ?? BELT_FORM_DEFAULT_STACK_SIZE;
                const updatedBelt: BeltFormData = {
                    ...belt,
                    lanes: [
                        belt.lanes[0],
                        { ingredient: fix.item_name, stack_size: laneStackSize },
                    ] as [BeltLaneFormData, BeltLaneFormData],
                };
                return {
                    ...prev,
                    belts: prev.belts.map((b, i) => (i === beltIdx ? updatedBelt : b)),
                };
            }

            const stackSize = inferStackSize();

            // ── new belt + new inserter ───────────────────────────────────────
            if (fix.type === 'new_belt') {
                const newBeltId = nextBeltId();
                const newBelt: BeltFormData = {
                    id: newBeltId,
                    type: inferBeltType(),
                    lanes: [{ ingredient: fix.item_name, stack_size: stackSize }] as [BeltLaneFormData],
                };
                const newInserter: InserterFormData = issue.kind === 'missing_input_inserter'
                    ? { source: { type: 'belt', id: newBeltId }, sink: { type: 'machine', id: issue.machine_id }, stack_size: stackSize }
                    : { source: { type: 'machine', id: issue.machine_id }, sink: { type: 'belt', id: newBeltId }, stack_size: stackSize };
                return {
                    ...prev,
                    belts: [...prev.belts, newBelt],
                    inserters: [...prev.inserters, newInserter],
                };
            }

            // ── infinity chest + new inserter ────────────────────────────────
            if (fix.type === 'infinity_chest') {
                const newChestId = nextChestId();
                const newChest: InfinityChestFormData = {
                    type: ChestType.INFINITY_CHEST,
                    id: newChestId,
                    item_filter: [{ item_name: fix.item_name, request_count: 100 }],
                };
                const newInserter: InserterFormData = issue.kind === 'missing_input_inserter'
                    ? { source: { type: 'chest', id: newChestId }, sink: { type: 'machine', id: issue.machine_id }, stack_size: stackSize }
                    : { source: { type: 'machine', id: issue.machine_id }, sink: { type: 'chest', id: newChestId }, stack_size: stackSize };
                return {
                    ...prev,
                    chests: [...prev.chests, newChest],
                    inserters: [...prev.inserters, newInserter],
                };
            }

            return prev;
        });
    }, []);

    return {
        config,
        setConfig,
        updateTargetOutput,
        addMachine,
        updateMachine,
        removeMachine,
        mergeMachines,
        replaceMachines,
        addInserter,
        updateInserter,
        removeInserter,
        replaceInserters,
        addBelt,
        updateBelt,
        removeBelt,
        replaceBelts,
        addChest,
        updateChest,
        switchChestType,
        removeChest,
        replaceChests,
        enableDrills,
        disableDrills,
        updateDrillsConfig,
        addDrill,
        updateDrill,
        removeDrill,
        mergeDrills,
        replaceDrills,
        updateOverrides,
        importConfig,
        exportConfig,
        resetConfig,
        applyInserterFix,
    };
}
