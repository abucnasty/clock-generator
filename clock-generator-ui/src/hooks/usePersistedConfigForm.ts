import { useCallback, useEffect, useState } from 'react';
import { ChestType } from 'clock-generator/light';
import { askEngine } from '../worker/engineClient';
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
function migrateChests(chests: unknown[]): ChestFormData[] {
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

/** The config in an imported file, not yet checked against the config schema; files from before chest types have chests without a type */
export function readConfigFile(content: string): unknown {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed?.chests)) {
        parsed.chests = migrateChests(parsed.chests);
    }
    return parsed;
}

/** Read the config from localStorage with the legacy fields migrated; null if there is none or it lacks the required fields */
function readConfigFromStorage(): ConfigFormData | null {
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
                return parsed as ConfigFormData;
            }
        }
    } catch (e) {
        console.warn('Failed to load config from localStorage:', e);
    }
    return null;
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

/**
 * The form state, loaded from localStorage and saved back to it on every change.
 *
 * The engine's worker checks the saved config against the config schema first, so it is loaded (`isLoaded`) once
 * that worker is up. Until then the state is the default config, nothing is saved, and `unchecked` holds the saved
 * config.
 */
export function usePersistedConfigForm() {
    const [stored] = useState(readConfigFromStorage);
    const [defaultConfig] = useState(createDefaultConfig);
    const [config, setConfig] = useState<ConfigFormData>(defaultConfig);
    const [isLoaded, setIsLoaded] = useState(stored === null);

    useEffect(() => {
        if (stored === null) {
            return;
        }
        let current = true;
        askEngine({ kind: 'saved-config', config: stored }).then(
            (problem) => {
                if (!current) return;
                if (problem === null) {
                    // unless the config was replaced (imported or reset) in the meantime
                    setConfig((previous) => previous === defaultConfig ? stored : previous);
                } else {
                    console.warn('Saved config in localStorage is invalid, using defaults:', problem);
                }
                setIsLoaded(true);
            },
            (e) => console.warn('Failed to check the config from localStorage:', e),
        );
        return () => {
            current = false;
        };
    }, [stored, defaultConfig]);

    // Save config to localStorage whenever it changes, once the saved one is loaded
    useEffect(() => {
        if (isLoaded) {
            saveConfigToStorage(config);
        }
    }, [config, isLoaded]);

    const resetConfig = useCallback(() => {
        localStorage.removeItem(STORAGE_KEY);
        setConfig(createDefaultConfig());
    }, []);

    // the saved config while it waits for the check, unless it was replaced in the meantime
    const unchecked = !isLoaded && config === defaultConfig ? stored : null;

    return { config, setConfig, resetConfig, isLoaded, unchecked };
}
