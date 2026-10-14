import { useCallback, useEffect, useState } from 'react';
import { ChestType, ConfigSchema } from 'clock-generator/browser';
import {
    createDefaultConfig,
    type BeltFormData,
    type ChestFormData,
    type ConfigFormData,
    type DrillFormData,
    type InfinityChestFormData,
    type InfinityFilterFormData,
    type InserterFormData,
    type MachineFormData,
} from '../utils/configForm/formData';

const STORAGE_KEY = 'clock-generator-config';

/** Migrate legacy inserter data to include id field */
function migrateInserters(inserters: unknown[]): InserterFormData[] {
    return inserters.map((ins: unknown, index: number) => {
        const i = ins as InserterFormData & { id?: number; _uuid?: string };
        const withId = typeof i.id === 'number' ? i : { ...i, id: index + 1 };
        return withId._uuid ? withId as InserterFormData : { ...withId, _uuid: crypto.randomUUID() } as InserterFormData;
    });
}

/** Migrate legacy chest data to include type field */
export function migrateChests(chests: unknown[]): ChestFormData[] {
    return chests.map((chest: unknown) => {
        const c = chest as { type?: string; id: number; _uuid?: string; storage_size?: number; item_filter?: string | InfinityFilterFormData[] };
        const uuid = c._uuid ?? crypto.randomUUID();
        // If already has a valid type, return as-is (with uuid)
        if (c.type === ChestType.INFINITY_CHEST) {
            return { ...(c as InfinityChestFormData), _uuid: uuid };
        }
        // Default to buffer chest (handles legacy data without type)
        return {
            type: ChestType.BUFFER_CHEST,
            id: c.id,
            _uuid: uuid,
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
                // Migrate legacy inserters (assign id / _uuid if missing)
                if (Array.isArray(parsed.inserters)) {
                    parsed.inserters = migrateInserters(parsed.inserters);
                }
                // Migrate machines, belts, drills: add _uuid if missing
                if (Array.isArray(parsed.machines)) {
                    parsed.machines = parsed.machines.map((m: MachineFormData & { _uuid?: string }) =>
                        m._uuid ? m : { ...m, _uuid: crypto.randomUUID() });
                }
                if (Array.isArray(parsed.belts)) {
                    parsed.belts = parsed.belts.map((b: BeltFormData & { _uuid?: string }) =>
                        b._uuid ? b : { ...b, _uuid: crypto.randomUUID() });
                }
                if (parsed.drills && Array.isArray(parsed.drills.configs)) {
                    parsed.drills.configs = parsed.drills.configs.map((d: DrillFormData & { _uuid?: string }) =>
                        d._uuid ? d : { ...d, _uuid: crypto.randomUUID() });
                }
                const result = ConfigSchema.safeParse(parsed);
                // The form can hold values the generator rejects (e.g. 0 items per second); only reject a broken structure
                if (result.success || result.error.issues.every((issue) => issue.code === 'too_small' || issue.code === 'too_big')) {
                    return parsed as ConfigFormData;
                }
                console.warn('Saved config in localStorage is invalid, using defaults:', result.error);
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
        // Strip internal _uuid fields — they are UI-only and shouldn't be in the exported config.
        localStorage.setItem(STORAGE_KEY, JSON.stringify(config, (key, value) =>
            key === '_uuid' ? undefined : value
        ));
    } catch (e) {
        console.warn('Failed to save config to localStorage:', e);
    }
}

/** The form state, loaded from localStorage and saved back to it on every change */
export function usePersistedConfigForm() {
    const [config, setConfig] = useState<ConfigFormData>(loadConfigFromStorage);

    // Save config to localStorage whenever it changes
    useEffect(() => {
        saveConfigToStorage(config);
    }, [config]);

    const resetConfig = useCallback(() => {
        localStorage.removeItem(STORAGE_KEY);
        setConfig(createDefaultConfig());
    }, []);

    return { config, setConfig, resetConfig };
}
