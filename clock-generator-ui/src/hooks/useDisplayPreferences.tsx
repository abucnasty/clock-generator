import { createContext, useContext, useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import {
    readDisplayPreferences, writeDisplayPreferences,
    type DisplayPreferences, type DisplayScheme,
} from '../utils/displayPreferences';

interface DisplayPreferencesContextValue {
    scheme: DisplayScheme;
    setScheme(scheme: DisplayScheme): void;
}

const Context = createContext<DisplayPreferencesContextValue | null>(null);

function browserStorage(): Storage | null {
    try {
        return window.localStorage;
    } catch {
        return null;
    }
}

export function DisplayPreferencesProvider({ children }: { children: ReactNode }): ReactElement {
    const [preferences, setPreferences] = useState(() => readDisplayPreferences(browserStorage()));
    useEffect(() => { writeDisplayPreferences(browserStorage(), preferences); }, [preferences]);
    const value = useMemo<DisplayPreferencesContextValue>(() => {
        const update = (change: Partial<DisplayPreferences>) => setPreferences(previous => ({ ...previous, ...change }));
        return {
            scheme: preferences.scheme,
            setScheme: scheme => update({ scheme }),
        };
    }, [preferences]);
    return <Context.Provider value={value}>{children}</Context.Provider>;
}

// This shared public module intentionally exposes the stable provider and its consumer hook together.
// eslint-disable-next-line react-refresh/only-export-components
export function useDisplayPreferences(): DisplayPreferencesContextValue {
    const value = useContext(Context);
    if (!value) throw new Error('Display preferences require DisplayPreferencesProvider');
    return value;
}
