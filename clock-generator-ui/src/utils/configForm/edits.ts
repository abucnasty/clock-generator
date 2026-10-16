import type { SerializableTransferPlan } from 'clock-generator/browser';
import { ChestType } from 'clock-generator/light';
import { beltGeometryEditProblem, endpointEditProblem } from '../inserterMetadata';
import {
    BELT_FORM_DEFAULT_STACK_SIZE,
    BELT_FORM_DEFAULT_TYPE,
    type BeltFormData,
    type BeltLaneFormData,
    type ChestFormData,
    type ConfigFormData,
    type DrillFormData,
    type EntityKind,
    type InserterFormData,
    type MachineFormData,
} from './formData';

// Plain edits of the form state: each takes the state and returns the edited state, for `setConfig`

/** The id for a new entity of a kind: one past the highest of the kind's entities */
export function nextId(prev: ConfigFormData, kind: EntityKind): number {
    const items: { id: number }[] = kind === 'drills' ? prev.drills?.configs ?? [] : prev[kind];
    return Math.max(1, ...items.map((item) => item.id + 1));
}

/** Append a deep copy without changing references to the original entity. */
export function duplicateEntity(prev: ConfigFormData, kind: EntityKind, index: number): ConfigFormData {
    const list = kind === 'drills' ? prev.drills?.configs ?? [] : prev[kind];
    const item = list[index];
    if (!item) return prev;
    // A second inserter needs its own physical drop position; copying that position would invent geometry.
    if (kind === 'inserters' && (item as InserterFormData).sink.drop !== undefined) return prev;
    const copy = { ...structuredClone(item), id: nextId(prev, kind), _uuid: crypto.randomUUID() };
    if (kind === 'drills') {
        return { ...prev, drills: { ...prev.drills!, configs: [...prev.drills!.configs, copy as DrillFormData] } };
    }
    return { ...prev, [kind]: [...prev[kind], copy] };
}

/**
 * Numbers the entities 1, 2, 3 … by their place, keeping every other field. The map takes the old id of every entity
 * to its new one (the first entity wins where two had the same id).
 */
function renumberKind<T extends { id: number }>(items: T[]): { items: T[]; idMap: Map<number, number> } {
    const idMap = new Map<number, number>();
    items.forEach((item, i) => {
        if (!idMap.has(item.id)) idMap.set(item.id, i + 1);
    });
    return { items: items.map((item, i) => ({ ...item, id: i + 1 })), idMap };
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
    return renumberKind(reordered);
}

/** No entity has id 0: a reference to it is one not chosen, which the form shows empty and the generator rejects */
const UNSET_ID = 0;

/**
 * Moves the references to the entities of a kind along with their renumbering. A reference to an id that is not in
 * the map (the removed entity's, or one no entity had) is unset.
 */
function followRenumber(prev: ConfigFormData, kind: EntityKind, idMap: Map<number, number>): ConfigFormData {
    const type = kind === 'machines' ? 'machine' : kind === 'belts' ? 'belt' : kind === 'chests' ? 'chest' : undefined;
    // nothing refers to an inserter or a drill
    if (type === undefined) return prev;
    const follow = <E extends { type: string; id: number }>(end: E): E => {
        if (end.type !== type || end.id === UNSET_ID) return end;
        const id = idMap.get(end.id) ?? UNSET_ID;
        if (id === end.id) return end;
        // an unset end has no lane
        return id === UNSET_ID ? { type: end.type, id } as E : { ...end, id };
    };
    return {
        ...prev,
        inserters: prev.inserters.map((ins) => ({ ...ins, source: follow(ins.source), sink: follow(ins.sink) })),
        ...(prev.drills && type === 'machine' && {
            drills: { ...prev.drills, configs: prev.drills.configs.map((d) => ({ ...d, target: follow(d.target) })) },
        }),
    };
}

/** Takes out the entity at an index and renumbers the rest; undefined if there is none there */
function removeAndRenumber<T extends { id: number }>(items: T[], index: number): { items: T[]; idMap: Map<number, number> } | undefined {
    if (index < 0 || index >= items.length) return undefined;
    return renumberKind(items.filter((_, i) => i !== index));
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
                id: nextId(prev, 'machines'),
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
    const removed = removeAndRenumber(prev.machines, index);
    if (!removed) return prev;
    return followRenumber({ ...prev, machines: removed.items }, 'machines', removed.idMap);
}

export function mergeMachines(prev: ConfigFormData, newMachines: MachineFormData[]): ConfigFormData {
    // Reassign IDs to avoid conflicts
    const firstId = nextId(prev, 'machines');
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
                id: nextId(prev, 'inserters'),
                _uuid: crypto.randomUUID(),
                source: { type: 'machine', id: 1 },
                sink: { type: 'belt', id: 1 },
                stack_size: 16,
            }
        ],
    };
}

/** Keep no-op endpoint metadata and refuse moving a physical drop position onto another route. */
function withPreservedEndpoints(ins: InserterFormData, updates: Partial<InserterFormData>): InserterFormData {
    const endpoint = <E extends { type: InserterFormData['source']['type']; id: number }>(before: E, after: E | undefined, side: 'source' | 'sink'): E => {
        if (after === undefined) return before;
        // Source updates are complete endpoints: withNearLane deliberately removes the optional key for Not set.
        // No-op pickers/connections use endpointUpdate and send no replacement at all.
        if (before.type === after.type && before.id === after.id) return after;
        return endpointEditProblem(ins, side, after) === null ? after : before;
    };
    return { ...ins, ...updates, source: endpoint(ins.source, updates.source, 'source'),
        // Imported drop geometry is read-only, including attempts to clear it on the same route.
        sink: ins.sink.drop !== undefined ? ins.sink : endpoint(ins.sink, updates.sink, 'sink') };
}

/** An update with `overrides` replaces the rule, so it is no longer one forced by Exclude from LCM. */
export function updateInserter(prev: ConfigFormData, index: number, updates: Partial<InserterFormData>): ConfigFormData {
    return {
        ...prev,
        inserters: prev.inserters.map((ins, i) => {
            if (i !== index) return ins;
            const next = withPreservedEndpoints(ins, updates);
            if ('overrides' in updates) delete next._forced_always;
            return next;
        }),
    };
}

/** One bulk edit; each row keeps its own fields and non-rule overrides. */
export function updateInserters(prev: ConfigFormData, uuids: readonly string[], updates: Partial<InserterFormData>): ConfigFormData {
    if (uuids.length === 0) return prev;
    const selected = new Set(uuids);
    return {
        ...prev,
        inserters: prev.inserters.map(ins => {
            if (!selected.has(ins._uuid)) return ins;
            const next = withPreservedEndpoints(ins, updates);
            if ('overrides' in updates) {
                delete next._forced_always;
                next.overrides = { ...ins.overrides, ...updates.overrides };
            }
            if ('filters' in updates && updates.filters === undefined) delete next.filters;
            if ('stack_size' in updates && updates.stack_size === undefined) delete next.stack_size;
            return next;
        }),
    };
}

export function removeInserter(prev: ConfigFormData, index: number): ConfigFormData {
    const removed = removeAndRenumber(prev.inserters, index);
    if (!removed) return prev;
    return { ...prev, inserters: removed.items };
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
                id: nextId(prev, 'belts'),
                _uuid: crypto.randomUUID(),
                type: BELT_FORM_DEFAULT_TYPE,
                lanes: [{ ingredient: '', stack_size: BELT_FORM_DEFAULT_STACK_SIZE }] as [BeltLaneFormData],
            },
        ],
    };
}

export function updateBelt(prev: ConfigFormData, index: number, updates: Partial<BeltFormData>): ConfigFormData {
    const belt = prev.belts[index];
    if (belt && beltGeometryEditProblem(prev.inserters, belt, updates)) return prev;
    return {
        ...prev,
        belts: prev.belts.map((b, i) =>
            i === index ? { ...b, ...updates } : b
        ),
    };
}

export function removeBelt(prev: ConfigFormData, index: number): ConfigFormData {
    const removed = removeAndRenumber(prev.belts, index);
    if (!removed) return prev;
    return followRenumber({ ...prev, belts: removed.items }, 'belts', removed.idMap);
}

export function replaceBelts(prev: ConfigFormData, newBelts: BeltFormData[]): ConfigFormData {
    return {
        ...prev,
        belts: newBelts,
    };
}

// Chests
export function addChest(prev: ConfigFormData, chestType: ChestType = ChestType.BUFFER_CHEST): ConfigFormData {
    const id = nextId(prev, 'chests');
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

/** The same chest conversion for a dialog draft and the committed form. */
export function switchedChest(chest: ChestFormData, newType: ChestType): ChestFormData {
    return newType === ChestType.BUFFER_CHEST
        ? { type: ChestType.BUFFER_CHEST, id: chest.id, _uuid: chest._uuid, storage_size: 1, item_filter: '' }
        : { type: ChestType.INFINITY_CHEST, id: chest.id, _uuid: chest._uuid, item_filter: [{ item_name: '', request_count: 1 }] };
}

export function switchChestType(prev: ConfigFormData, index: number, newType: ChestType): ConfigFormData {
    return { ...prev, chests: prev.chests.map((chest, i) => i === index ? switchedChest(chest, newType) : chest) };
}

export function removeChest(prev: ConfigFormData, index: number): ConfigFormData {
    const removed = removeAndRenumber(prev.chests, index);
    if (!removed) return prev;
    return followRenumber({ ...prev, chests: removed.items }, 'chests', removed.idMap);
}

export function replaceChests(prev: ConfigFormData, newChests: ChestFormData[]): ConfigFormData {
    return {
        ...prev,
        chests: newChests,
    };
}

// Drills
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
                    id: nextId(prev, 'drills'),
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
    const removed = removeAndRenumber(prev.drills.configs, index);
    if (!removed) return prev;
    return { ...prev, drills: { ...prev.drills, configs: removed.items } };
}

export function mergeDrills(prev: ConfigFormData, newDrills: DrillFormData[]): ConfigFormData {
    // If drills aren't enabled, enable them first
    const currentDrills = prev.drills ?? {
        mining_productivity_level: 0,
        configs: [],
    };

    // Reassign IDs to avoid conflicts
    const firstId = nextId(prev, 'drills');
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

/**
 * Sets the ingredients left out of the LCM. An inserter whose items are now all excluded and that has no rule of its
 * own (AUTO) is forced to ALWAYS, and flagged so; including one of its items again takes away only that forced ALWAYS.
 * A rule the player set (ALWAYS, NEVER, CLOCKED or CONDITIONAL) is never replaced or removed.
 */
export function updateIgnoredIngredients(
    prev: ConfigFormData,
    items: string[],
    transferPlan: SerializableTransferPlan,
): ConfigFormData {
    const updatedInserters = prev.inserters.map((ins) => {
        const planEntry = transferPlan.entities.find(
            (e) => e.entity_type === 'inserter' && e.entity_number === ins.id
        );
        if (!planEntry || planEntry.item_transfers.length === 0) return ins;

        const allNowIgnored = planEntry.item_transfers.every((t) => items.includes(t.item_name));
        const mode = ins.overrides?.enable_control?.mode ?? 'AUTO';

        if (allNowIgnored) {
            // a rule of the player's own stays; an inserter already forced stays forced
            if (mode !== 'AUTO') return ins;
            return {
                ...ins,
                overrides: {
                    ...ins.overrides,
                    enable_control: { mode: 'ALWAYS' as const },
                },
                _forced_always: true as const,
            };
        }
        if (ins._forced_always) {
            const { _forced_always: _f, overrides, ...unflagged } = ins;
            void _f;
            // any rule other than the forced ALWAYS stays (replacing the rule unflags the inserter, so this is only
            // a safeguard)
            if (mode !== 'ALWAYS') return overrides ? { ...unflagged, overrides } : unflagged;
            // the ALWAYS was put there by Exclude, so it goes, and the overrides with it once none is left
            const { enable_control: _ec, ...restOverrides } = overrides ?? {};
            void _ec;
            return Object.keys(restOverrides).length > 0 ? { ...unflagged, overrides: restOverrides } : unflagged;
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
// Each rearranges the array, reassigns sequential IDs, then follows the
// renumbering in the references to the kind, as a remove does.

export function reorderMachines(prev: ConfigFormData, fromIndex: number, toIndex: number): ConfigFormData {
    const { items, idMap } = reorderWithIdReassignment(prev.machines, fromIndex, toIndex);
    return followRenumber({ ...prev, machines: items }, 'machines', idMap);
}

export function reorderInserters(prev: ConfigFormData, fromIndex: number, toIndex: number): ConfigFormData {
    const { items } = reorderWithIdReassignment(prev.inserters, fromIndex, toIndex);
    return { ...prev, inserters: items };
}

export function reorderBelts(prev: ConfigFormData, fromIndex: number, toIndex: number): ConfigFormData {
    const { items, idMap } = reorderWithIdReassignment(prev.belts, fromIndex, toIndex);
    return followRenumber({ ...prev, belts: items }, 'belts', idMap);
}

export function reorderChests(prev: ConfigFormData, fromIndex: number, toIndex: number): ConfigFormData {
    const { items, idMap } = reorderWithIdReassignment(prev.chests, fromIndex, toIndex);
    return followRenumber({ ...prev, chests: items }, 'chests', idMap);
}

export function reorderDrills(prev: ConfigFormData, fromIndex: number, toIndex: number): ConfigFormData {
    if (!prev.drills) return prev;
    const { items } = reorderWithIdReassignment(prev.drills.configs, fromIndex, toIndex);
    return { ...prev, drills: { ...prev.drills, configs: items } };
}
