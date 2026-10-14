import type { SerializableTransferPlan } from 'clock-generator/browser';
import { ChestType } from 'clock-generator/browser';
import {
    BELT_FORM_DEFAULT_STACK_SIZE,
    BELT_FORM_DEFAULT_TYPE,
    type BeltFormData,
    type BeltLaneFormData,
    type BufferChestFormData,
    type ChestFormData,
    type ConfigFormData,
    type DrillFormData,
    type InfinityChestFormData,
    type InserterFormData,
    type MachineFormData,
} from './formData';

// Plain edits of the form state: each takes the state and returns the edited state, for `setConfig`

/** The id for a new entity after the given ones */
export function nextId(items: { id: number }[]): number {
    return Math.max(0, ...items.map((item) => item.id)) + 1;
}

/** Rearrange an id-bearing array and reassign sequential ids (1-based). Returns the new array and an old→new id map. */
function reorderWithIdReassignment<T extends { id: number }>(
    items: T[],
    fromIndex: number,
    toIndex: number,
): { items: T[]; idMap: Map<number, number> } {
    const reordered = [...items];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    const idMap = new Map<number, number>();
    reordered.forEach((item, i) => {
        const newId = i + 1;
        if (item.id !== newId) idMap.set(item.id, newId);
    });
    const reassigned = reordered.map((item, i) => ({ ...item, id: i + 1 }));
    return { items: reassigned, idMap };
}

// Target output
export function updateTargetOutput(
    prev: ConfigFormData,
    field: keyof ConfigFormData['target_output'],
    value: string | number,
): ConfigFormData {
    return {
        ...prev,
        target_output: {
            ...prev.target_output,
            [field]: value,
        },
    };
}

// Machines
export function addMachine(prev: ConfigFormData): ConfigFormData {
    return {
        ...prev,
        machines: [
            ...prev.machines,
            {
                id: nextId(prev.machines),
                _uuid: crypto.randomUUID(),
                recipe: '',
                productivity: 0,
                crafting_speed: 1,
            }
        ],
    };
}

export function updateMachine(
    prev: ConfigFormData,
    index: number,
    field: keyof MachineFormData,
    value: string | number,
): ConfigFormData {
    return {
        ...prev,
        machines: prev.machines.map((m, i) =>
            i === index ? { ...m, [field]: value } : m
        ),
    };
}

export function removeMachine(prev: ConfigFormData, index: number): ConfigFormData {
    return {
        ...prev,
        machines: prev.machines.filter((_, i) => i !== index),
    };
}

export function mergeMachines(prev: ConfigFormData, newMachines: MachineFormData[]): ConfigFormData {
    // Reassign IDs to avoid conflicts
    const firstId = nextId(prev.machines);
    const machinesWithNewIds = newMachines.map((m, i) => ({
        ...m,
        id: firstId + i,
        _uuid: crypto.randomUUID(),
    }));
    return {
        ...prev,
        machines: [...prev.machines, ...machinesWithNewIds],
    };
}

export function replaceMachines(prev: ConfigFormData, newMachines: MachineFormData[]): ConfigFormData {
    return {
        ...prev,
        machines: newMachines,
    };
}

// Inserters
export function addInserter(prev: ConfigFormData): ConfigFormData {
    return {
        ...prev,
        inserters: [
            ...prev.inserters,
            {
                id: nextId(prev.inserters),
                _uuid: crypto.randomUUID(),
                source: { type: 'machine', id: 1 },
                sink: { type: 'belt', id: 1 },
                stack_size: 16,
            }
        ],
    };
}

export function updateInserter(prev: ConfigFormData, index: number, updates: Partial<InserterFormData>): ConfigFormData {
    return {
        ...prev,
        inserters: prev.inserters.map((ins, i) =>
            i === index ? { ...ins, ...updates } : ins
        ),
    };
}

export function removeInserter(prev: ConfigFormData, index: number): ConfigFormData {
    return {
        ...prev,
        inserters: prev.inserters.filter((_, i) => i !== index),
    };
}

export function replaceInserters(prev: ConfigFormData, newInserters: InserterFormData[]): ConfigFormData {
    return {
        ...prev,
        inserters: newInserters,
    };
}

// Belts
export function addBelt(prev: ConfigFormData): ConfigFormData {
    return {
        ...prev,
        belts: [
            ...prev.belts,
            {
                id: nextId(prev.belts),
                _uuid: crypto.randomUUID(),
                type: BELT_FORM_DEFAULT_TYPE,
                lanes: [{ ingredient: '', stack_size: BELT_FORM_DEFAULT_STACK_SIZE }] as [BeltLaneFormData],
            },
        ],
    };
}

export function updateBelt(prev: ConfigFormData, index: number, updates: Partial<BeltFormData>): ConfigFormData {
    return {
        ...prev,
        belts: prev.belts.map((b, i) =>
            i === index ? { ...b, ...updates } : b
        ),
    };
}

export function removeBelt(prev: ConfigFormData, index: number): ConfigFormData {
    return {
        ...prev,
        belts: prev.belts.filter((_, i) => i !== index),
    };
}

export function replaceBelts(prev: ConfigFormData, newBelts: BeltFormData[]): ConfigFormData {
    return {
        ...prev,
        belts: newBelts,
    };
}

// Chests
export function addChest(prev: ConfigFormData, chestType: ChestType = ChestType.BUFFER_CHEST): ConfigFormData {
    const id = nextId(prev.chests);
    const newChest: ChestFormData = chestType === ChestType.BUFFER_CHEST
        ? {
            type: ChestType.BUFFER_CHEST,
            id,
            _uuid: crypto.randomUUID(),
            storage_size: 1,
            item_filter: '',
        }
        : {
            type: ChestType.INFINITY_CHEST,
            id,
            _uuid: crypto.randomUUID(),
            item_filter: [{ item_name: '', request_count: 1 }],
        };
    return {
        ...prev,
        chests: [...prev.chests, newChest],
    };
}

export function updateChest(prev: ConfigFormData, index: number, updates: Partial<ChestFormData>): ConfigFormData {
    return {
        ...prev,
        chests: prev.chests.map((c, i) =>
            i === index ? { ...c, ...updates } as ChestFormData : c
        ),
    };
}

export function switchChestType(prev: ConfigFormData, index: number, newType: ChestType): ConfigFormData {
    return {
        ...prev,
        chests: prev.chests.map((c, i) => {
            if (i !== index) return c;
            // Preserve the ID when switching types
            if (newType === ChestType.BUFFER_CHEST) {
                return {
                    type: ChestType.BUFFER_CHEST,
                    id: c.id,
                    _uuid: c._uuid,
                    storage_size: 1,
                    item_filter: '',
                } as BufferChestFormData;
            } else {
                return {
                    type: ChestType.INFINITY_CHEST,
                    id: c.id,
                    _uuid: c._uuid,
                    item_filter: [{ item_name: '', request_count: 1 }],
                } as InfinityChestFormData;
            }
        }),
    };
}

export function removeChest(prev: ConfigFormData, index: number): ConfigFormData {
    return {
        ...prev,
        chests: prev.chests.filter((_, i) => i !== index),
    };
}

export function replaceChests(prev: ConfigFormData, newChests: ChestFormData[]): ConfigFormData {
    return {
        ...prev,
        chests: newChests,
    };
}

// Drills
export function enableDrills(prev: ConfigFormData): ConfigFormData {
    return {
        ...prev,
        drills: {
            mining_productivity_level: 0,
            configs: [],
        },
    };
}

export function disableDrills(prev: ConfigFormData): ConfigFormData {
    const { drills: _drills, ...rest } = prev;
    void _drills;
    return rest as ConfigFormData;
}

export function updateDrillsConfig(prev: ConfigFormData, field: 'mining_productivity_level', value: number): ConfigFormData {
    if (!prev.drills) return prev;
    return {
        ...prev,
        drills: {
            ...prev.drills,
            [field]: value,
        },
    };
}

export function addDrill(prev: ConfigFormData): ConfigFormData {
    const currentDrills = prev.drills ?? { mining_productivity_level: 0, configs: [] };
    return {
        ...prev,
        drills: {
            ...currentDrills,
            configs: [
                ...currentDrills.configs,
                {
                    id: nextId(currentDrills.configs),
                    _uuid: crypto.randomUUID(),
                    type: 'electric-mining-drill' as const,
                    mined_item_name: '',
                    speed_bonus: 0,
                    target: { type: 'machine' as const, id: 1 },
                },
            ],
        },
    };
}

export function updateDrill(prev: ConfigFormData, index: number, updates: Partial<DrillFormData>): ConfigFormData {
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
}

export function removeDrill(prev: ConfigFormData, index: number): ConfigFormData {
    if (!prev.drills) return prev;
    return {
        ...prev,
        drills: {
            ...prev.drills,
            configs: prev.drills.configs.filter((_, i) => i !== index),
        },
    };
}

export function mergeDrills(prev: ConfigFormData, newDrills: DrillFormData[]): ConfigFormData {
    // If drills aren't enabled, enable them first
    const currentDrills = prev.drills ?? {
        mining_productivity_level: 0,
        configs: [],
    };

    // Reassign IDs to avoid conflicts
    const firstId = nextId(currentDrills.configs);
    const drillsWithNewIds = newDrills.map((d, i) => ({
        ...d,
        id: firstId + i,
        _uuid: crypto.randomUUID(),
    }));

    return {
        ...prev,
        drills: {
            ...currentDrills,
            configs: [...currentDrills.configs, ...drillsWithNewIds],
        },
    };
}

export function replaceDrills(prev: ConfigFormData, newDrills: DrillFormData[]): ConfigFormData {
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
}

// Overrides
export function updateOverrides(
    prev: ConfigFormData,
    field: keyof NonNullable<ConfigFormData['overrides']>,
    value: number | boolean | string[] | undefined,
): ConfigFormData {
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
}

export function updateIgnoredIngredients(
    prev: ConfigFormData,
    items: string[],
    transferPlan: SerializableTransferPlan,
): ConfigFormData {
    const prevIgnored = prev.overrides?.ignored_lcm_ingredients ?? [];

    const updatedInserters = prev.inserters.map((ins) => {
        const entityKey = `inserter:${ins.id}`;
        const planEntry = transferPlan.entities.find(
            (e) => e.entity_id === entityKey && e.entity_type === 'inserter'
        );
        if (!planEntry || planEntry.item_transfers.length === 0) return ins;

        const allNowIgnored = planEntry.item_transfers.every((t) => items.includes(t.item_name));
        const allPrevIgnored = planEntry.item_transfers.every((t) => prevIgnored.includes(t.item_name));

        if (allNowIgnored) {
            // Auto-force to ALWAYS
            return {
                ...ins,
                overrides: {
                    ...ins.overrides,
                    enable_control: { mode: 'ALWAYS' as const },
                },
            };
        } else if (allPrevIgnored && ins.overrides?.enable_control?.mode === 'ALWAYS') {
            // Was auto-forced to ALWAYS because all its items were previously ignored;
            // revert by removing the enable_control override
            const { enable_control: _ec, ...restOverrides } = ins.overrides ?? {};
            void _ec;
            const hasRemainingOverrides = Object.keys(restOverrides).length > 0;
            return {
                ...ins,
                overrides: hasRemainingOverrides ? restOverrides : undefined,
            };
        }

        return ins;
    });

    const newOverrides = {
        ...prev.overrides,
        ignored_lcm_ingredients: items.length > 0 ? items : undefined,
    };
    if (newOverrides.ignored_lcm_ingredients === undefined) {
        delete newOverrides.ignored_lcm_ingredients;
    }

    // Use the same pattern as updateOverrides: remove the overrides key entirely when empty
    if (Object.keys(newOverrides).length === 0) {
        const { overrides: _o, ...rest } = prev;
        void _o;
        return { ...rest, inserters: updatedInserters } as ConfigFormData;
    }

    return {
        ...prev,
        inserters: updatedInserters,
        overrides: newOverrides,
    };
}

// ── Reorders ──────────────────────────────────────────────────────────
// Each rearranges the array, reassigns sequential IDs, then fixes up any
// cross-references in other entity arrays so nothing points to a stale ID.

export function reorderMachines(prev: ConfigFormData, fromIndex: number, toIndex: number): ConfigFormData {
    const { items: newMachines, idMap } = reorderWithIdReassignment(prev.machines, fromIndex, toIndex);
    if (idMap.size === 0) return { ...prev, machines: newMachines };
    const remap = (id: number) => idMap.get(id) ?? id;
    const newInserters = prev.inserters.map((ins) => ({
        ...ins,
        source: ins.source.type === 'machine' ? { ...ins.source, id: remap(ins.source.id) } : ins.source,
        sink: ins.sink.type === 'machine' ? { ...ins.sink, id: remap(ins.sink.id) } : ins.sink,
    }));
    const newDrills = prev.drills
        ? { ...prev.drills, configs: prev.drills.configs.map((d) => ({ ...d, target: { ...d.target, id: remap(d.target.id) } })) }
        : undefined;
    return { ...prev, machines: newMachines, inserters: newInserters, ...(newDrills ? { drills: newDrills } : {}) };
}

export function reorderInserters(prev: ConfigFormData, fromIndex: number, toIndex: number): ConfigFormData {
    const { items } = reorderWithIdReassignment(prev.inserters, fromIndex, toIndex);
    return { ...prev, inserters: items };
}

export function reorderBelts(prev: ConfigFormData, fromIndex: number, toIndex: number): ConfigFormData {
    const { items: newBelts, idMap } = reorderWithIdReassignment(prev.belts, fromIndex, toIndex);
    if (idMap.size === 0) return { ...prev, belts: newBelts };
    const remap = (id: number) => idMap.get(id) ?? id;
    const newInserters = prev.inserters.map((ins) => ({
        ...ins,
        source: ins.source.type === 'belt' ? { ...ins.source, id: remap(ins.source.id) } : ins.source,
        sink: ins.sink.type === 'belt' ? { ...ins.sink, id: remap(ins.sink.id) } : ins.sink,
    }));
    return { ...prev, belts: newBelts, inserters: newInserters };
}

export function reorderChests(prev: ConfigFormData, fromIndex: number, toIndex: number): ConfigFormData {
    const { items: newChests, idMap } = reorderWithIdReassignment(prev.chests, fromIndex, toIndex);
    if (idMap.size === 0) return { ...prev, chests: newChests };
    const remap = (id: number) => idMap.get(id) ?? id;
    const newInserters = prev.inserters.map((ins) => ({
        ...ins,
        source: ins.source.type === 'chest' ? { ...ins.source, id: remap(ins.source.id) } : ins.source,
        sink: ins.sink.type === 'chest' ? { ...ins.sink, id: remap(ins.sink.id) } : ins.sink,
    }));
    return { ...prev, chests: newChests, inserters: newInserters };
}

export function reorderDrills(prev: ConfigFormData, fromIndex: number, toIndex: number): ConfigFormData {
    if (!prev.drills) return prev;
    const { items } = reorderWithIdReassignment(prev.drills.configs, fromIndex, toIndex);
    return { ...prev, drills: { ...prev.drills, configs: items } };
}
