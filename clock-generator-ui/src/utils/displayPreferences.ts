export type DisplayScheme = 'system' | 'light' | 'dark';

export interface DisplayPreferences {
    version: 1;
    scheme: DisplayScheme;
}

export const DISPLAY_PREFERENCES_KEY = 'clock-generator-display-preferences';
export const DEFAULT_DISPLAY_PREFERENCES: DisplayPreferences = { version: 1, scheme: 'dark' };

/** Legacy density settings are ignored; the saved theme survives the move to one layout. */
export function readDisplayPreferences(storage: Pick<Storage, 'getItem'> | null): DisplayPreferences {
    try {
        const value: unknown = JSON.parse(storage?.getItem(DISPLAY_PREFERENCES_KEY) ?? 'null');
        if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1) {
            return { ...DEFAULT_DISPLAY_PREFERENCES };
        }
        const saved = value as Partial<DisplayPreferences>;
        return {
            version: 1,
            scheme: saved.scheme === 'light' || saved.scheme === 'dark' || saved.scheme === 'system'
                ? saved.scheme : DEFAULT_DISPLAY_PREFERENCES.scheme,
        };
    } catch {
        return { ...DEFAULT_DISPLAY_PREFERENCES };
    }
}

export function writeDisplayPreferences(storage: Pick<Storage, 'setItem'> | null, preferences: DisplayPreferences): void {
    try {
        storage?.setItem(DISPLAY_PREFERENCES_KEY, JSON.stringify({ version: 1, scheme: preferences.scheme }));
    } catch {
        // Display choices still work for this page when browser storage is unavailable.
    }
}
