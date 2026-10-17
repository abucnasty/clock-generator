export type DisplayDensity = 'explanatory' | 'compact';
export type DisplayScheme = 'system' | 'light' | 'dark';

export interface DisplayPreferences {
    version: 1;
    density: DisplayDensity;
    scheme: DisplayScheme;
}

export const DISPLAY_PREFERENCES_KEY = 'clock-generator-display-preferences';
export const DEFAULT_DISPLAY_PREFERENCES: DisplayPreferences = { version: 1, density: 'explanatory', scheme: 'system' };

/** Invalid fields fall back independently; an unsupported version cannot be interpreted. */
export function readDisplayPreferences(storage: Pick<Storage, 'getItem'> | null): DisplayPreferences {
    try {
        const value: unknown = JSON.parse(storage?.getItem(DISPLAY_PREFERENCES_KEY) ?? 'null');
        if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1) {
            return { ...DEFAULT_DISPLAY_PREFERENCES };
        }
        const saved = value as Partial<DisplayPreferences>;
        return {
            version: 1,
            density: saved.density === 'compact' ? 'compact' : 'explanatory',
            scheme: saved.scheme === 'light' || saved.scheme === 'dark' ? saved.scheme : 'system',
        };
    } catch {
        return { ...DEFAULT_DISPLAY_PREFERENCES };
    }
}

export function writeDisplayPreferences(storage: Pick<Storage, 'setItem'> | null, preferences: DisplayPreferences): void {
    try {
        storage?.setItem(DISPLAY_PREFERENCES_KEY, JSON.stringify(preferences));
    } catch {
        // Display choices still work for this page when browser storage is unavailable.
    }
}
