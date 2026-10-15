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
/** Where a saved config that cannot be loaded is kept */
const BACKUP_STORAGE_KEY = `${STORAGE_KEY}.backup`;

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

/** The saved form state with the legacy fields migrated; null if it is not JSON or lacks the required fields */
export function readSavedConfig(stored: string): ConfigFormData | null {
    try {
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
            // forms saved before ids were renumbered on delete carry a UI-only `next_ids`; it is no longer used
            delete parsed.next_ids;
            return parsed as ConfigFormData;
        }
    } catch (e) {
        console.warn('Failed to load config from localStorage:', e);
    }
    return null;
}

interface StoredConfig {
    /** As saved */
    text: string;
    /** Null when it cannot be read as the form state */
    config: ConfigFormData | null;
}

/** The config saved in localStorage; null if there is none */
function readConfigFromStorage(): StoredConfig | null {
    try {
        const text = localStorage.getItem(STORAGE_KEY);
        if (text) {
            return { text, config: readSavedConfig(text) };
        }
    } catch (e) {
        console.warn('Failed to load config from localStorage:', e);
    }
    return null;
}

/**
 * Copies a saved config that cannot be loaded to BACKUP_STORAGE_KEY, as the defaults are saved over it next;
 * gives the message that tells the user so
 */
export function backUpSavedConfig(storage: Pick<Storage, 'setItem'>, text: string): string {
    const failed = 'Your saved build could not be loaded.';
    try {
        storage.setItem(BACKUP_STORAGE_KEY, text);
    } catch (e) {
        // the console is then the only place it is kept
        console.warn('Failed to back up the saved config, which was:', text, e);
        return `${failed} A copy of it could not be kept, so the browser console shows it.`;
    }
    return `${failed} A copy of it is kept in this browser's localStorage under the key "${BACKUP_STORAGE_KEY}"; `
        + 'the browser console says what is wrong with it.';
}

/** The form state as saved in localStorage */
export function serializeConfig(config: ConfigFormData): string {
    // Strip internal _uuid fields — they are UI-only and shouldn't be in the exported config.
    return JSON.stringify(config, (key, value) =>
        key === '_uuid' ? undefined : value
    );
}

/** Save config to localStorage */
function saveConfigToStorage(config: ConfigFormData): void {
    try {
        localStorage.setItem(STORAGE_KEY, serializeConfig(config));
    } catch (e) {
        console.warn('Failed to save config to localStorage:', e);
    }
}

/**
 * The form state, loaded from localStorage and saved back to it on every change.
 *
 * The engine's worker checks the saved config against the config schema first, so it is loaded (`isLoaded`) once
 * that worker is up. Until then the state is the default config, nothing is saved, and `unchecked` holds the saved
 * config, which Export offers; if the check fails, `loadError` says why. A saved config that cannot be loaded is
 * backed up before the defaults are saved over it, and `loadNotice` tells the user so.
 */
export function usePersistedConfigForm() {
    const [stored] = useState(readConfigFromStorage);
    const [defaultConfig] = useState(createDefaultConfig);
    const [config, setConfig] = useState<ConfigFormData>(defaultConfig);
    const [isLoaded, setIsLoaded] = useState(stored?.config == null);
    // why the saved config could not be checked, e.g. the engine's worker did not start
    const [loadError, setLoadError] = useState<string | null>(null);
    // one that cannot be read at all is backed up at once, before the first save (doing it twice does no harm)
    const [loadNotice, setLoadNotice] = useState(() => {
        if (stored?.config !== null) return null;
        console.warn('Saved config in localStorage is not the form state, using defaults');
        return backUpSavedConfig(localStorage, stored.text);
    });

    useEffect(() => {
        if (stored === null || stored.config === null) {
            return;
        }
        const savedConfig = stored.config;
        let current = true;
        askEngine({ kind: 'saved-config', config: savedConfig }).then(
            (problem) => {
                if (!current) return;
                if (problem === null) {
                    // unless the config was replaced (imported or reset) in the meantime
                    setConfig((previous) => previous === defaultConfig ? savedConfig : previous);
                } else {
                    console.warn('Saved config in localStorage is invalid, using defaults:', problem);
                    setLoadNotice(backUpSavedConfig(localStorage, stored.text));
                }
                setIsLoaded(true);
            },
            (e) => {
                console.warn('Failed to check the config from localStorage:', e);
                if (current) setLoadError(e instanceof Error ? e.message : 'Failed to check the saved config');
            },
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
    const unchecked = !isLoaded && config === defaultConfig ? stored?.config ?? null : null;

    const dismissLoadNotice = useCallback(() => setLoadNotice(null), []);

    return { config, setConfig, resetConfig, isLoaded, loadError, unchecked, loadNotice, dismissLoadNotice };
}
